import { Denops, ensureString } from './deps.ts';
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
        registerSnippet(snippetName, parserName): Promise<void> {
            ensureString(snippetName);
            ensureString(parserName);
            olppet.registerSnippet(denops, snippetName, parserName);
            return Promise.resolve();
        },
        expand(): Promise<boolean> {
            return olppet.expand(denops);
        },
        jumpForward(): Promise<boolean> {
            return olppet.jumpForward(denops);
        },
        jumpBackward(): Promise<boolean> {
            return olppet.jumpBackward(denops);
        },
        getSnippets(filetype): Promise<[string, string|null][]> {
            ensureString(filetype);
            return olppet.getTriggers(filetype);
        },
        async textChanged(): Promise<void> {
            await olppet.textChanged(denops);
        },
        bufEntered(): Promise<void> {
            olppet.updateFiletype(denops);
            return Promise.resolve();
        },
        async getCandidates(): Promise<{word: string, menu?: string}[]> {
            if (!enabled) {
                return Promise.resolve([]);
            }
            const candidates: {word: string, menu?: string}[] = [];
            for (const [trigger, description] of await olppet.getTriggers()) {
                const candidate: {word: string, menu?: string} = {word: trigger};
                if (description) {
                    candidate.menu = description;
                }
                candidates.push(candidate);
            }
            return candidates;
        }
    };
    await denops.cmd('doautocmd <nomodeline> User OlppetReady');
}
