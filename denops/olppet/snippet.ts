export class Snippet {
    private currentTabstop: TabStopToken | null = null;
    private tabstops;
    public constructor(public readonly trigger: string,
                       private readonly lines: SnippetLine[],
                       public readonly description: string|null,
                       private top_: number=0,
                       private left: number=0) {
        this.tabstops = this.lines.map(line => line.getTabstops())
    }

    public getNextTabstopPosition(): {lnum: number, col: number} | null {
        const nextTabstop = this.getNextTabstop();
        if (!nextTabstop) {
            return null;
        }
        const [line, tabstop] = nextTabstop;
        this.currentTabstop = tabstop;
        const lnum = this.top_ + line;
        const col = this.left + this.getCursorCol(tabstop, line);
        return {lnum, col};
    }

    public getPrevTabstopPosition(): {lnum: number, col: number} | null {
        const prevTabstop = this.getPrevTabstop();
        if (!prevTabstop) {
            return null;
        }
        const [line, tabstop] = prevTabstop;
        this.currentTabstop = tabstop;
        return {lnum: this.top_ + line, col: this.getCursorCol(tabstop, line)};
    }

    private getNextTabstop(): [number, TabStopToken] | null {
        return this.getFirstTabstop(this.tabstops);
    }

    private getPrevTabstop(): [number, TabStopToken] | null {
        const result = this.getFirstTabstop([...this.tabstops].reverse());
        if (!result) {
            return null;
        }
        const [line, tabstop] = result;
        return [this.tabstops.length - line - 1, tabstop];
    }

    private getFirstTabstop(targets: TabStopToken[][]): [number, TabStopToken] | null {
        let firstTabstop: [number, TabStopToken] | null = null;
        let passed = false;
        let line = 0;
        for (const tabstops of targets) {
            for (const tabstop of tabstops) {
                if (!this.currentTabstop || passed) {
                    return [line, tabstop];
                }
                if (!firstTabstop) {
                    firstTabstop = [line, tabstop];
                }
                passed = tabstop.tokenId === this.currentTabstop.tokenId;
            }
            line++;
        }
        return firstTabstop;
    }

    private getCursorCol(tabstop: TabStopToken, line: number): number {
        let col = 0;
        const tokens = this.lines[line].tokens;
        for (const token of tokens) {
            if (token.hasToken(tabstop)) {
                col += token.getCursorCol(tabstop);
                break;
            }
            col += token.toText().length;
        }
        return col;
    }

    public toText(): string[] {
        return this.lines.map(line => line.toText(this.left));
    }

    public createEmpty(tabstop: number, top_: number, left: number): Snippet {
        const lines = this.lines.map(line => line.createEmpty(tabstop));
        return new Snippet(this.trigger, lines, this.description, top_, left);
    }
}


export class SnippetLine {
    public constructor(public readonly tokens: SnippetToken[]) {
    }

    public getTabstops(): TabStopToken[] {
        const tokens: TabStopToken[] = [];
        for (const token of this.tokens) {
            if (token instanceof TabStopToken) {
                tokens.push(token);
            }
        }
        return tokens;
    }

    public toText(left: number): string {
        const text = this.tokens.map(token => token.toText()).join('');
        return ' '.repeat(left) + text;
    }

    public createEmpty(tabstop: number): SnippetLine {
        const tokens = this.tokens.map(token => token.createEmpty(tabstop));
        return new SnippetLine(tokens);
    }
}


export abstract class SnippetToken {
    public constructor(protected readonly tabstop: number) {
    }

    public getCursorCol(_targetToken: SnippetToken): number {
        return this.toText().length;
    }

    public abstract toText(): string;
    public abstract createEmpty(tabstop: number): SnippetToken;
    public abstract hasToken(token: SnippetToken): boolean;
}


export class IndentToken extends SnippetToken {
    public constructor(tabstop=0) {
        super(tabstop);
    }

    public toText(): string {
        return ' '.repeat(this.tabstop);
    }

    public createEmpty(tabstop: number): IndentToken {
        return new IndentToken(tabstop);
    }

    public hasToken(token: SnippetToken): boolean {
        return token === this;
    }
}


export class TextToken extends SnippetToken {
    public constructor(private readonly text: string, tabstop=0) {
        super(tabstop);
    }

    public toText(): string {
        return this.text;
    }

    public createEmpty(tabstop: number): TextToken {
        return new TextToken(this.text, tabstop);
    }

    public hasToken(token: SnippetToken): boolean {
        return token === this;
    }
}


export class TabStopToken extends SnippetToken {
    private inputText: string | null = null;
    public constructor(public readonly tokenId: string,
                       private readonly placeholder: SnippetToken[],
                       tabstop=0) {
        super(tabstop);
    }

    public toText(): string {
        if (this.inputText) {
            return this.inputText;
        }
        return this.placeholder.map(token => token.toText()).join('');
    }

    public createEmpty(tabstop: number): TabStopToken {
        const placeholder = this.placeholder.map(token => token.createEmpty(tabstop));
        return new TabStopToken(this.tokenId, placeholder, tabstop);
    }

    public hasToken(token: SnippetToken): boolean {
        if (token === this) {
            return true;
        }
        for (const t of this.placeholder) {
            if (t.hasToken(token)) {
                return true;
            }
        }
        return false;
    }

    public getCursorCol(targetToken: SnippetToken): number {
        if (targetToken === this) {
            if (this.inputText) {
                return this.toText().length;
            }
            return 0;
        }
        let col = 0;
        for (const t of this.placeholder) {
            if (t.hasToken(targetToken)) {
                col += t.getCursorCol(targetToken);
                break;
            }
            col += t.toText().length;
        }
        return col;
    }
}


export class MirrorToken extends SnippetToken {
    public constructor(public readonly tokenId: string, tabstop=0) {
        super(tabstop);
    }

    public toText(): string {
        return `[mirror-${this.tokenId}]`;
    }

    public createEmpty(tabstop: number): MirrorToken {
        return new MirrorToken(this.tokenId, tabstop);
    }

    public hasToken(token: SnippetToken): boolean {
        return token === this;
    }
}
