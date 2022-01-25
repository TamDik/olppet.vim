import { Denops, option, expandGlob, helper, variable, JSONC } from './deps.ts';
import { bytes, subbytes } from './util.ts';


class SnippetManager {
    private readonly parsers: Record<string, {parser: Parser, directories: string[]}> = {};

    private readonly filetypes: Record<string, {
        snippets: Snippet[],
        parsedDirectories: Set<string>,
        parsedFiles: Set<string>
    }> = {};

    public addParser(name: string, parser: Parser): void {
        this.parsers[name] = {parser, directories: []};
    }

    public async addPathOrRepoName(denops: Denops, parserName: string, pathOrRepoName: string, subdirectory?: string): Promise<void> {
        const runtimepath = await option.runtimepath.getGlobal(denops);
        for (const path of runtimepath.split(',')) {
            if (path.endsWith('/' + pathOrRepoName)) {
                const directory = path + (subdirectory ? `/${subdirectory}` : '');
                this.parsers[parserName].directories.push(directory);
                return;
            }
        }
        const directory = pathOrRepoName + (subdirectory ? `/${subdirectory}` : '');
        this.parsers[parserName].directories.push(directory);
    }

    public async getSnippets(filetype: string): Promise<Snippet[]> {
        await this.parseSnippetsIfNeeds(filetype);
        return this.filetypes[filetype].snippets;
    }

    private async parseSnippetsIfNeeds(filetype: string): Promise<void> {
        if (this.filetypes[filetype] === undefined) {
            this.filetypes[filetype] = {
                snippets: [],
                parsedDirectories: new Set(),
                parsedFiles: new Set(),
            };
        }
        for (const [parserName, {parser, directories}] of Object.entries(this.parsers)) {
            for (const directory of directories) {
                if (this.filetypes[filetype].parsedDirectories.has(directory)) {
                    continue;
                }
                this.filetypes[filetype].parsedDirectories.add(directory);
                for (const filepath of await parser.fetchSnippetsFiles(filetype, directory)) {
                    await this.parseSnippet(parserName, filetype, filepath);
                }
            }
        }
    }

    private async parseSnippet(parserName: string, filetype: string, filepath: string): Promise<void> {
        const parsed = this.filetypes[filetype].parsedFiles;
        if (parsed.has(filepath)) {
            return;
        }
        parsed.add(filepath);
        const {snippets, extendsFilepaths} = await this.parsers[parserName].parser.parse(filetype, filepath);
        for (const snippet of snippets) {
            this.filetypes[filetype].snippets.push(snippet);
        }
        for (const extendFilepath of extendsFilepaths) {
            await this.parseSnippet(parserName, filetype, extendFilepath);
        }
    }
}


type CurrentSnippet = {
    snippet: Snippet,
    head: string,
    tail: string,
    lines: string[],
    prevLines: string[],
    scripts: Record<string, {token: VimToken, value: string | null}>,
    entoryPoint: {lnum: number, col: number},
    tabstops: CurrentSnippetTabStops[],
    focus: CurrentSnippetTabStops | null,
};


type CurrentSnippetTabStops = {
    token: TabStopToken,
    text: string | null,
    start: {lnum: number, col: number},
    end: {lnum: number, col: number},
};


export class Olppet {
    private snippetManager = new SnippetManager();
    private current: CurrentSnippet | null = null;
    private filetype = '';
    private jumpLoop = false;

    public constructor() {
        this.snippetManager.addParser('SnipMate', new SnipMateParser());
        this.snippetManager.addParser('VSCode', new VSCodeParser());
    }

    public async updateFiletype(denops: Denops): Promise<void> {
        this.filetype = await option.filetype.get(denops);
    }

    public setJumpLoop(loop: boolean): void {
        this.jumpLoop = loop;
    }

    private getSnippets(): Promise<Snippet[]> {
        if (this.filetype === '') {
            return Promise.resolve([]);
        }
        return this.snippetManager.getSnippets(this.filetype);
    }

    public registerSnippet(denops: Denops, pathOrRepoName: string, parserName: string, subdirectory?: string) {
        this.snippetManager.addPathOrRepoName(denops, parserName, pathOrRepoName, subdirectory);
    }

    public leaveSnippet(): void {
        this.current = null;
    }

    public async expand(denops: Denops): Promise<boolean> {
        const line: number = await denops.call('line', '.') as number;
        const col: number = await denops.call('col', '.') as number;
        const currentLine: string = await denops.call('getline', line) as string;
        const head = subbytes(currentLine, 0, col - 1);
        let matched: Snippet | null = null;
        for (const snippet of await this.getSnippets()) {
            if (head.match(snippet.pattern)) {
                matched = snippet;
            }
        }
        if (!matched) {
            return false;
        }

        this.current = {
            snippet: matched,
            head: head.substring(0, head.length - matched.trigger.length),
            tail: subbytes(currentLine, col - 1),
            lines: [],
            prevLines: [],
            scripts: {},
            entoryPoint: {
                lnum: line,
                col: col - bytes(matched.trigger),
            },
            tabstops: matched.getAllTabStopTokens().map(token => ({
                token, text: null,
                start: {lnum: 0, col: 0},
                end: {lnum: 0, col: 0},
            })),
            focus: null,
        };
        if (this.current.tabstops.length !== 0) {
            this.current.focus = this.current.tabstops[0];
        }

        await this.updateCurrentSnippetLines(denops);

        for (let i = 0, len = this.current.lines.length; i < len; i++) {
            const line = this.current.lines[i];
            if (i === 0) {
                await denops.call('setline', this.current.entoryPoint.lnum, line);
            } else {
                await denops.call('append', this.current.entoryPoint.lnum + i - 1, line);
            }
        }
        if (this.current.focus === null) {
            await this.jumpToEndPoint(denops);
        } else {
            await this.jumpToFocus(denops, false);
        }
        for (const scriptId in this.current.scripts) {
            const {token} = this.current.scripts[scriptId];
            await helper.execute(denops, `let g:_olppet_temp = ${token.script}`);
            this.current.scripts[scriptId].value = await variable.globals.get(denops, '_olppet_temp');
        }
        await this.updateLines(denops);
        if (this.current.focus === null) {
            await this.jumpToEndPoint(denops);
        } else {
            await this.jumpToFocus(denops);
        }
        if (this.current.focus === null || this.current.focus.token instanceof TerminalToken) {
            this.leaveSnippet();
        }
        return true;
    }

    private async updateCurrentSnippetLines(denops: Denops): Promise<void> {
        if (this.current === null) {
            return;
        }
        this.current.lines.length = 0;
        for (let i = 0, len = this.current.snippet.lines.length; i < len; i++) {
            const snippetLine = this.current.snippet.lines[i];
            let line = '';
            if (i === 0) {
                line += this.current.head;
            } else {
                line += ' '.repeat(bytes(this.current.head));
            }
            for (const token of snippetLine.tokens) {
                const tokenText = await token.toText(denops, this.current);
                if (token instanceof TabStopToken) {
                    for (const tabstop of this.current.tabstops) {
                        if (tabstop.token === token) {
                            tabstop.start.lnum = this.current.entoryPoint.lnum + i;
                            tabstop.end.lnum = this.current.entoryPoint.lnum + i;
                            tabstop.start.col = bytes(line);
                            tabstop.end.col = bytes(line + tokenText);
                            break;
                        }
                    }
                }
                line += tokenText;
            }
            if (i === len - 1) {
                line += this.current.tail;
            }
            this.current.lines.push(line);
        }
    }

    private async updateLines(denops: Denops): Promise<void> {
        if (this.current === null) {
            return;
        }
        await this.updateCurrentSnippetLines(denops);
        const focusTabStop = this.current.focus;
        for (let i = 0, len = this.current.lines.length; i < len; i++) {
            const lnum = this.current.entoryPoint.lnum + i;
            let line = this.current.lines[i];
            if (focusTabStop === null || focusTabStop.start.lnum !== lnum) {
                line = line.trimEnd();
            }
            if (line === this.current.prevLines[i]) {
                continue;
            }
            await denops.call('setline', lnum, line);
            this.current.prevLines[i] = line;
        }
    }

    private async jumpToEndPoint(denops: Denops): Promise<void> {
        if (!this.current) {
            return;
        }
        const lnum = this.current.entoryPoint.lnum + this.current.lines.length - 1;
        const col = bytes(this.current.lines[this.current.lines.length - 1]) + 1;
        await denops.call('cursor', lnum, col);
    }

    private async jumpToFocus(denops: Denops, select?: boolean): Promise<void> {
        if (select === undefined) {
            select = true;
        }
        if (this.current === null) {
            return;
        }
        const focusTabStop = this.current.focus;
        if (focusTabStop === null) {
            return;
        }
        if (!select || focusTabStop.text !== null || focusTabStop.start.col === focusTabStop.end.col) {
            await denops.call('cursor',  focusTabStop.end.lnum, focusTabStop.end.col + 1);
        } else {
            await denops.call('feedkeys', '\u{1b}', 'n');  // Esc
            await denops.call('cursor', focusTabStop.start.lnum, focusTabStop.start.col + 1);
            await helper.execute(denops, 'normal! v');
            await denops.call('cursor', focusTabStop.end.lnum, focusTabStop.end.col + 1);
            await helper.execute(denops, 'normal! \u{07}');  // C-g
        }
    }

    public async jumpForward(denops: Denops): Promise<boolean> {
        if (!this.current) {
            return false;
        }
        if (!this.jumpLoop) {
            const last = this.current.tabstops[this.current.tabstops.length - 1];
            if (this.current.focus === last) {
                return false;
            }
        }
        let nextForcusI = 0;
        for (let i = 0, len = this.current.tabstops.length - 1; i < len; i++) {
            if (this.current.focus === this.current.tabstops[i]) {
                nextForcusI = i + 1;
                break;
            }
        }
        this.current.focus = this.current.tabstops[nextForcusI];
        await this.updateLines(denops);
        await this.jumpToFocus(denops);
        if (this.current.focus && this.current.focus.token instanceof TerminalToken) {
            this.leaveSnippet();
        }
        return true;
    }

    public async jumpBackward(denops: Denops): Promise<boolean> {
        if (!this.current) {
            return false;
        }
        if (!this.jumpLoop) {
            const first = this.current.tabstops[0];
            if (this.current.focus === first) {
                return false;
            }
        }
        let nextForcusI = this.current.tabstops.length - 1;
        for (let i = this.current.tabstops.length - 1; i > 0; i--) {
            if (this.current.focus === this.current.tabstops[i]) {
                nextForcusI = i - 1;
                break;
            }
        }
        this.current.focus = this.current.tabstops[nextForcusI];
        await this.updateLines(denops);
        await this.jumpToFocus(denops);
        if (this.current.focus && this.current.focus.token instanceof TerminalToken) {
            this.leaveSnippet();
        }
        return true;
    }

    public async getTriggers(filetype?: string): Promise<[string, string | null][]> {
        if (!filetype) {
            filetype = this.filetype;
        }
        const snippets = await this.snippetManager.getSnippets(filetype);
        return snippets.map(snippet => [snippet.trigger, snippet.description]);
    }

    public async textChanged(denops: Denops): Promise<void> {
        if (this.current === null || this.current.focus === null) {
            return;
        }
        const focusTabStop = this.current.focus;
        const col: number = await denops.call('col', ".") as number;
        const lnum: number = await denops.call('line', '.') as number;
        const line: string = await denops.call('getline', '.') as string;
        if (lnum < focusTabStop.start.lnum || lnum > focusTabStop.end.lnum) {
            this.leaveSnippet();
            return;
        }
        const delta = bytes(line) - bytes(this.current.lines[lnum - this.current.entoryPoint.lnum]);
        if (delta === 0) {
            return;
        }
        this.current.lines[lnum - this.current.entoryPoint.lnum] = line;
        if (col - 1 < focusTabStop.start.col || col - 1 > focusTabStop.end.col + delta) {
            this.leaveSnippet();
            return;
        }
        focusTabStop.text = subbytes(line, focusTabStop.start.col, focusTabStop.end.col + delta);
        await this.updateLines(denops);
    }
}


class Snippet {
    public readonly pattern: RegExp;
    constructor(public readonly trigger: string,
                public readonly description: string | null,
                public lines: SnippetLine[]) {
        const escapedTrigger = this.trigger.replace(/[.*+?^=!:${}()|[\]\/\\]/g, '\\$&');
        this.pattern = new RegExp('(?<!\\w)' + escapedTrigger + '$');
    }

    public getAllTabStopTokens(): TabStopToken[] {
        const tokens: TabStopToken[] = [];
        for (const line of this.lines) {
            tokens.push(...line.getAllTabStopTokens());
        }
        return tokens;
    }
}


class SnippetLine {
    constructor(public readonly tokens: SnippetToken[]) {
    }

    public getAllTabStopTokens(): TabStopToken[] {
        const tokens: TabStopToken[] = [];
        for (const token of this.tokens) {
            if (token instanceof TabStopToken) {
                tokens.push(token);
            }
        }
        return tokens;
    }
}


abstract class SnippetToken {
    public abstract toText(denops: Denops, current: CurrentSnippet): Promise<string>;
}


class IndentToken extends SnippetToken {
    public async toText(denops: Denops, _current: CurrentSnippet): Promise<string> {
        const tabstop = await option.tabstop.get(denops);
        return ' '.repeat(tabstop);
    }
}


class TextToken extends SnippetToken {
    constructor(private readonly text: string) {
        super();
    }

    public toText(_denops: Denops, _current: CurrentSnippet): Promise<string> {
        return Promise.resolve(this.text);
    }
}


class TabStopToken extends SnippetToken {
    constructor(public readonly tokenId: string, private readonly placeholder: SnippetToken[]) {
        super();
    }

    public async toText(denops: Denops, current: CurrentSnippet): Promise<string> {
        for (const {token, text} of current.tabstops) {
            if (token.tokenId === this.tokenId) {
                if (typeof(text) === 'string') {
                    return text;
                }
            }
        }
        let placeholder = '';
        for (const token of this.placeholder) {
            placeholder += await token.toText(denops, current);
        }
        return placeholder;
    }
}


class TerminalToken extends TabStopToken {
    constructor() {
        super('.', []);
    }

    public toText(_denops: Denops, _current: CurrentSnippet): Promise<string> {
        return Promise.resolve('');
    }
}


class ChoiceToken extends TabStopToken {
    constructor(tokenId: string, items: string[]) {
        super(tokenId, [new TextToken(items.join('/'))]);
    }
}


class MirrorToken extends SnippetToken {
    constructor(public readonly tokenId: string) {
        super();
    }

    public toText(denops: Denops, current: CurrentSnippet): Promise<string> {
        for (const {token} of current.tabstops) {
            if (token.tokenId === this.tokenId) {
                return this.convert(denops, current, token);
            }
        }
        return Promise.resolve(this.tokenId);
    }

    protected convert(denops: Denops, current: CurrentSnippet, token: SnippetToken): Promise<string> {
        return token.toText(denops, current);
    }
}


class TransformToken extends MirrorToken {
    constructor(tokenId: string,
                private readonly pat: string,
                private readonly sub: string,
                private readonly opt: string) {
        super(tokenId);
    }

    protected async convert(denops: Denops, current: CurrentSnippet, token: SnippetToken): Promise<string> {
        const text = await token.toText(denops, current);
        return text.replace(new RegExp(this.pat, this.opt), this.sub);
    }
}


class VimToken extends SnippetToken {
    static _nextId = 1;
    private readonly id: string;
    constructor(public readonly script: string) {
        super();
        this.id = String(VimToken._nextId);
        ++VimToken._nextId;
    }

    public toText(_denops: Denops, current: CurrentSnippet): Promise<string> {
        if (!current.scripts[this.id]) {
            current.scripts[this.id] = {token: this, value: null};
        }
        const value = current.scripts[this.id].value;
        if (!value) {
            return Promise.resolve('');
        }
        return Promise.resolve(value);
    }
}


function splitByRegex(text: string, regex: RegExp): string[] {
    const token1 = text.split(regex);
    const token2 = text.match(regex);
    if (!token2) {
        return token1;
    }
    const token: string[] = [token1[0]];
    for (let i = 0; i < token2.length; i++) {
        token.push(token2[i]);
        token.push(token1[i + 1]);
    }
    return token;
}


interface Parser {
    fetchSnippetsFiles(filetype: string, directory: string): Promise<Set<string>>;
    parse(filetype: string, filepath: string): Promise<{snippets: Snippet[], extendsFilepaths: string[]}>;
}


abstract class ParserBase implements Parser {
    public async fetchSnippetsFiles(filetype: string, directory: string): Promise<Set<string>> {
        if (filetype === '') {
            return new Set();
        }
        const filepaths: Set<string> = new Set();
        const globs: string[] = [];
        for (const extension of this.extensions()) {
            globs.push(
                `${directory}/${filetype}.${extension}`,
                `${directory}/${filetype}-*.${extension}`,
                `${directory}/${filetype}_*.${extension}`,
                `${directory}/${filetype}/*.${extension}`,
            );
        }
        for (const glob of globs) {
            for await (const filepath of expandGlob(glob)) {
                if (filepath.isFile) {
                    filepaths.add(filepath.path);
                }
            }
        }
        return filepaths;
    }

    protected abstract extensions(): string[];

    public abstract parse(filetype: string, filepath: string): Promise<{snippets: Snippet[], extendsFilepaths: string[]}>;
}


class SnipMateParser extends ParserBase {
    public async fetchSnippetsFiles(filetype: string, directory: string): Promise<Set<string>> {
        const filepaths = await super.fetchSnippetsFiles(filetype, directory);
        filepaths.add(`${directory}/_.snippets`);
        return filepaths;
    }

    protected extensions(): string[] {
        return ['snippets'];
    }

    public async parse(_filetype: string, filepath: string): Promise<{snippets: Snippet[], extendsFilepaths: string[]}> {
        let text: string;
        try {
            text = await Deno.readTextFile(filepath);
        } catch (_) {
            return {snippets: [], extendsFilepaths: []};
        }
        const {blocks, extendScopes} = this.splitBlock(text);
        const snippets = blocks.map(block => this.parseBlock(block));
        const extendsFilepaths: string[] = [];
        const directory = (filepath.replace(/\/snippets\/.*?$/, ''));
        for (const scope of extendScopes) {
            extendsFilepaths.push(...await this.fetchSnippetsFiles(scope, directory));
        }
        return {snippets, extendsFilepaths};
    }

    private splitBlock(text: string): {blocks: string[], extendScopes: string[]} {
        const blocks: string[] = [];
        const extendScopes: string[] = [];

        let blockLines: string[] = [];
        const lines = this.removeMeaninglessLines(text.split(/\n/));
        for (const line of lines) {
            if (line.match(/^ *delete/)) {
                console.error('delete:', line);
                continue;
            }
            if (line.match(/^ *extends/)) {
                extendScopes.push(line.replace(/ *extends\s*/, ''));
                continue;
            }
            if (line.match(/^ *include/)) {
                console.error('include:', line);
                continue;
            }
            if (line.match(/^ *source/)) {
                console.error('source:', line);
                continue;
            }
            if (line.match(/^ *snippet/)) {
                if (blockLines.length !== 0) {
                    blocks.push(blockLines.join('\n'));
                }
                blockLines = [line];
                continue;
            }
            if (line.match(/^(\s+|^$)/)) {
                if (blockLines.length !== 0) {
                    blockLines.push(line);
                }
                continue;
            }
            console.error('parse error', line);
        }
        if (blockLines.length !== 0) {
            blocks.push(blockLines.join('\n'));
        }
        return {blocks, extendScopes};
    }

    private removeMeaninglessLines(lines: string[]): string[] {
        const removed: string[] = [];
        for (const line of lines) {
            if (line.match(/(^ *#)/)) {
                continue;
            }
            removed.push(line);
        }
        if (removed[removed.length - 1] === '') {
            removed.pop();
        }
        return removed;
    }

    private parseBlock(snippetBlock: string): Snippet {
        const [head, ...body] = snippetBlock.split(/\n/);
        const trigger = head.match(/(?<=^snippet\s+)\S+/) as RegExpMatchArray;
        const lines: SnippetLine[] = [];
        const tabstops: Set<string> = new Set();
        for (const line of body) {
            lines.push(this.parseLine(line, tabstops));
        }
        const descriptionResult = head.match(/(?<=^snippet\s+\S+\s+)(?:"(.*)"|(.*)$)/);
        if (descriptionResult) {
            const description = descriptionResult[1] ? descriptionResult[1] : descriptionResult[2];
            return new Snippet(trigger[0], description, lines);
        } else {
            return new Snippet(trigger[0], null, lines);
        }
    }

    private parseLine(line: string, tabstops: Set<string>): SnippetLine {
        const tokens: SnippetToken[] = [];
        const indentMatch = line.match(/^(\t*)(.*)$/) as RegExpMatchArray;
        const text = indentMatch[2];
        const indent = Math.max(0, indentMatch[1].length - 1);
        for (let i = 0; i < indent; i++) {
            tokens.push(new IndentToken());
        }
        tokens.push(...this.tokenize(text, tabstops));
        return new SnippetLine(tokens);
    }

    private tokenize(text: string, tabstops: Set<string>): SnippetToken[] {
        text = text.replace(/\${VISUAL(:([^)]*))?}/g, '$2');  // remove ${VISUAL}
        const tokens = [];
        const textAndTabStop = splitByRegex(text, /\${[^}]*}/g);
        for (let i = 0; i < textAndTabStop.length; i++) {
            const tokenText = textAndTabStop[i];
            if (i % 2 === 0) {
                tokens.push(...this.tokenizeText(tokenText));
            } else {
                const match = tokenText.match(/^\$\{([^:]*)(?::(.*))?\}$/) as RegExpMatchArray;
                const tabstopId = match[1];
                if (tabstopId === '0') {
                    tokens.push(new TerminalToken());
                    continue;
                }
                if (!tabstops.has(tabstopId)) {
                    const placeholder = match[2] ? this.tokenizeText(match[2]) : [];
                    tokens.push(new TabStopToken(match[1], placeholder));
                    tabstops.add(tabstopId);
                } else {
                    tokens.push(new MirrorToken(tabstopId));
                }
            }
        }
        return tokens;
    }

    private tokenizeText(text: string): SnippetToken[] {
        const tokens: SnippetToken[] = [];
        const textAndCode = splitByRegex(text, /(?<!\\)`[^`]*(?<!\\)`/g);
        for (let codeI = 0; codeI < textAndCode.length; codeI++) {
            const tokenText = textAndCode[codeI].replace(/\\`/g, '`');
            if (codeI % 2 === 1) {
                const script = tokenText.substring(1, tokenText.length - 1);
                tokens.push(new VimToken(script));
            } else {
                const textAndMirror = splitByRegex(tokenText, /\$\d+/g);
                for (let mirrorI = 0; mirrorI < textAndMirror.length; mirrorI++) {
                    const tokenText = textAndMirror[mirrorI];
                    if (mirrorI % 2 === 0) {
                        tokens.push(new TextToken(tokenText));
                    } else {
                        tokens.push(new MirrorToken(tokenText.substring(1)));
                    }
                }
            }
        }
        return tokens;
    }
}


type VSCodeJsonFormat = Record<string, {
    prefix: string | string[],
    body: string | string[],
    scope?: string,
    description?: string,
}>;


class VSCodeParser extends ParserBase {
    public async fetchSnippetsFiles(filetype: string, directory: string): Promise<Set<string>> {
        const filepaths = await super.fetchSnippetsFiles(filetype, directory);
        const globalGlob = `${directory}/*.code-snippets`;
        for await (const filepath of expandGlob(globalGlob)) {
            if (filepath.isFile) {
                filepaths.add(filepath.path);
            }
        }
        return filepaths;
    }

    protected extensions(): string[] {
        return ['json'];
    }

    public async parse(filetype: string, filepath: string): Promise<{snippets: Snippet[], extendsFilepaths: string[]}> {
        let text: string;
        try {
            text = await Deno.readTextFile(filepath);
        } catch (_) {
            return {snippets: [], extendsFilepaths: []};
        }
        const data: VSCodeJsonFormat = JSONC.parse(text);
        const snippets: Snippet[] = [];
        const isGlobalSnippetFile = filepath.endsWith('.code-snippets');

        for (const {scope, prefix, body, description} of Object.values(data)) {
            if (isGlobalSnippetFile && typeof(scope) === 'string') {
                const scopes = scope.split(',');
                if (!scopes.includes(filetype)) {
                    continue;
                }
            }
            const lines = this.parseBody(this.stringToList(body));
            for (const trigger of this.stringToList(prefix)) {
                if (description) {
                    snippets.push(new Snippet(trigger, description, lines));
                } else {
                    snippets.push(new Snippet(trigger, null, lines));
                }
            }
        }
        return {snippets, extendsFilepaths: []};
    }

    private stringToList(arg: string | string[]): string[] {
        if (typeof(arg) === 'string') {
            return [arg];
        }
        return arg;
    }

    private parseBody(lines: string[]): SnippetLine[] {
        const snippetLines: SnippetLine[] = [];
        const tabstops: Set<string> = new Set();
        for (const line of lines) {
            for (const line2 of line.split('\n')) {
                const tokens: SnippetToken[] = [];
                const indentMatch = line2.match(/^(\t*)(.*)$/) as RegExpMatchArray;
                const text = indentMatch[2];
                const indent = indentMatch[1].length;
                for (let i = 0; i < indent; i++) {
                    tokens.push(new IndentToken());
                }
                tokens.push(...this.tokenize(text, tabstops));
                snippetLines.push(new SnippetLine(tokens));
            }
        }
        return snippetLines;
    }

    private tokenize(text: string, tabstops: Set<string>): SnippetToken[] {
        const tokens: SnippetToken[] = [];
        const textAndTabStop = splitByRegex(text, /\$(?:\d+|{\d+(?:|:[^}]*|\/.*\/.*\/[dgimsuy]*|\|.*\|)})/g);

        for (let i = 0; i < textAndTabStop.length; i++) {
            const tokenText = textAndTabStop[i];
            if (i % 2 === 0) {
                tokens.push(new TextToken(tokenText));
                continue;
            }

            const tokeId = tokenText.replace(/^\D*/, '').replace(/(?<=^\d*)\D.*$/, '');
            if (tokeId === '0') {
                tokens.push(new TerminalToken());
                continue;
            }

            const option = tokenText.replace(/(^\D*\d*|}$)/g, '');
            if (!option) {
                if (tabstops.has(tokeId)) {
                    tokens.push(new MirrorToken(tokeId));
                } else {
                    tokens.push(new TabStopToken(tokeId, []));
                    tabstops.add(tokeId);
                }
                continue;
            }

            const placeholderMatch = option.match('^:(.*)$');
            if (placeholderMatch) {
                const placeholder = this.tokenize(placeholderMatch[1], tabstops);
                tokens.push(new TabStopToken(tokeId, placeholder));
                tabstops.add(tokeId);
                continue;
            }

            const choiceMatch = option.match(/^\|([^,]*(?:,[^,]*)*)\|$/);
            if (choiceMatch) {
                tokens.push(new ChoiceToken(tokeId, choiceMatch[1].split(',')));
                tabstops.add(tokeId);
                continue;
            }

            const transformMatch = option.match(/^\/(.*)\/(.*)\/([dgimsuy]*)$/);
            if (transformMatch) {
                tokens.push(new TransformToken(tokeId, transformMatch[1], transformMatch[2], transformMatch[3]));
                continue;
            }
        }
        return tokens;
    }
}
