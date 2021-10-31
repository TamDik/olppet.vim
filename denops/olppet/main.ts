import { Denops, autocmd } from './deps.ts';
import { Config } from './types.ts';
import { SnippetEngine } from './engine.ts';


export async function main(denops: Denops): Promise<void> {
    const snippetEngine = new SnippetEngine();
    denops.dispatcher = {
        async config(args): Promise<void> {
            await snippetEngine.setConfig(denops, args as Config);
        },
        async expand(): Promise<void> {
            await snippetEngine.expand(denops);
        },
        async jumpForward(): Promise<void> {
            await snippetEngine.jumpForward(denops);
        },
        async jumpBackward(): Promise<void> {
            await snippetEngine.jumpBackward(denops);
        },
        insertLeave(): Promise<void> {
            snippetEngine.leaveInsertMode();
            return Promise.resolve();
        },
        async textChanged(): Promise<void> {
            await snippetEngine.textChanged(denops);
        },
        getCandidates(): Promise<{word: string, menu?: string}[]> {
            return snippetEngine.getCandidates(denops);
        }
    };
    await denops.cmd('doautocmd <nomodeline> User OlppetReady');
    await autocmd.define(denops, 'InsertLeave', '*', `call denops#request('${denops.name}', 'insertLeave', [])`);
    await autocmd.define(denops, ['TextChangedI', 'TextChangedP'], '*', `call denops#request('${denops.name}', 'textChanged', [])`);
}
