import { requireReviewer } from "@/lib/auth";
import { guard } from "@/lib/route";
import { statusFilter } from "@/lib/validation";
import { listDrafts } from "@/services/drafts";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return guard(async () => {
    requireReviewer(req);
    const status = statusFilter
      .optional()
      .parse(new URL(req.url).searchParams.get("status") ?? undefined);
    return Response.json({ drafts: await listDrafts({ status }) });
  });
}
