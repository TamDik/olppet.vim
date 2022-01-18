import { Denops, option, expandGlob, helper, variable } from './deps.ts';
import { bytes } from './util.ts';


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
    private snippets: Snippet[] = [];
    private current: CurrentSnippet | null = null;

    public async registerSnippets(denops: Denops, names: string[]): Promise<void> {
        const runtimepath = (await option.runtimepath.getGlobal(denops)).split(',');
        const parsers = [new SnipMateParser()];
        const parsed: Set<string> = new Set();
        for (const name of new Set(names)) {
            const path = this.snippetNameToPath(name, runtimepath);
            for (const parser of parsers) {
                for (const filepath of await parser.fetchSnippetsFiles(denops, path)) {
                    this.parseSnippet(new SnipMateParser(), filepath, parsed);
                }
            }
        }
    }

    private snippetNameToPath(name: string, runtimepath: string[]): string {
        for (const path of runtimepath) {
            if (path.endsWith('/' + name)) {
                return path;
            }
        }
        return name;
    }

    private async parseSnippet(parser: Parser, filepath: string, parsed: Set<string>): Promise<void> {
        if (parsed.has(filepath)) {
            return;
        }
        parsed.add(filepath);
        const {snippets, extendsFilepaths} = await parser.parse(filepath);
        for (const snippet of snippets) {
            this.snippets.push(snippet);
        }
        for (const extendFilepath of extendsFilepaths) {
            this.parseSnippet(parser, extendFilepath, parsed);
        }
    }

    public leaveSnippet(): void {
        this.current = null;
    }

    public async expand(denops: Denops): Promise<boolean> {
        const line: number = await denops.call('line', '.') as number;
        const col: number = await denops.call('col', '.') as number;
        const currentLine: string = await denops.call('getline', line) as string;
        const head = currentLine.substr(0, col - 1);
        let matched: Snippet | null = null;
        for (const snippet of this.snippets) {
            if (head.match(snippet.pattern)) {
                matched = snippet;
            }
        }
        if (!matched) {
            return false;
        }
        const triggerBytes = bytes(matched.trigger);
        this.current = {
            snippet: matched,
            head: head.substr(0, head.length - triggerBytes),
            tail: currentLine.substr(col - 1),
            lines: [],
            prevLines: [],
            scripts: {},
            entoryPoint: {
                lnum: line,
                col: col - triggerBytes,
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
            this.leaveSnippet();
        } else {
            await this.jumpToFocus(denops);
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
        const col = bytes(this.current.lines[this.current.lines.length]) + 1;
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
        return true;
    }

    public async jumpBackward(denops: Denops): Promise<boolean> {
        if (!this.current) {
            return false;
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
        return true;
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

        // new text of the focused tabstop
        let forcusTabStopTextBuffer = encodeURI(line);
        for (let i = 0, len = focusTabStop.start.col; i < len; i++) {
            forcusTabStopTextBuffer = forcusTabStopTextBuffer.substr(forcusTabStopTextBuffer[0] === '%' ? 3 : 1);
        }
        focusTabStop.text = '';
        for (let i = 0, len = focusTabStop.end.col + delta - focusTabStop.start.col; i < len; i++) {
            focusTabStop.text += forcusTabStopTextBuffer.substr(0, forcusTabStopTextBuffer[0] === '%' ? 3 : 1);
            forcusTabStopTextBuffer = forcusTabStopTextBuffer.substr(forcusTabStopTextBuffer[0] === '%' ? 3 : 1);
        }
        focusTabStop.text = decodeURI(focusTabStop.text);

        await this.updateLines(denops);
    }

    public getCandidates(_denops: Denops): Promise<{word: string, menu?: string}[]> {
        const candidates: {word: string, menu?: string}[] = [];
        for (const snippet of this.snippets) {
            if (snippet.description) {
                candidates.push({word: snippet.trigger, menu: snippet.description});
            } else {
                candidates.push({word: snippet.trigger});
            }
        }
        return Promise.resolve(candidates);
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


class MirrorToken extends SnippetToken {
    constructor(public readonly tokenId: string) {
        super();
    }

    public toText(denops: Denops, current: CurrentSnippet): Promise<string> {
        for (const {token} of current.tabstops) {
            if (token.tokenId === this.tokenId) {
                return token.toText(denops, current);
            }
        }
        return Promise.resolve(this.tokenId);
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


interface Parser {
    fetchSnippetsFiles(denops: Denops, directory: string): Promise<Set<string>>
    parse(filepath: string): Promise<{snippets: Snippet[], extendsFilepaths: string[]}>;
}


class SnipMateParser implements Parser {
    public async fetchSnippetsFiles(denops: Denops, directory: string): Promise<Set<string>> {
        const scopes: Set<string> = new Set([
            await option.filetype.get(denops),
            await option.syntax.get(denops),
        ]);

        const snippetsFilepaths: Set<string> = new Set();
        for (const scope of scopes) {
            for (const filepath of await this.filepathOf(directory, scope)) {
                snippetsFilepaths.add(filepath);
            }
        }
        return snippetsFilepaths;
    }

    private async filepathOf(directory: string, scope: string): Promise<string[]> {
        if (scope === '') {
            return [];
        }
        const filepaths: string[] = [];
        const globs: string[] = [
            `${directory}/snippets/${scope}.snippets`,
            `${directory}/snippets/${scope}_*.snippets`,
            `${directory}/snippets/${scope}/*.snippets`,
            `${directory}/snippets/_.snippets`,
        ];
        for (const glob of globs) {
            for await (const filepath of expandGlob(glob)) {
                if (filepath.isFile) {
                    filepaths.push(filepath.path);
                }
            }
        }
        return filepaths;
    }

    public async parse(filepath: string): Promise<{snippets: Snippet[], extendsFilepaths: string[]}> {
        const text = await Deno.readTextFile(filepath);
        const {blocks, extendScopes} = this.splitBlock(text);
        const snippets = blocks.map(block => this.parseBlock(block));
        const extendsFilepaths: string[] = [];
        const directory = (filepath.replace(/\/snippets\/.*?$/, ''));
        for (const scope of extendScopes) {
            extendsFilepaths.push(...await this.filepathOf(directory, scope));
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
                console.log('delete:', line);
                continue;
            }
            if (line.match(/^ *extends/)) {
                extendScopes.push(line.replace(/ *extends\s*/, ''));
                continue;
            }
            if (line.match(/^ *include/)) {
                console.log('include:', line);
                continue;
            }
            if (line.match(/^ *source/)) {
                console.log('source:', line);
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
        const textAndTabStop = this.splitByRegex(text, /\${[^}]*}/g);
        for (let i = 0; i < textAndTabStop.length; i++) {
            const tokenText = textAndTabStop[i];
            if (i % 2 === 0) {
                tokens.push(...this.tokenizeText(tokenText));
            } else {
                const match = tokenText.match(/^\$\{([^:]*)(?::(.*))?\}$/) as RegExpMatchArray;
                const tabstopId = match[1];
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
        const textAndCode = this.splitByRegex(text, /(?<!\\)`[^`]*(?<!\\)`/g);
        for (let codeI = 0; codeI < textAndCode.length; codeI++) {
            const tokenText = textAndCode[codeI].replace(/\\`/g, '`');
            if (codeI % 2 === 1) {
                const script = tokenText.substr(1, tokenText.length - 2);
                tokens.push(new VimToken(script));
            } else {
                const textAndMirror = this.splitByRegex(tokenText, /\$\d+/g);
                for (let mirrorI = 0; mirrorI < textAndMirror.length; mirrorI++) {
                    const tokenText = textAndMirror[mirrorI];
                    if (mirrorI % 2 === 0) {
                        tokens.push(new TextToken(tokenText));
                    } else {
                        tokens.push(new MirrorToken(tokenText.substr(1)));
                    }
                }
            }
        }
        return tokens;
    }

    private splitByRegex(text: string, regex: RegExp): string[] {
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
}