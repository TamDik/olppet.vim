import { Denops, batch, option, expandGlob } from './deps.ts';
import { Snippet } from './snippet.ts';
import { SnipMateParser } from './parser.ts';
import { Config } from './types.ts';


export class SnippetEngine {
    private readonly snippet_directories: string[] = [];
    private readonly snippets: Map<string, Snippet> = new Map();
    private filetype = '';

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
        const escapedKey = escape(key);
        return `inoremap <silent> ${key} <C-c>:call denops#request('olppet', '${method}', ['${escapedKey}'])<CR>`;
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
                const text = await Deno.readTextFile(snippetPath);
                const parser = new SnipMateParser();
                const snippets = parser.parse(text);
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

        const globs: string[] = [];
        for (const scope of scopes) {
            globs.push(`${directory}/snippets/${scope}.snippets`);
            globs.push(`${directory}/snippets/${scope}_*.snippets`);
            globs.push(`${directory}/snippets/${scope}/*.snippets`);
        }

        const snippetsFilepath = [];
        for (const glob of globs) {
            for await (const filepath of expandGlob(glob)) {
                if (filepath.isFile) {
                    snippetsFilepath.push(filepath.path);
                }
            }
        }
        return snippetsFilepath;
    }

    public async expand(denops: Denops, escapedKey: string): Promise<void> {
        await this.loadSnippetsIfNeeds(denops);

        const line: number = await denops.call('line', "'^") as number;
        const col: number = await denops.call('col', "'^") as number;
        const currentLine: string = await denops.call('getline', line) as string;
        const head = currentLine.substr(0, col - 1);
        const tail = currentLine.substr(col - 1);
        const triggerMatch = head.match(/(?<=(?:\s|^))[a-zA-Z]+$/);
        const tabstop: number = await option.tabstop.get(denops);

        batch(denops, async (denops) => {
            if (triggerMatch) {
                const trigger = triggerMatch[0];
                const snippet = this.snippets.get(trigger);
                if (snippet) {
                    const snippetLines = snippet.toText(col - trigger.length - 1, tabstop);
                    for (let i = 0; i < snippetLines.length; i++) {
                        const snippetLine = snippetLines[i];
                        if (i === 0) {
                            const firstLine = head.substr(0, head.length - trigger.length) + snippetLine;
                            await denops.call('setline', line, firstLine);
                        } else {
                            await denops.call('append', line + i - 1, snippetLine);
                        }
                    }
                    await denops.call('feedkeys', col === 1 ? 'i' : 'a');
                    return;
                }
            }

            const key = unescape(escapedKey);
            const defaultText = key === '\t' ? ' '.repeat(tabstop) : key;
            await denops.call('setline', line, head + defaultText + tail);
            await denops.call('feedkeys', `${defaultText.length}la`);
        });
    }

    public async jumpForward(denops: Denops, escapedKey: string): Promise<void> {
        console.log('jumpForward');
    }

    public async jumpBackward(denops: Denops, escapedKey: string): Promise<void> {
        console.log('jumpBackward');
    }

    public async getAllTargets(denops: Denops): Promise<string[]> {
        await this.loadSnippetsIfNeeds(denops);
        return Array.from(this.snippets.keys());
    }
}
