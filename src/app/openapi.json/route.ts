import { buildOpenApi } from "@/lib/docs/openapi";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return Response.json(buildOpenApi(new URL(req.url).origin), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
