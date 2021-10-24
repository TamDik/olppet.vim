export class Snippet {
    public constructor(public readonly trigger: string,
                       private readonly lines: SnippetLine[],
                       public readonly description: string|null) {
    }

    public toText(tabstop: number, head: number): string[] {
        return this.lines.map(line => line.toText(tabstop, head));
    }
}


export class SnippetLine {
    public constructor(private readonly tokens: SnippetToken[]) {
    }

    public toText(head: number, tabstop: number): string {
        const text = this.tokens.map(token => token.toText(tabstop)).join('');
        return ' '.repeat(head) + text;
    }
}


export abstract class SnippetToken {
    public abstract toText(tabstop: number): string;
}


export class SnippetIndentToken extends SnippetToken {
    public constructor() {
        super();
    }

    public toText(tabstop: number): string {
        return ' '.repeat(tabstop);
    }
}


export class SnippetTextToken extends SnippetToken {
    public constructor(private readonly text: string) {
        super();
    }

    public toText(): string {
        return this.text;
    }
}


export class SnippetTabStopToken extends SnippetToken {
    public constructor(public readonly tabstopId: string, private readonly placeholder: SnippetToken[]) {
        super();
    }

    public toText(tabstop: number): string {
        const text = this.placeholder.map(token => token.toText(tabstop)).join('');
        return text;
    }
}


export class SnippetMirrorToken extends SnippetToken {
    public constructor(public readonly tabstopId: string) {
        super();
    }

    public toText(): string {
        return `[mirror-${this.tabstopId}]`;
    }
}
