import { Denops, autocmd, ensureArray, isString } from './deps.ts';
import { Olppet } from './olppet.ts';


export async function main(denops: Denops): Promise<void> {
    const olppet = new Olppet();
    denops.dispatcher = {
        registerSnippets(snippetNames): Promise<void> {
            ensureArray(snippetNames, isString);
            olppet.registerSnippets(denops, snippetNames);
            return Promise.resolve()
        },
        async expand(): Promise<boolean> {
            return await olppet.expand(denops);
        },
        async jumpForward(): Promise<boolean> {
            return await olppet.jumpForward(denops);
        },
        async jumpBackward(): Promise<boolean> {
            return await olppet.jumpBackward(denops);
        },
        async textChanged(): Promise<void> {
            await olppet.textChanged(denops);
        },
        getCandidates(): Promise<{word: string, menu?: string}[]> {
            return olppet.getCandidates(denops);
        }
    };
    await denops.cmd('doautocmd <nomodeline> User OlppetReady');
    await autocmd.define(denops, ['TextChangedI', 'TextChangedP'], '*', `call denops#request('${denops.name}', 'textChanged', [])`);
}
