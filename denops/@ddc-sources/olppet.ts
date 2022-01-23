import { Denops, BaseSource, Candidate, Context } from '../olppet/deps.ts'


type Params = Record<string, never>;
type UserData = {word: string};

export class Source extends BaseSource<Params, UserData> {
    async gatherCandidates(args: {denops: Denops}): Promise<Candidate<UserData>[]> {
        const candidates = await args.denops.dispatch('olppet', 'getCandidates') as {word: string, menu?: string}[];
        return candidates;
    }

    getCompletePosition(args: {context: Context}): Promise<number> {
        const triggerMatch = args.context.input.match(/(?<!\w)\S*$/);
        if (!triggerMatch) {
            return super.getCompletePosition(args);
        }
        const triggerLength = triggerMatch[0].length;
        return Promise.resolve(args.context.input.length - triggerLength);
    }

    params(): Params {
        return {};
    }
}
