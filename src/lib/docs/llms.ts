export function buildLlmsTxt(origin: string): string {
  return `# Email approval service

> An API for AI agents to prepare emails, and a web UI where a human approves or rejects them. Agents create and revise drafts and submit them for approval. A human approves or rejects the exact recipients and content they reviewed. Approved emails are sent through Resend. Agents cannot approve or send.

## Docs

- [SKILL.md](${origin}/SKILL.md): read this first. The workflow, curl examples, statuses and error codes.
- [OpenAPI spec](${origin}/openapi.json): machine-readable description of the agent API.

## Quick facts

- Base URL: ${origin}
- Auth: \`Authorization: Bearer <agent API key>\` on /api/agent/drafts requests. Ask the user for the key.
- Flow: POST /api/agent/drafts, then PUT /api/agent/drafts/{id} to revise, then POST /api/agent/drafts/{id}/submit, then poll GET /api/agent/drafts/{id}.
- Review UI for humans: ${origin}/
`;
}
