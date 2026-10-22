import { requireAgent } from "@/lib/auth";
import { agentJson, guard, readJson, type IdContext } from "@/lib/route";
import { reviseDraftBody } from "@/lib/validation";
import { getDraftView, reviseDraft } from "@/services/drafts";

export const dynamic = "force-dynamic";

export function GET(req: Request, ctx: IdContext) {
  return guard(async () => {
    requireAgent(req);
    const { id } = await ctx.params;
    return agentJson(await getDraftView(id));
  });
}

/** Creates a new revision. Omitted fields keep their current value. */
export function PUT(req: Request, ctx: IdContext) {
  return guard(async () => {
    requireAgent(req);
    const { id } = await ctx.params;
    const patch = reviseDraftBody.parse(await readJson(req));
    return agentJson(await reviseDraft(id, patch));
  });
}
