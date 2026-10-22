/**
 * Markdown is written with § standing in for a backtick, so this file doesn't
 * need a wall of escapes. It is swapped back when the text is built.
 */
export function buildSkillMd(origin: string, sandboxRecipient?: string): string {
  const sandbox = sandboxRecipient
    ? `Use **${sandboxRecipient}** as the recipient when testing. Any other address will make the send fail (status §failed§, with Resend's error in §send.error§).`
    : `Ask the user which address can receive test emails. Any other address will make the send fail (status §failed§, with Resend's error in §send.error§).`;

  const md = `---
name: email-approvals
description: Prepare emails that a human must approve before they are sent. Use when the user asks you to draft, send, revise or check the status of an email through the approval service at ${origin}. You can create and revise drafts and submit them for review; only a human can approve and send.
---

# Email approvals

An approval service for email. You prepare drafts. A human reviews the exact recipients and content and approves or rejects them. Approved emails are sent through Resend. **You can never approve or send.**

- Base URL: ${origin}
- Auth: header §Authorization: Bearer $EMAIL_APPROVALS_API_KEY§. Use the agent API key the user gave you. If you don't have one, ask the user for it.
- Human review UI: ${origin}/ (humans sign in there with a different credential that you don't have)
- Machine-readable spec: ${origin}/openapi.json

## Workflow

1. **Create** a draft. Nothing is sent.

§§§bash
curl -sS -X POST ${origin}/api/agent/drafts \\
  -H "Authorization: Bearer $EMAIL_APPROVALS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"to":["person@example.com"],"subject":"Hello","html":"<p>Hi there</p>"}'
§§§

   The response is the draft. Note §id§ and §revision.id§.

2. **Revise** if needed. Send only the fields that change; the rest are kept. This creates a new revision.

§§§bash
curl -sS -X PUT ${origin}/api/agent/drafts/DRAFT_ID \\
  -H "Authorization: Bearer $EMAIL_APPROVALS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"subject":"Hello again"}'
§§§

3. **Submit** the current revision for approval. Use the §revision.id§ from your latest response.

§§§bash
curl -sS -X POST ${origin}/api/agent/drafts/DRAFT_ID/submit \\
  -H "Authorization: Bearer $EMAIL_APPROVALS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"revision_id":"REVISION_ID"}'
§§§

4. **Tell the user** that the draft is waiting for their review at ${origin}/, with the draft id and subject. A human has to act, so don't wait silently.

5. **Check status** to learn what happened.

§§§bash
curl -sS ${origin}/api/agent/drafts/DRAFT_ID \\
  -H "Authorization: Bearer $EMAIL_APPROVALS_API_KEY"
§§§

   Poll no more often than every 5 seconds, backing off to about 30 seconds. A human may take minutes or longer. If it is still §pending_approval§ after a reasonable wait, stop and tell the user the draft id so they or you can check later.

## Status

| status | meaning | what you do |
|---|---|---|
| §draft§ | Not submitted yet | Submit it, or revise it |
| §pending_approval§ | Waiting for a human | Poll. Don't resubmit |
| §approved§ | A human approved it; the send is in progress | Poll |
| §sent§ | Sent. §send.resend_email_id§ is set | Report success |
| §rejected§ | A human rejected it. §review.reason§ says why | Revise to address the reason, then submit again |
| §failed§ | Approved, but the send failed. §send.error§ has Resend's error | Tell the user. A human can retry the send. You can also revise, which needs a new approval |

Every response includes §next_actions§ listing what you can do next, with method, path and body.

## Rules to know

- **Approval applies to one exact revision.** Any revision you make after submitting withdraws the approval request and needs a new approval. A human approves what they reviewed, nothing else.
- **Always submit the current revision.** If submit returns §revision_changed§ (409), GET the draft and use its current §revision.id§.
- **You can't send.** Your key is refused (403) on every review route. Don't try; ask the human.
- **Approved drafts are locked.** Once approved or sent, a draft can't be revised. Create a new draft instead.
- Creating a draft is not idempotent. If a create request times out, list drafts (§GET /api/agent/drafts§) before retrying so you don't create duplicates.

## Request limits

- §to§: required, at least one. At most 50 recipients across §to§, §cc§ and §bcc§.
- Plain addresses only (§a@b.com§, not §Name <a@b.com>§).
- §subject§: one line, at most 998 characters.
- §html§: the full HTML body, up to about 1 MB. No separate plain-text part and no attachments.
- §from§ is fixed by the service. Sending a §from§ (or any unknown field) is rejected.

## Errors

Every error is JSON: §{"error":{"code","message","hint"}}§. Read §hint§; it says what to do.

| code | HTTP | meaning |
|---|---|---|
| §unauthorized§ | 401 | Missing or invalid API key |
| §wrong_credential_type§ | 403 | A reviewer credential was used on an agent route |
| §agent_cannot_review§ | 403 | Your key was used on a review route. Humans only |
| §validation_error§ | 400 | Bad body. §issues§ lists each problem |
| §invalid_json§ | 400 | Body isn't valid JSON |
| §not_found§ | 404 | No such draft |
| §revision_changed§ | 409 | The revision you named is no longer current |
| §invalid_state§ | 409 | Not allowed in the draft's current status |
| §draft_locked§ | 409 | Approved or sent drafts can't be revised |
| §no_changes§ | 409 | The revision is identical to the current one |

## Delivery limits in this deployment

Emails are sent from Resend's shared testing address, which only delivers to one address: the one belonging to the service owner's Resend account. ${sandbox}
`;
  return md.replaceAll("§", "`");
}
