export const dynamic = "force-dynamic";

/** Unauthenticated entry point so an agent that lands on the API can find the docs. */
export function GET(req: Request) {
  const origin = new URL(req.url).origin;
  return Response.json({
    service: "email-approvals",
    summary:
      "Agents prepare email drafts here; a human approves or rejects them; approved emails are sent through Resend. One draft has one recipients list, and each recipient receives an individual copy of the same email.",
    docs: {
      skill: `${origin}/SKILL.md`,
      openapi: `${origin}/openapi.json`,
      llms_txt: `${origin}/llms.txt`,
    },
    auth: "Send 'Authorization: Bearer <agent API key>' on every /api/agent/drafts request.",
    you_can: ["create drafts", "revise drafts", "submit drafts for approval", "read draft status and send progress", "page through recipients"],
    you_cannot: ["approve", "reject", "send", "resume a failed send"],
  });
}
