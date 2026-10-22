import { requireAgent } from "@/lib/auth";
import { agentJson, guard, readJson, type IdContext } from "@/lib/route";
import { submitBody } from "@/lib/validation";
import { submitDraft } from "@/services/drafts";

export const dynamic = "force-dynamic";

export function POST(req: Request, ctx: IdContext) {
  return guard(async () => {
    requireAgent(req);
    const { id } = await ctx.params;
    const body = submitBody.parse(await readJson(req));
    return agentJson(await submitDraft(id, body.revision_id));
  });
}
