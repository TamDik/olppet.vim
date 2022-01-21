import { isString } from './deps.ts';
export type ParserType = 'SnipMate';


export function isParserType(arg: unknown): arg is ParserType {
    if (!isString(arg)) {
        return false;
    }
    return ['SnipMate'].includes(arg);
}


export function ensureParserType(arg: unknown): asserts arg is ParserType {
    if (!isParserType(arg)) {
        throw new Error('The value must be ParserType');
    }
}
