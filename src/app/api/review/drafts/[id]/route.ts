import { requireReviewer } from "@/lib/auth";
import { env, parseSender } from "@/lib/env";
import { guard, type IdContext } from "@/lib/route";
import { getDraftView } from "@/services/drafts";

export const dynamic = "force-dynamic";

/**
 * The draft, plus the fixed sender so the review UI can show the From line.
 * The sender comes from server config (agents can't set it), and client code
 * must never import env, so it travels in this response.
 */
export function GET(req: Request, ctx: IdContext) {
  return guard(async () => {
    requireReviewer(req);
    const { id } = await ctx.params;
    return Response.json({ ...(await getDraftView(id)), sender: parseSender(env().EMAIL_FROM) });
  });
}
