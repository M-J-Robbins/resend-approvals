import { requireReviewer } from "@/lib/auth";
import { guard, type IdContext } from "@/lib/route";
import { getDraftView } from "@/services/drafts";

export const dynamic = "force-dynamic";

export function GET(req: Request, ctx: IdContext) {
  return guard(async () => {
    requireReviewer(req);
    const { id } = await ctx.params;
    return Response.json(await getDraftView(id));
  });
}
