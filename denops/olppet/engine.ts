import { Denops, batch, option } from './deps.ts';
import { Snippet, Position } from './snippet.ts';
import { SnipMateParser } from './parser.ts';
import { Config } from './types.ts';


export class SnippetEngine {
    private readonly snippet_directories: string[] = [];
    private readonly snippets: Map<string, Snippet> = new Map();
    private filetype = '';
    private currentSnippet: Snippet | null = null;

    public async setConfig(denops: Denops, config: Config): Promise<void> {
        await this.setSnippetConfig(denops, config);
        await this.setMappingConfig(denops, config);
    }

    private async setSnippetConfig(denops: Denops, config: Config): Promise<void> {
        for (const snippetPath of config.snippet) {
            const directoryPath = await this.expandRepoDirectory(denops, snippetPath);
            if (directoryPath) {
                this.snippet_directories.push(directoryPath);
            } else {
                this.snippet_directories.push(snippetPath);
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
        await batch(denops, async (denops) => {
            for (const key of config.expand) {
                await denops.cmd(this.olppetMapping(denops, key, 'expand'));
            }
            for (const key of config.jump_forward) {
                await denops.cmd(this.olppetMapping(denops, key, 'jumpForward'));
            }
            for (const key of config.jump_backward) {
                await denops.cmd(this.olppetMapping(denops, key, 'jumpBackward'));
            }
        });
    }

    private olppetMapping(denops: Denops, key: string, method: 'expand'|'jumpForward'|'jumpBackward'): string {
        return `inoremap <silent> ${key} <C-c>:call denops#request('${denops.name}', '${method}', [])<CR>`;
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
        for (const directoryPath of this.snippet_directories) {
            for (const snippetPath of await this.fetchSnippetsFiles(denops, directoryPath)) {
                const parser = new SnipMateParser(snippetPath, directoryPath);
                const snippets = await parser.parse();
                for (const snippet of snippets) {
                    this.snippets.set(snippet.trigger, snippet);
                }
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

    public async expand(denops: Denops): Promise<void> {
        await this.loadSnippetsIfNeeds(denops);
        const insertResult = await this.insertSnippet(denops);
        if (insertResult) {
            this.currentSnippet = insertResult;
            await this.moveCursorToTheFirstTabStop(denops, this.currentSnippet);
            await this.currentSnippet.executeVimScript(denops);
            await this.updateWithSnippetLines(denops, this.currentSnippet);
            const {col} = await this.moveCursorToTheFirstTabStop(denops, this.currentSnippet);
            if (!this.currentSnippet.hasTabStop()) {
                this.currentSnippet = null;
            }
            await denops.call('feedkeys', col === 0 ? 'i' : 'a');
        } else {
            const col: number = await denops.call('col', "'^") as number;
            await denops.call('feedkeys', col === 1 ? 'i' : 'a');
        }
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
        const triggerMatch = head.match(/(?<=(?:\s|^))\S+$/);

        if (!triggerMatch) {
            return null;
        }
        const trigger = triggerMatch[0];
        const snippet = this.snippets.get(trigger);
        if (!snippet) {
            return null;
        }
        const tabstop: number = await option.tabstop.get(denops);
        const emptySnippet = snippet.createEmpty(tabstop, line, head.substr(0, head.length - trigger.length));
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

    public async jumpForward(denops: Denops): Promise<void> {
        if (this.currentSnippet && this.currentSnippet.goForward()) {
            const {lnum, col} = this.currentSnippet.getCurrentTabStopPosition();
            await denops.call('cursor', lnum, Math.max(1, col));
            await denops.call('feedkeys', col === 0 ? 'i' : 'a')
        } else {
            const col: number = await denops.call('col', "'^") as number;
            await denops.call('feedkeys', col === 1 ? 'i' : 'a');
        }
    }

    public async jumpBackward(denops: Denops): Promise<void> {
        if (this.currentSnippet && this.currentSnippet.goBack()) {
            const {lnum, col} = this.currentSnippet.getCurrentTabStopPosition();
            await denops.call('cursor', lnum, col);
        }
        await denops.call('feedkeys', 'a');
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
        for (const [trigger, snippet] of this.snippets) {
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
