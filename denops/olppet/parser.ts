import { Snippet, SnippetLine, SnippetToken, SnippetIndentToken, SnippetTabStopToken, SnippetTextToken, SnippetMirrorToken } from './snippet.ts';

abstract class Parser {
    public parse(text: string): Snippet[] {
        const snippetBlocks = this.splitBlock(text);
        return snippetBlocks.map(snippetBlock => this.parseBlock(snippetBlock));
    }
    protected abstract splitBlock(text: string): string[];
    protected abstract parseBlock(snippetBlock: string): Snippet;
}


export class SnipMateParser extends Parser {
    protected splitBlock(text: string): string[] {
        const blocks = [];
        let blockLines: string[] = [];
        for (const line of text.split(/\n/)) {
            if (line.match(/(^\s*#|^$)/)) {
                continue;
            }
            if (line.match(/^\s*delete/)) {
                console.log('snippet:', line);
                continue;
            }
            if (line.match(/^\s*extends/)) {
                console.log('extends:', line);
                continue;
            }
            if (line.match(/^\s*include/)) {
                console.log('include:', line);
                continue;
            }
            if (line.match(/^\s*source/)) {
                console.log('source:', line);
                continue;
            }
            if (line.match(/^\s*snippet/)) {
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
        const description = head.match(/(?<=^snippet\s+\S+\s+).*$/)
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
            tokens.push(new SnippetIndentToken());
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
                tokens.push(new SnippetTabStopToken(match[1], placeholder));
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
                tokens.push(new SnippetTextToken(text));
            } else {
                tokens.push(new SnippetMirrorToken(text.substr(1)));
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
