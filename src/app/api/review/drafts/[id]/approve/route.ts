import { requireReviewer } from "@/lib/auth";
import { guard, readJson, type IdContext } from "@/lib/route";
import { approveBody } from "@/lib/validation";
import { approveDraft } from "@/services/review";

export const dynamic = "force-dynamic";
// Approve sends inline; the Resend call can take up to 20s.
export const maxDuration = 30;

export function POST(req: Request, ctx: IdContext) {
  return guard(async () => {
    requireReviewer(req);
    const { id } = await ctx.params;
    const body = approveBody.parse(await readJson(req));
    return Response.json(
      await approveDraft(id, {
        revisionId: body.revision_id,
        contentHash: body.content_hash,
      }),
    );
  });
}
