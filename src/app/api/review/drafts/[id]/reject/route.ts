import { requireReviewer } from "@/lib/auth";
import { guard, readJson, type IdContext } from "@/lib/route";
import { rejectBody } from "@/lib/validation";
import { rejectDraft } from "@/services/review";

export const dynamic = "force-dynamic";

export function POST(req: Request, ctx: IdContext) {
  return guard(async () => {
    requireReviewer(req);
    const { id } = await ctx.params;
    const body = rejectBody.parse(await readJson(req));
    return Response.json(
      await rejectDraft(id, {
        revisionId: body.revision_id,
        reason: body.reason,
      }),
    );
  });
}
