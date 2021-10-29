export class Snippet {
    private walked = false;
    private currentTabStop: TabStopToken | null = null;
    private readonly tabStops: TabStopToken[][] = [];
    public constructor(public readonly trigger: string,
                       private readonly lines: SnippetLine[],
                       public readonly description: string|null,
                       private top_: number=0,
                       private left: number=0) {
    }

    private walkTokens(): void {
        if (this.walked) {
            return;
        }
        this.walked = true;

        function isTabStop(token: SnippetToken): token is TabStopToken {
            return token instanceof TabStopToken;
        }
        function isMirror(token: SnippetToken): token is MirrorToken {
            return token instanceof MirrorToken;
        }
        const mirrorTokens: MirrorToken[] = [];
        for (const line of this.lines) {
            this.tabStops.push(line.getTokens(isTabStop));
            mirrorTokens.push(...line.getTokens(isMirror));
        }

        for (const tabStop of this.tabStops.flat()) {
            for (const mirrorToken of mirrorTokens) {
                if (mirrorToken.tokenId === tabStop.tokenId) {
                    mirrorToken.setTargetTabStopToken(tabStop);
                }
            }
        }
    }

    public getNextTabStopPosition(): {lnum: number, col: number} | null {
        this.walkTokens();
        const nextTabStop = this.getNextTabStop();
        if (!nextTabStop) {
            return null;
        }
        const [line, tabStop] = nextTabStop;
        this.currentTabStop = tabStop;
        const lnum = this.top_ + line;
        const col = this.left + this.getCursorCol(tabStop, line);
        return {lnum, col};
    }

    public getPrevTabStopPosition(): {lnum: number, col: number} | null {
        this.walkTokens();
        const prevTabStop = this.getPrevTabStop();
        if (!prevTabStop) {
            return null;
        }
        const [line, tabStop] = prevTabStop;
        this.currentTabStop = tabStop;
        return {lnum: this.top_ + line, col: this.getCursorCol(tabStop, line)};
    }

    public getEndPosition(): {lnum: number, col: number} {
        const lnum = this.top_ + this.lines.length - 1;
        const col = this.lines[this.lines.length - 1].toText(this.left).length;
        return {lnum, col};
    }

    private getNextTabStop(): [number, TabStopToken] | null {
        return this.getAfterTheCurrentTabStop(this.tabStops);
    }

    private getPrevTabStop(): [number, TabStopToken] | null {
        const reversed: TabStopToken[][] = [];
        for (const tabStops of [...this.tabStops].reverse()) {
            reversed.push([...tabStops].reverse());
        }
        const result = this.getAfterTheCurrentTabStop(reversed);
        if (!result) {
            return null;
        }
        const [line, tabStop] = result;
        return [this.tabStops.length - line - 1, tabStop];
    }

    private getAfterTheCurrentTabStop(targets: TabStopToken[][]): [number, TabStopToken] | null {
        let firstTabStop: [number, TabStopToken] | null = null;
        let passed = false;
        let line = 0;
        for (const tabStops of targets) {
            for (const tabStop of tabStops) {
                if (!this.currentTabStop || passed) {
                    return [line, tabStop];
                }
                if (!firstTabStop) {
                    firstTabStop = [line, tabStop];
                }
                passed = tabStop.tokenId === this.currentTabStop.tokenId;
            }
            line++;
        }
        return firstTabStop;
    }

    private getCursorCol(tabStop: TabStopToken, line: number): number {
        let col = 0;
        const tokens = this.lines[line].tokens;
        for (const token of tokens) {
            if (token.hasToken(tabStop)) {
                col += token.getCursorCol(tabStop);
                break;
            }
            col += token.toText().length;
        }
        return col;
    }

    public toText(): string[] {
        this.walkTokens();
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

    public getTokens<T extends SnippetToken>(isTargetToken: (token: SnippetToken) => token is T): T[] {
        const tokens: T[] = [];
        for (const token of this.tokens) {
            tokens.push(...token.getTokens(isTargetToken));
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

    public getTokens<T extends SnippetToken>(isTargetToken: (token: SnippetToken) => token is T): T[] {
        if (isTargetToken(this)) {
            return [this];
        }
        return [];
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
        if (this.placeholder.length === 0) {
            return `$\{${this.tokenId}}`;
        }
        return this.placeholder.map(token => token.toText()).join('');
    }

    public createEmpty(tabstop: number): TabStopToken {
        const placeholder = this.placeholder.map(token => token.createEmpty(tabstop));
        return new TabStopToken(this.tokenId, placeholder, tabstop);
    }

    public getTokens<T extends SnippetToken>(isTargetToken: (token: SnippetToken) => token is T): T[] {
        const tokens: T[] = [];
        if (isTargetToken(this)) {
            tokens.push(this);
        }
        for (const t of this.placeholder) {
            tokens.push(...t.getTokens(isTargetToken))
        }
        return tokens;
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
    private targetTabStopToken: TabStopToken | null = null;
    public constructor(public readonly tokenId: string, tabstop=0) {
        super(tabstop);
    }

    public setTargetTabStopToken(token: TabStopToken): void {
        this.targetTabStopToken = token;
    }

    public toText(): string {
        if (this.targetTabStopToken) {
            return this.targetTabStopToken.toText();
        }
        return `$\{${this.tokenId}}`;
    }

    public createEmpty(tabstop: number): MirrorToken {
        return new MirrorToken(this.tokenId, tabstop);
    }

    public hasToken(token: SnippetToken): boolean {
        return token === this;
    }
}
