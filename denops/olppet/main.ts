import { Denops } from './deps.ts';
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
        getCandidates(): Promise<{word: string, menu?: string}[]> {
            return snippetEngine.getCandidates(denops);
        }
    };
    await denops.cmd('doautocmd <nomodeline> User OlppetReady');
}
