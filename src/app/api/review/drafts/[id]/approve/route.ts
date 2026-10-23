import { requireReviewer } from "@/lib/auth";
import { guard, readJson, sendInBackground, type IdContext } from "@/lib/route";
import { approveBody } from "@/lib/validation";
import { approveDraft } from "@/services/review";

export const dynamic = "force-dynamic";
// The send worker runs after the response, inside this function's lifetime.
// 300s is the Hobby maximum with fluid compute (Pro allows up to 800s).
export const maxDuration = 300;

/** Creates the send job and answers 202 at once; the worker sends in the background. */
export function POST(req: Request, ctx: IdContext) {
  return guard(async () => {
    requireReviewer(req);
    const { id } = await ctx.params;
    const body = approveBody.parse(await readJson(req));
    const view = await approveDraft(id, {
      revisionId: body.revision_id,
      contentHash: body.content_hash,
      recipientCount: body.recipient_count,
    });
    if (view.status === "approved") sendInBackground(id);
    return Response.json(view, { status: 202 });
  });
}
