import { expandGlob } from './deps.ts';
import { Snippet, SnippetLine, SnippetToken, IndentToken, TabStopToken, TextToken, MirrorToken } from './snippet.ts';


abstract class Parser {
    public constructor(protected readonly filepath: string) {
    }

    public async parse(): Promise<Snippet[]> {
        const text = await Deno.readTextFile(this.filepath);
        return this.parseText(text);
    }

    protected abstract parseText(text: string): Promise<Snippet[]>;
}


export class SnipMateParser extends Parser {
    private extends: string[] = [];
    public constructor(filepath: string, private readonly directory: string) {
        super(filepath);
    }

    public static async fetchSnippetsFiles(directory: string, scope: string): Promise<string[]> {
        const globs: string[] = [
            `${directory}/snippets/${scope}.snippets`,
            `${directory}/snippets/${scope}_*.snippets`,
            `${directory}/snippets/${scope}/*.snippets`,
        ];

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

    protected async parseText(text: string): Promise<Snippet[]> {
        const snippetBlocks = this.splitBlock(text);
        const snippets = snippetBlocks.map(snippetBlock => this.parseBlock(snippetBlock));

        // extends
        for (const extend of this.extends) {
            for (const filepath of await SnipMateParser.fetchSnippetsFiles(this.directory, extend)) {
                const parser = new SnipMateParser(filepath, this.directory);
                snippets.push(...await parser.parse());
            }
        }

        return snippets;
    }

    private splitBlock(text: string): string[] {
        const blocks = [];
        let blockLines: string[] = [];
        const lines = this.removeMeaninglessLines(text.split(/\n/));
        for (const line of lines) {
            if (line.match(/^ *delete/)) {
                console.log('delete:', line);
                continue;
            }
            if (line.match(/^ *extends/)) {
                this.extends.push(line.replace(/ *extends\s*/, ''));
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
                    blocks.push(blockLines.join('\n'))
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
            blocks.push(blockLines.join('\n'))
        }
        return blocks;
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
        const snippetLine: SnippetLine[] = [];
        const tabstops: Set<string> = new Set();
        for (const line of body) {
            snippetLine.push(this.parseLine(line, tabstops));
        }
        const description = head.match(/(?<=^snippet\s+\S+\s+").*(?=")/);
        return new Snippet(trigger[0], snippetLine, description ? description[0] : null);
    }

    private parseLine(line: string, tabstops: Set<string>): SnippetLine {
        const tokens: SnippetToken[] = [];

        const indentMatch = line.match(/^(\t*)(.*)$/) as RegExpMatchArray;
        const text = indentMatch[2];
        const indent = Math.max(0, indentMatch[1].length - 1);
        for (let i = 0; i < indent; i++) {
            tokens.push(new IndentToken());
        }

        const textAndTabStop = this.splitByRegex(text, /\${[^}]*}/g);
        for (let i = 0; i < textAndTabStop.length; i++) {
            if (i % 2 === 0) {
                const textText = textAndTabStop[i];
                tokens.push(...this.tokenizeMirrorText(textText));
            } else {
                const tabStopText = textAndTabStop[i];
                const match = tabStopText.match(/^\$\{([^:]*)(?::(.*))?\}$/) as RegExpMatchArray;
                const tabstopId = match[1];
                if (!tabstops.has(tabstopId)) {
                    const placeholder = match[2] ? this.tokenizeMirrorText(match[2]) : [];
                    tokens.push(new TabStopToken(match[1], placeholder));
                    tabstops.add(tabstopId);
                } else {
                    tokens.push(new MirrorToken(match[1]));
                }
            }
        }
        return new SnippetLine(tokens);
    }

    private tokenizeMirrorText(tokenText: string): SnippetToken[] {
        const tokens: SnippetToken[] = [];
        const textAndMirror = this.splitByRegex(tokenText, /\$\d+/g);
        for (let j = 0; j < textAndMirror.length; j++) {
            const text = textAndMirror[j];
            if (j % 2 === 0) {
                tokens.push(new TextToken(text));
            } else {
                tokens.push(new MirrorToken(text.substr(1)));
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
