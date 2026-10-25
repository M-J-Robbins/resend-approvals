import { requireAgent } from "@/lib/auth";
import { agentJson, guard, readJson, reviewUrl } from "@/lib/route";
import { parseCreateDraft, statusFilter } from "@/lib/validation";
import { createDraft, listDrafts } from "@/services/drafts";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return guard(async () => {
    requireAgent(req);
    const body = parseCreateDraft(await readJson(req));
    const view = await createDraft(body);
    return agentJson(req, view, 201, {
      Location: `/api/agent/drafts/${view.id}`,
    });
  });
}

/**
 * Every draft, not just the caller's: there is one shared agent key, so the
 * service can't tell agents apart. The docs tell agents to keep their own ids.
 */
export function GET(req: Request) {
  return guard(async () => {
    requireAgent(req);
    const status = statusFilter
      .optional()
      .parse(new URL(req.url).searchParams.get("status") ?? undefined);
    const list = await listDrafts({ status });
    return Response.json({ drafts: list.map((d) => ({ ...d, review_url: reviewUrl(req, d.id) })) });
  });
}
