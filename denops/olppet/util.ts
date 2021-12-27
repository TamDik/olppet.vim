export function bytes(s: string): number {
    return encodeURI(s).replace(/%../g, '.').length;
}
