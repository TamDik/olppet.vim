export function bytes(s: string): number {
    const encoder = new TextEncoder();
    return encoder.encode(s).length;
}

export function subbytes(s: string, start: number, end?: number) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const encoded = encoder.encode(s);
    return decoder.decode(encoded.slice(start, end));
}
