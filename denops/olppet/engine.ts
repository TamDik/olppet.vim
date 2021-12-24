import { Denops, batch, option } from './deps.ts';
import { Snippet, Position } from './snippet.ts';
import { SnipMateParser } from './parser.ts';
import { Config } from './types.ts';


type SnippetAction = 'expand' | 'jumpForward' | 'jumpBackward';

export class SnippetEngine {
    private readonly snippetDirectories: string[] = [];
    public readonly loadedSnippetFilePaths: string[] = [];
    private readonly snippets: Map<string, {snippet: Snippet, pattern: RegExp}> = new Map();
    private filetype = '';
    private currentSnippet: Snippet | null = null;
    private readonly mapping: Map<string, SnippetAction[]> = new Map();

    public async setConfig(denops: Denops, config: Config): Promise<void> {
        await this.setSnippetConfig(denops, config);
        await this.setMappingConfig(denops, config);
    }

    private async setSnippetConfig(denops: Denops, config: Config): Promise<void> {
        for (const snippetPath of config.snippet) {
            const directoryPath = await this.expandRepoDirectory(denops, snippetPath);
            if (directoryPath) {
                this.snippetDirectories.push(directoryPath);
            } else {
                this.snippetDirectories.push(snippetPath);
            }
        }
    }

    private async expandRepoDirectory(denops: Denops, repo: string): Promise<string|null> {
        const runtimepath = await option.runtimepath.getGlobal(denops);
        for (const path of runtimepath.split(',')) {
            if (path.endsWith('/' + repo)) {
                return path;
            }
        }
        return null;
    }

    private async setMappingConfig(denops: Denops, config: Config): Promise<void> {
        for (const key of config.expand) {
            if (!this.mapping.has(key)) {
                this.mapping.set(key, []);
            }
            this.mapping.get(key)!.push('expand');
        }
        for (const key of config.jump_forward) {
            if (!this.mapping.has(key)) {
                this.mapping.set(key, []);
            }
            this.mapping.get(key)!.push('jumpForward');
        }
        for (const key of config.jump_backward) {
            if (!this.mapping.has(key)) {
                this.mapping.set(key, []);
            }
            this.mapping.get(key)!.push('jumpBackward');
        }
        await batch(denops, async (denops) => {
            for (const key of this.mapping.keys()) {
                await denops.cmd(this.olppetMapping(denops, key));
            }
        });
    }

    private olppetMapping(denops: Denops, key: string): string {
        const escapedKey = escape(key);
        return `inoremap <silent> ${key} _<C-h><C-c>:call denops#request('${denops.name}', 'snippetAction', ['${escapedKey}'])<CR>`;
    }

    public async snippetAction(denops: Denops, escapedKey: string): Promise<void> {
        const key = unescape(escapedKey);
        const actions = this.mapping.get(key);
        if (!actions) {
            return;
        }
        if (actions.includes('expand')) {
            if (await this.expand(denops)) {
                return;
            }
        }
        if (actions.includes('jumpForward')) {
            if (await this.jumpForward(denops)) {
                return;
            }
        }
        if (actions.includes('jumpBackward')) {
            if (await this.jumpBackward(denops)) {
                return;
            }
        }
        const col: number = await denops.call('col', "'^") as number;
        let feedkeys = col === 1 ? 'i' : 'a';
        // tab behavior
        if (key.toLowerCase() === '<tab>') {
            feedkeys += '\t';
        }
        await denops.call('feedkeys', feedkeys, 'n');
    }

    private async loadSnippetsIfNeeds(denops: Denops): Promise<void> {
        const filetype = await option.filetype.get(denops);
        if (filetype === this.filetype) {
            return;
        }
        this.filetype = filetype;
        await this.loadSnippets(denops);
    }

    private async loadSnippets(denops: Denops): Promise<void> {
        this.snippets.clear();
        this.loadedSnippetFilePaths.length = 0;
        for (const directoryPath of this.snippetDirectories) {
            for (const snippetPath of await this.fetchSnippetsFiles(denops, directoryPath)) {
                const parser = new SnipMateParser(snippetPath, directoryPath);
                const snippets = await parser.parse();
                for (const snippet of snippets) {
                    const escaped = snippet.trigger.replace(/[.*+?^=!:${}()|[\]\/\\]/g, '\\$&');
                    const pattern = new RegExp('(?<!\\w)' + escaped + '$');
                    this.snippets.set(snippet.trigger, {snippet, pattern});
                }
                this.loadedSnippetFilePaths.push(...parser.getFilepaths());
            }
        }
    }

    private async fetchSnippetsFiles(denops: Denops, directory: string): Promise<string[]> {
        const scopes: Set<string> = new Set([
            await option.filetype.get(denops),
            await option.syntax.get(denops),
        ]);
        const snippetsFilepath = [];
        for (const scope of scopes) {
            snippetsFilepath.push(...await SnipMateParser.fetchSnippetsFiles(directory, scope));
        }
        return snippetsFilepath;
    }

    private async expand(denops: Denops): Promise<boolean> {
        if (this.currentSnippet) {
            const text = this.currentSnippet.getCurrentTabStopText();
            if (text === null || text === '') {
                return false;
            }
        }

        await this.loadSnippetsIfNeeds(denops);
        const insertResult = await this.insertSnippet(denops);
        if (!insertResult) {
            return false;
        }
        this.currentSnippet = insertResult;
        await this.moveCursorToTheFirstTabStop(denops, this.currentSnippet);
        await this.currentSnippet.executeVimScript(denops);
        await this.updateWithSnippetLines(denops, this.currentSnippet);
        await this.moveCursorToTheFirstTabStop(denops, this.currentSnippet);
        if (!this.currentSnippet.hasTabStop()) {
            this.currentSnippet = null;
        }
        const col: number = await denops.call('col', '.') as number;
        await denops.call('feedkeys', col === 1 ? 'i' : 'a');
        return true;
    }

    private async moveCursorToTheFirstTabStop(denops: Denops, snippet: Snippet): Promise<Position> {
        let cursor: Position;
        if (snippet.hasTabStop()) {
            cursor = snippet.getCurrentTabStopPosition();
        } else {
            cursor = snippet.getEndPosition();
        }
        await denops.call('cursor', cursor.lnum, Math.max(1, cursor.col));
        return cursor;
    }

    private async insertSnippet(denops: Denops): Promise<Snippet | null> {
        const line: number = await denops.call('line', "'^") as number;
        const col: number = await denops.call('col', "'^") as number;
        const currentLine: string = await denops.call('getline', line) as string;
        const head = currentLine.substr(0, col - 1);
        let matched: Snippet | null = null;
        for (const {snippet, pattern} of this.snippets.values()) {
            if (head.match(pattern)) {
                matched = snippet;
            }
        }
        if (!matched) {
            return null;
        }
        const tabstop: number = await option.tabstop.get(denops);
        const tail = currentLine.substr(col - 1);
        const emptySnippet = matched.createEmpty(tabstop, line, head.substr(0, head.length - matched.trigger.length), tail);
        const snippetLines = emptySnippet.toText();
        for (let i = 0; i < snippetLines.length; i++) {
            const snippetLine = snippetLines[i];
            if (i === 0) {
                await denops.call('setline', line, snippetLine);
            } else {
                await denops.call('append', line + i - 1, snippetLine);
            }
        }
        return emptySnippet;
    }

    private async jumpForward(denops: Denops): Promise<boolean> {
        if (this.currentSnippet && this.currentSnippet.goForward()) {
            const {lnum, col} = this.currentSnippet.getCurrentTabStopPosition();
            await denops.call('cursor', lnum, Math.max(1, col));
            await denops.call('feedkeys', col === 0 ? 'i' : 'a');
            return true;
        } else {
            return false;
        }
    }

    private async jumpBackward(denops: Denops): Promise<boolean> {
        if (this.currentSnippet && this.currentSnippet.goBack()) {
            const {lnum, col} = this.currentSnippet.getCurrentTabStopPosition();
            await denops.call('cursor', lnum, Math.max(1, col));
            await denops.call('feedkeys', col === 0 ? 'i' : 'a');
            return true;
        } else {
            return false;
        }
    }

    public leaveInsertMode(): void {
        this.currentSnippet = null;
    }

    public async textChanged(denops: Denops): Promise<void> {
        if (!this.currentSnippet) {
            return;
        }
        const currentPos = this.currentSnippet.getCurrentTabStopPosition();
        const col: number = await denops.call('col', ".") as number;
        const moved = col - currentPos.col - 1;
        if (moved === 0) {
            return;
        }
        const lnum: number = await denops.call('line', '.') as number;
        if (currentPos.lnum !== lnum) {
            this.currentSnippet = null;
            return;
        }
        const line: string = await denops.call('getline', '.') as string;
        const text = this.currentSnippet.getCurrentTabStopText();

        if (moved > 0) {
            // add
            let newText = line.substr(currentPos.col, moved);
            if (text) {
                newText = text + newText;
            }
            this.currentSnippet.setCurrentTabStopText(newText);
        } else if (text !== null && text.length >= -moved) {
            // remove
            const newText = text.substr(0, text.length + moved);
            this.currentSnippet.setCurrentTabStopText(newText);
        } else {
            // over
            this.currentSnippet = null;
            return;
        }

        // update
        await this.updateWithSnippetLines(denops, this.currentSnippet);
    }

    private async updateWithSnippetLines(denops: Denops, snippet: Snippet): Promise<void> {
        const snippetLines = snippet.toText();
        const {lnum} = snippet.getStartPosition();
        for (let i = 0; i < snippetLines.length; i++) {
            const snippetLine = snippetLines[i];
            await denops.call('setline', lnum + i, snippetLine);
        }
    }

    public async getCandidates(denops: Denops): Promise<{word: string, menu?: string}[]> {
        await this.loadSnippetsIfNeeds(denops);
        const candidates = [];
        for (const [trigger, {snippet}] of this.snippets) {
            let candidate;
            if (snippet.description) {
                candidate = {word: trigger, menu: snippet.description};
            } else {
                candidate = {word: trigger};
            }
            candidates.push(candidate);
        }
        return candidates;
    }
}
