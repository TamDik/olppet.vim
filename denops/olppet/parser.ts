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

    public async parseText(text: string): Promise<Snippet[]> {
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

    protected splitBlock(text: string): string[] {
        const blocks = [];
        let blockLines: string[] = [];
        for (const line of text.split(/\n/)) {
            if (line.match(/(^ *#|^$)/)) {
                continue;
            }
            if (line.match(/^ *delete/)) {
                console.log('snippet:', line);
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
            if (line.match(/^\s+/)) {
                blockLines.push(line);
                continue;
            }
            console.error('parse error', line);
        }
        return blocks;
    }

    protected parseBlock(snippetBlock: string): Snippet {
        const [head, ...body] = snippetBlock.split(/\n/);
        const trigger = head.match(/(?<=^snippet\s+)\S+/) as RegExpMatchArray;
        const snippetLine: SnippetLine[] = body.filter(line => !line.startsWith('#'))
                                               .map(line => this.parseLine(line));
        const description = head.match(/(?<=^snippet\s+\S+\s+").*(?=")/);
        return new Snippet(trigger[0], snippetLine, description ? description[0] : null);
    }

    private parseLine(line: string): SnippetLine {
        const tokens = this.tokenize(line);
        return new SnippetLine(tokens);
    }

    private tokenize(line: string): SnippetToken[] {
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
                const placeholder = match[2] ? this.tokenizeMirrorText(match[2]) : [];
                tokens.push(new TabStopToken(match[1], placeholder));
            }
        }
        return tokens;
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
