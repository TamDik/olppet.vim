import { Denops, ensureArray, ensureString, isString } from './deps.ts';
import { Olppet } from './olppet.ts';


export async function main(denops: Denops): Promise<void> {
    const olppet = new Olppet();
    let enabled = false;
    denops.dispatcher = {
        enable(): Promise<void> {
            enabled = true;
            olppet.updateFiletype(denops);
            return Promise.resolve();
        },
        disable(): Promise<void> {
            enabled = false;
            olppet.leaveSnippet();
            return Promise.resolve();
        },
        registerSnippets(snippetNames): Promise<void> {
            ensureArray(snippetNames, isString);
            olppet.registerSnippets(denops, snippetNames);
            return Promise.resolve();
        },
        registerSnippet(snippetName, parserName): Promise<void> {
            ensureString(snippetName);
            ensureString(parserName);
            olppet.registerSnippet(denops, snippetName, parserName);
            return Promise.resolve();
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
        bufEntered(): Promise<void> {
            olppet.updateFiletype(denops);
            return Promise.resolve();
        },
        getCandidates(): Promise<{word: string, menu?: string}[]> {
            if (!enabled) {
                return Promise.resolve([]);
            }
            return olppet.getCandidates(denops);
        }
    };
    await denops.cmd('doautocmd <nomodeline> User OlppetReady');
}
