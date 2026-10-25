import { requireAgent } from "@/lib/auth";
import { agentJson, guard, readJson, type IdContext } from "@/lib/route";
import { parseReviseDraft } from "@/lib/validation";
import { getDraftView, reviseDraft } from "@/services/drafts";

export const dynamic = "force-dynamic";

export function GET(req: Request, ctx: IdContext) {
  return guard(async () => {
    requireAgent(req);
    const { id } = await ctx.params;
    return agentJson(req, await getDraftView(id));
  });
}

/** Creates a new revision. Omitted fields keep their current value; `recipients` replaces the whole list. */
export function PUT(req: Request, ctx: IdContext) {
  return guard(async () => {
    requireAgent(req);
    const { id } = await ctx.params;
    const patch = parseReviseDraft(await readJson(req));
    return agentJson(req, await reviseDraft(id, patch));
  });
}
