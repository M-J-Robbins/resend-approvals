import { requireReviewer } from "@/lib/auth";
import { guard, type IdContext } from "@/lib/route";
import { recipientsQuery } from "@/lib/validation";
import { listRecipients } from "@/services/drafts";

export const dynamic = "force-dynamic";

export function GET(req: Request, ctx: IdContext) {
  return guard(async () => {
    requireReviewer(req);
    const { id } = await ctx.params;
    const query = recipientsQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
    return Response.json(await listRecipients(id, query));
  });
}
