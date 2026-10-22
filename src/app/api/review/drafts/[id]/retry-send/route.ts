import { requireReviewer } from "@/lib/auth";
import { guard, type IdContext } from "@/lib/route";
import { retrySend } from "@/services/review";

export const dynamic = "force-dynamic";
// Retrying sends inline, like approve.
export const maxDuration = 30;

/** Reviewer-only: agents can never trigger a send, including a retry. */
export function POST(req: Request, ctx: IdContext) {
  return guard(async () => {
    requireReviewer(req);
    const { id } = await ctx.params;
    return Response.json(await retrySend(id));
  });
}
