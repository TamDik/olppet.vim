import { Denops, autocmd, unknownutil } from './deps.ts';
import { Config } from './types.ts';
import { SnippetEngine } from './engine.ts';


export async function main(denops: Denops): Promise<void> {
    const snippetEngine = new SnippetEngine();
    denops.dispatcher = {
        async config(args): Promise<void> {
            await snippetEngine.setConfig(denops, args as Config);
        },
        async expand(key): Promise<void> {
            unknownutil.ensureString(key);
            await snippetEngine.expand(denops, key);
        },
        async jumpForward(key): Promise<void> {
            unknownutil.ensureString(key);
            await snippetEngine.jumpForward(denops, key);
        },
        async jumpBackward(key): Promise<void> {
            unknownutil.ensureString(key);
            await snippetEngine.jumpBackward(denops, key);
        },
        getCandidates(): Promise<{word: string, menu?: string}[]> {
            return snippetEngine.getCandidates(denops);
        }
    };
    await denops.cmd('doautocmd <nomodeline> User OlppetReady');
    await autocmd.define(denops, 'InsertLeave', '*', 'echomsg "InsertLeave"');
}
