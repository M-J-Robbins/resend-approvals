import { requireReviewer } from "@/lib/auth";
import { guard, sendInBackground, type IdContext } from "@/lib/route";
import { resumeSend } from "@/services/review";

export const dynamic = "force-dynamic";
// Same as approve: the worker runs after the response.
export const maxDuration = 300;

/** Reviewer-only: agents can never trigger a send, including a resume. */
export function POST(req: Request, ctx: IdContext) {
  return guard(async () => {
    requireReviewer(req);
    const { id } = await ctx.params;
    const result = await resumeSend(id);
    sendInBackground(id);
    return Response.json(result, { status: 202 });
  });
}
