import { requireAgent } from "@/lib/auth";
import { agentJson, guard, readJson } from "@/lib/route";
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

export function GET(req: Request) {
  return guard(async () => {
    requireAgent(req);
    const status = statusFilter
      .optional()
      .parse(new URL(req.url).searchParams.get("status") ?? undefined);
    return Response.json({ drafts: await listDrafts({ status }) });
  });
}
