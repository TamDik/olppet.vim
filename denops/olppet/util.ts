export function bytes(s: string): number {
    return encodeURI(s).replace(/%../g, '.').length;
}

export function subbytes(s: string, start: number, end?: number) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const encoded = encoder.encode(s);
    return decoder.decode(encoded.slice(start, end));
}
