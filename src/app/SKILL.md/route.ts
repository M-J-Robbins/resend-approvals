import { buildSkillMd } from "@/lib/docs/skill";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const origin = new URL(req.url).origin;
  return new Response(buildSkillMd(origin, process.env.SANDBOX_RECIPIENT), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
