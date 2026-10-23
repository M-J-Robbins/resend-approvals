import { docsMaxRecipients } from "@/lib/docs/limits";
import { buildSkillMd } from "@/lib/docs/skill";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const origin = new URL(req.url).origin;
  return new Response(buildSkillMd(origin, docsMaxRecipients(), process.env.SANDBOX_RECIPIENT), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
