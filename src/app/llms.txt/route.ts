import { docsMaxRecipients } from "@/lib/docs/limits";
import { buildLlmsTxt } from "@/lib/docs/llms";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return new Response(buildLlmsTxt(new URL(req.url).origin, docsMaxRecipients()), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
