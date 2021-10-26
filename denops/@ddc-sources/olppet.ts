import { Denops, BaseSource, Candidate } from '../olppet/deps.ts'

type Params = Record<string, never>;
type UserData = {word: string};

export class Source extends BaseSource<Params, UserData> {
    async gatherCandidates(args: {denops: Denops}): Promise<Candidate<UserData>[]> {
        const candidates = await args.denops.dispatch('olppet', 'getCandidates') as {word: string, menu?: string}[];
        return candidates;
    }

    params(): Params {
        return {};
    }
}
