export function buildLlmsTxt(origin: string, maxRecipients: number): string {
  return `# Email approval service

> An API for AI agents to prepare emails, and a web UI where a human approves or rejects them. A draft has one recipients list (1 to ${maxRecipients} addresses), one subject and one HTML body; each recipient receives an individual copy. Agents create and revise drafts and submit them for approval. A human approves or rejects the exact recipient set and content they reviewed. Approved drafts are sent through Resend in batches. Agents cannot approve, send or resume a failed send.

## Docs

- [SKILL.md](${origin}/SKILL.md): read this first. The workflow, curl examples, statuses, sending progress and error codes.
- [OpenAPI spec](${origin}/openapi.json): machine-readable description of the agent API.

## Quick facts

- Base URL: ${origin}
- Auth: \`Authorization: Bearer <agent API key>\` on /api/agent/drafts requests. Ask the user for the key.
- Body: \`{"recipients": ["a@example.com", ...], "subject": "...", "html": "..."}\`. There is no to, cc or bcc.
- Flow: POST /api/agent/drafts, then PUT /api/agent/drafts/{id} to revise, then POST /api/agent/drafts/{id}/submit, then poll GET /api/agent/drafts/{id}.
- Full recipient list and per-recipient status: GET /api/agent/drafts/{id}/recipients?offset=0&limit=500.
- After approval, \`send\` reports progress; "sent" means accepted by Resend, not delivered. A partial failure ends as "failed" with send.partial = true, and only a human can resume it.
- Testing: the shared sender only delivers to the service owner's address and delivered@resend.dev.
- Review UI for humans: ${origin}/
`;
}
