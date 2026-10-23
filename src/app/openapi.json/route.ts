import { docsMaxRecipients } from "@/lib/docs/limits";
import { buildOpenApi } from "@/lib/docs/openapi";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return Response.json(buildOpenApi(new URL(req.url).origin, docsMaxRecipients()), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
