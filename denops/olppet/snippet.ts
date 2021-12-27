import { Denops, helper, variable } from './deps.ts';
import { bytes } from './util.ts';


export type Position = {
    lnum: number,
    col: number,
    colBytes: number,
}

export class Snippet {
    private walked = false;
    private currentTabStop: TabStopToken | null = null;
    private readonly tabStops: TabStopToken[][] = [];
    public constructor(public readonly trigger: string,
                       private readonly lines: SnippetLine[],
                       public readonly description: string|null,
                       private top_: number=0) {
        this.walkTokens();
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
            const tabStops = line.getTokens(isTabStop);
            if (!this.currentTabStop && tabStops.length) {
                this.currentTabStop = tabStops[0];
            }
            this.tabStops.push(tabStops);
            mirrorTokens.push(...line.getTokens(isMirror));
        }

        for (const mirrorToken of mirrorTokens) {
            for (const tabStop of this.tabStops.flat()) {
                if (mirrorToken.tokenId === tabStop.tokenId) {
                    mirrorToken.setTargetTabStopToken(tabStop);
                    break;
                }
            }
        }
    }

    public async executeVimScript(denops: Denops): Promise<void> {
        function isVimToken(token: SnippetToken): token is VimToken {
            return token instanceof VimToken;
        }
        for (const line of this.lines) {
            for (const token of line.getTokens(isVimToken)) {
                await token.execute(denops);
            }
        }
    }

    public hasTabStop(): boolean {
        return this.currentTabStop !== null;
    }

    public getCurrentTabStopText(): string | null {
        if (!this.currentTabStop) {
            throw Error('error');
        }
        return this.currentTabStop.getText();
    }

    public setCurrentTabStopText(text: string): void {
        if (!this.currentTabStop) {
            throw Error('error');
        }
        this.currentTabStop.setText(text);
    }

    public getCurrentTabStopPosition(): Position {
        if (!this.currentTabStop) {
            throw Error('error');
        }

        let lnum = 0;
        for (const len = this.lines.length; lnum < len; lnum++) {
            const line = this.lines[lnum];
            if (!line.hasToken(this.currentTabStop)) {
                continue;
            }
            const col = {col: 0, colBytes: 0};
            const tokens = line.tokens;
            for (const token of tokens) {
                if (token.hasToken(this.currentTabStop)) {
                    const currentCol = token.getCursorCol(this.currentTabStop);
                    col.col += currentCol.col;
                    col.colBytes += currentCol.colBytes;
                    break;
                }
                const text = token.toText();
                col.col += text.length
                col.colBytes += bytes(text);
            }
            return {lnum: this.top_ + lnum, ...col};
        }
        throw Error('error');
    }

    public goForward(): boolean {
        const nextTabStop = this.getNextTabStop();
        if (!nextTabStop) {
            return false;
        }
        this.currentTabStop = nextTabStop;
        return true;
    }

    public goBack(): boolean {
        const prevTabStop = this.getPrevTabStop();
        if (!prevTabStop) {
            return false;
        }
        this.currentTabStop = prevTabStop;
        return true;
    }

    public getStartPosition(): Position {
        return {lnum: this.top_, col: 0, colBytes: 0};
    }

    public getEndPosition(): Position {
        const lnum = this.top_ + this.lines.length - 1;
        const lastLineText = this.lines[this.lines.length - 1].toText();
        return {lnum, col: lastLineText.length, colBytes: bytes(lastLineText)};
    }

    private getNextTabStop(): TabStopToken | null {
        return this.getAfterTheCurrentTabStop(this.tabStops);
    }

    private getPrevTabStop(): TabStopToken | null {
        const reversed: TabStopToken[][] = [];
        for (const tabStops of [...this.tabStops].reverse()) {
            reversed.push([...tabStops].reverse());
        }
        return this.getAfterTheCurrentTabStop(reversed);
    }

    private getAfterTheCurrentTabStop(targets: TabStopToken[][]): TabStopToken | null {
        let firstTabStop: TabStopToken | null = null;
        let passed = false;
        for (const tabStops of targets) {
            for (const tabStop of tabStops) {
                if (!this.currentTabStop || passed) {
                    return tabStop;
                }
                if (!firstTabStop) {
                    firstTabStop = tabStop;
                }
                passed = tabStop.tokenId === this.currentTabStop.tokenId;
            }
        }
        return firstTabStop;
    }

    public toText(): string[] {
        return this.lines.map(line => line.toText());
    }

    public createEmpty(tabstop: number, top_: number, head: string, tail: string): Snippet {
        const lines = [];
        for (let i = 0, len = this.lines.length; i < len; i++) {
            const line = this.lines[i];
            const headText: string = i === 0 ? head : ' '.repeat(head.length);
            const tailText: string = i === len - 1 ? tail : '';
            lines.push(line.createEmpty(tabstop, headText, tailText));
        }
        return new Snippet(this.trigger, lines, this.description, top_);
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

    public toText(): string {
        const text = this.tokens.map(token => token.toText()).join('');
        return text;
    }

    public createEmpty(tabstop: number, head: string, tail: string): SnippetLine {
        const tokens: SnippetToken[] = [new TextToken(head, tabstop)]
        for (const token of this.tokens) {
            tokens.push(token.createEmpty(tabstop));
        }
        tokens.push(new TextToken(tail));
        return new SnippetLine(tokens);
    }

    public hasToken(targetToken: SnippetToken): boolean {
        for (const token of this.tokens) {
            if (token.hasToken(targetToken)) {
                return true;
            }
        }
        return false;
    }
}


export abstract class SnippetToken {
    public constructor(protected readonly tabstop: number) {
    }

    public getCursorCol(_targetToken: SnippetToken): {col: number, colBytes: number} {
        const text: string = this.toText()
        return {col: text.length, colBytes: bytes(text)};
    }

    public getTokens<T extends SnippetToken>(isTargetToken: (token: SnippetToken) => token is T): T[] {
        if (isTargetToken(this)) {
            return [this];
        }
        return [];
    }

    public hasToken(token: SnippetToken): boolean {
        return token === this;
    }

    public abstract toText(): string;
    public abstract createEmpty(tabstop: number): SnippetToken;
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
}


export class TabStopToken extends SnippetToken {
    private inputText: string | null = null;
    public constructor(public readonly tokenId: string,
                       private readonly placeholder: SnippetToken[],
                       tabstop=0) {
        super(tabstop);
    }

    public getText(): string | null {
        return this.inputText;
    }

    public setText(text: string): void {
        this.inputText = text;
    }

    public toText(): string {
        if (this.inputText !== null) {
            return this.inputText;
        }
        if (this.placeholder.length === 0) {
            return '';
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

    public getCursorCol(targetToken: SnippetToken): {col: number, colBytes: number} {
        if (targetToken === this) {
            if (this.inputText) {
                const text = this.toText();
                return {col: text.length, colBytes: bytes(text)};
            }
            return {col: 0, colBytes: 0};
        }
        const col = {col: 0, colBytes: 0};
        for (const t of this.placeholder) {
            if (t.hasToken(targetToken)) {
                const tCol = t.getCursorCol(targetToken);
                col.col += tCol.col;
                col.colBytes += tCol.colBytes;
                break;
            }
            const text = t.toText();
            col.col += text.length;
            col.colBytes += bytes(text);
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
        return '';
    }

    public createEmpty(tabstop: number): MirrorToken {
        return new MirrorToken(this.tokenId, tabstop);
    }
}


export class VimToken extends SnippetToken {
    private text: string | null = null;
    public constructor(public readonly script: string, tabstop=0) {
        super(tabstop);
    }

    public toText(): string {
        return this.text !== null ? this.text : this.script;
    }

    public async execute(denops: Denops): Promise<void> {
        await helper.execute(denops, `let g:_olppet_temp = ${this.script}`);
        this.text = await variable.globals.get(denops, '_olppet_temp') as string;
    }

    public createEmpty(tabstop: number): VimToken {
        return new VimToken(this.script, tabstop);
    }
}
