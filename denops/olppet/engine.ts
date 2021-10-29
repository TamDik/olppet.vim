import { Denops, batch, option, expandGlob } from './deps.ts';
import { Snippet } from './snippet.ts';
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
                await denops.cmd(this.olppetMapping(key, 'expand'));
            }
            for (const key of config.jump_forward) {
                await denops.cmd(this.olppetMapping(key, 'jumpForward'));
            }
            for (const key of config.jump_backward) {
                await denops.cmd(this.olppetMapping(key, 'jumpBackward'));
            }
        });
    }

    private olppetMapping(key: string, method: 'expand'|'jumpForward'|'jumpBackward'): string {
        return `inoremap <silent> ${key} <C-c>:call denops#request('olppet', '${method}', [])<CR>`;
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
            await this.moveTo(denops, 'next');
            await denops.call('feedkeys', 'a');
        } else {
            const col: number = await denops.call('col', "'^") as number;
            await denops.call('feedkeys', col === 1 ? 'i' : 'a');
        }
    }

    private async insertSnippet(denops: Denops): Promise<boolean> {
        const line: number = await denops.call('line', "'^") as number;
        const col: number = await denops.call('col', "'^") as number;
        const currentLine: string = await denops.call('getline', line) as string;
        const head = currentLine.substr(0, col - 1);
        const triggerMatch = head.match(/(?<=(?:\s|^))\S+$/);

        if (!triggerMatch) {
            return false;
        }
        const trigger = triggerMatch[0];
        const snippet = this.snippets.get(trigger);
        if (!snippet) {
            return false;
        }
        const tabstop: number = await option.tabstop.get(denops);
        this.currentSnippet = snippet.createEmpty(tabstop, line, col - trigger.length - 1);
        const snippetLines = this.currentSnippet.toText();
        for (let i = 0; i < snippetLines.length; i++) {
            const snippetLine = snippetLines[i];
            if (i === 0) {
                const firstLine = head.substr(0, -trigger.length) + snippetLine;
                await denops.call('setline', line, firstLine);
            } else {
                await denops.call('append', line + i - 1, snippetLine);
            }
        }
        return true;
    }

    public async jumpForward(denops: Denops): Promise<void> {
        await this.moveTo(denops, 'next');
        await denops.call('feedkeys', 'a');
    }

    public async jumpBackward(denops: Denops): Promise<void> {
        await this.moveTo(denops, 'prev');
        await denops.call('feedkeys', 'a');
    }

    private async moveTo(denops: Denops, tabstop: 'next' | 'prev'): Promise<void> {
        if (!this.currentSnippet) {
            return;
        }
        let position;
        if (tabstop === 'next') {
            position = this.currentSnippet.getNextTabStopPosition();
        } else {
            position = this.currentSnippet.getPrevTabStopPosition();
        }
        if (!position) {
            return;
        }
        const {lnum, col} = position;
        await denops.call('cursor', lnum, col);
    }

    public leaveInsertMode(): void {
        this.currentSnippet = null;
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
