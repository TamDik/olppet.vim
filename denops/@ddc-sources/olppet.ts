import { Denops, BaseSource, Candidate } from '../olppet/deps.ts'

type Params = Record<string, never>;
type UserData = {word: string};

export class Source extends BaseSource<Params, UserData> {
    async gatherCandidates(args: {denops: Denops}): Promise<Candidate<UserData>[]> {
        const candidates = await args.denops.dispatch('olppet', 'getCandidates') as string[];
        return candidates.map(candidate =>  {return {word: candidate}});
    }

    params(): Params {
        return {};
    }
}
