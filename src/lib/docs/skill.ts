import { DEFAULT_MAX_RECIPIENTS } from "./limits";

/**
 * Markdown is written with § standing in for a backtick, so this file doesn't
 * need a wall of escapes. It is swapped back when the text is built.
 */
export function buildSkillMd(origin: string, maxRecipients: number): string {
  const capNote =
    maxRecipients < DEFAULT_MAX_RECIPIENTS
      ? `\n\nThis deployment caps drafts at ${maxRecipients} recipients to protect the shared testing sender's daily quota. The service itself supports up to ${DEFAULT_MAX_RECIPIENTS.toLocaleString("en")}.`
      : "";

  const md = `---
name: email-approvals
description: Prepare emails that a human must approve before they are sent, to one recipient or up to ${maxRecipients}, each receiving an individual copy. Use when the user asks you to draft, send, revise or check the status of an email or a bulk/transactional send through the approval service at ${origin}. You can create and revise drafts and submit them for review; only a human can approve, send or resume.
---

# Email approvals

An approval service for email. You prepare a draft: **one recipients list, one subject, one HTML body**. A human reviews the exact recipient list and content and approves or rejects it. After approval the service sends **each recipient their own individual copy** through Resend, in batches. **You can never approve, send or resume a send.**

- Base URL: ${origin}. Every path in these docs and in §next_actions§ is relative to it.
- Auth: header §Authorization: Bearer $EMAIL_APPROVALS_API_KEY§. Use the agent API key the user gave you. If you don't have one, ask the user for it.
- Human review UI: ${origin}/ (humans sign in there with a different credential that you don't have)
- Machine-readable spec: ${origin}/openapi.json
- Discovery: §GET ${origin}/api/agent§ needs no key and returns §service§, §summary§, §docs§ (links to §skill§, §openapi§ and §llms_txt§), §auth§, §you_can§ and §you_cannot§.

## Who can receive email (read this before you send anything)

This deployment sends from Resend's shared testing sender, which only delivers to Resend's test addresses and to the service owner's own address. **Use §delivered@resend.dev§ as the recipient.** §delivered+anything@resend.dev§ (e.g. §delivered+ada@resend.dev§) also works, which gives you several distinct test recipients. Don't use §example.com§ or any real person's address. Any other address fails, and because a batch either fully succeeds or fully fails, one such address fails its whole batch of up to 100 (status §failed§, Resend's error in §send.errors§). Test sends count towards a low daily sending quota, so test with a handful of recipients.${capNote}

## The recipients model

- §recipients§ is a list of plain email addresses. Every address gets a separate email with the same subject and HTML. Nobody sees anyone else's address.
- There is no §to§, §cc§ or §bcc§. Sending any of them is refused with §validation_error§. A single transactional email is a list of one.
- At most **${maxRecipients}** unique recipients per draft. For more, split the list across several drafts.
- The list is stored canonicalised: trimmed, lowercased, de-duplicated and sorted. The same set in any order or case is the same draft. The response tells you §revision.duplicates_removed§.
- One invalid address rejects the whole request (§invalid_recipients§, listing up to 20 bad addresses with their position in your array). Nothing is dropped silently, so fix the list and send it again.
- No personalisation or merge variables, no attachments, no scheduling, no unsubscribe headers.

## Workflow

1. **Create** a draft. Nothing is sent.

§§§bash
curl -sS -X POST ${origin}/api/agent/drafts \\
  -H "Authorization: Bearer $EMAIL_APPROVALS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"recipients":["delivered+ada@resend.dev","delivered+grace@resend.dev"],"subject":"Hello","html":"<p>Hi there</p>"}'
§§§

   The response is the draft (201). Note §id§, §revision.id§, §revision.recipient_count§ and §review_url§. Only the first 10 recipients are returned inline (§revision.recipients_preview§).

2. **Revise** if needed. Send only the fields that change; the rest are kept. A field you send **replaces its current value in full**: there is no append or patch. To add a sentence, send the complete new §html§; to add a recipient, send the complete new §recipients§ list. This creates a new revision. Revising a §pending_approval§ draft withdraws the approval request and returns it to §draft§, so submit the new revision afterwards.

§§§bash
curl -sS -X PUT ${origin}/api/agent/drafts/DRAFT_ID \\
  -H "Authorization: Bearer $EMAIL_APPROVALS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"subject":"Hello again"}'
§§§

   **Adding a recipient** is the revise most often done wrong. Sending only the new address replaces the list with that one address. Take the current list from §revision.recipients_preview§ (all of it when §recipient_count§ is 10 or fewer; otherwise page §/recipients§), append the new address, and send the whole list:

§§§bash
curl -sS -X PUT ${origin}/api/agent/drafts/DRAFT_ID \
  -H "Authorization: Bearer $EMAIL_APPROVALS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"recipients":["delivered+ada@resend.dev","delivered+grace@resend.dev","delivered+linus@resend.dev"]}'
§§§

   A revise response also has §recipients_change§: §{"previous_count","count","added","removed"}§ compared with the revision it replaced, or null if nothing changed. If recipients were removed it has a §warning§, which the §submit§ action repeats. Check it before you submit: if the removal wasn't intended, revise again with the full list.

3. **Submit** the current revision for approval. Use the §revision.id§ from your latest response (the §submit§ entry in §next_actions§ has the exact body). Submitting a revision that is already pending is a harmless no-op.

§§§bash
curl -sS -X POST ${origin}/api/agent/drafts/DRAFT_ID/submit \\
  -H "Authorization: Bearer $EMAIL_APPROVALS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"revision_id":"REVISION_ID"}'
§§§

4. **Tell the user** that the draft is waiting for their review. Give them the draft's §review_url§ (it opens this draft in the review UI), with the subject and recipient count. A human has to act, so don't wait silently.

5. **Check status** to learn what happened.

§§§bash
curl -sS ${origin}/api/agent/drafts/DRAFT_ID \\
  -H "Authorization: Bearer $EMAIL_APPROVALS_API_KEY"
§§§

   While a human hasn't decided, poll no more often than every 5 seconds, backing off to about 30 seconds. A human may take minutes or longer. If it is still §pending_approval§ after a reasonable wait, stop and tell the user the draft id so they or you can check later. Once it is §approved§, sending is in progress: poll every 5 to 10 seconds and read §send§ until the status is §sent§ or §failed§.

## Paging through recipients

The full list, and each recipient's send status once approved, comes from a paginated endpoint. Query parameters, all optional:

- §offset§ (default 0) and §limit§ (default 50, at most 500).
- §q§: a case-insensitive substring match on the address.
- §status§: §pending§, §sent§ or §failed§. Only allowed once the draft has been approved; before that it is refused with 400 §validation_error§.
- §revision_id§: a revision of this draft. Defaults to the current revision.

§§§bash
offset=0
while :; do
  page=$(curl -sS "${origin}/api/agent/drafts/DRAFT_ID/recipients?offset=$offset&limit=500" \\
    -H "Authorization: Bearer $EMAIL_APPROVALS_API_KEY")
  echo "$page" | jq -r '.items[] | "\\(.email) \\(.status // "-")"'
  count=$(echo "$page" | jq '.items | length')
  total=$(echo "$page" | jq '.total')
  offset=$((offset + count))
  [ "$count" -eq 0 ] || [ "$offset" -ge "$total" ] && break
done
§§§

The response:

§§§json
{
  "revision_id": "rev_...", "recipient_count": 4812,
  "total": 4812, "offset": 0, "limit": 500,
  "items": [{ "email": "delivered+ada@resend.dev", "status": "sent", "resend_email_id": "4ef9a417-..." }]
}
§§§

- §revision_id§: the revision these recipients belong to.
- §recipient_count§: all recipients of that revision. §total§ is how many match §q§ and §status§, so page until §offset + items.length >= total§.
- §items[].status§ and §items[].resend_email_id§ are null before approval. After approval §status§ is §pending§ (not yet attempted, or in flight), §sent§ (§resend_email_id§ is set) or §failed§.

To list only the recipients that failed: §?status=failed§.

## Status

| status | meaning | what you do |
|---|---|---|
| §draft§ | Not submitted yet | Submit it, or revise it |
| §pending_approval§ | Waiting for a human | Poll. Don't resubmit |
| §approved§ | A human approved it; sending is in progress | Poll and report §send§ progress. You can't revise it now |
| §sent§ | Resend accepted every email | Report success |
| §rejected§ | A human rejected it. §review.reason§ says why | Revise to address the reason, then submit again |
| §failed§ | Sending finished, but at least one batch failed. If §send.partial§ is true, some recipients were sent | Tell the user what §send§ says. **Only a human can resume** the failed part from the review UI |

**"sent" means accepted by Resend, not delivered.** This service doesn't receive delivery or bounce events, so it can't tell you whether an email reached an inbox.

## The draft object

Create, revise, submit and get all return the same draft object:

- §id§, §status§, §created_at§, §updated_at§.
- §revision§: the current revision, the one a human would approve. §id§, §number§, §recipient_count§, §recipients_preview§ (the first 10 in sorted order), §duplicates_removed§, §subject§, §html§, §content_hash§ (SHA-256 of the recipient set, subject and html), §created_at§.
- §review§: null until a human decides on the current revision, then §{"decision": "approved" | "rejected", "reason", "decided_at"}§. §reason§ is set for rejections.
- §send§: null until approval, then the sending progress described below.
- §revisions§: every revision, oldest first, as §{"id","number","content_hash","created_at"}§.
- §review_url§: a link that opens this draft in the human review UI. Give it to the user.
- §next_actions§: see below.

Every draft response includes §next_actions§ listing what you can do next, with method, path (relative to the base URL) and, for §submit§, the exact body. The §action§ names are §submit§, §revise§, §poll§, §list_recipients§ and §none§.

§GET /api/agent/drafts§ lists up to 50 drafts, most recently updated first, as §{"drafts":[{"id","status","revision_number","subject","recipient_count","updated_at","review_url"}]}§. Add §?status=pending_approval§ (or any status) to filter. **The list is every draft in the service, not just yours:** there is one agent key, shared by every agent and session that uses it, and drafts aren't tagged with who made them. To track your own drafts, keep the ids that create returned. If the user asks which drafts are theirs, show the list and let them say.

## Sending progress (§send§)

§send§ is null until a human approves. Then:

§§§json
{
  "status": "sending",
  "recipients_total": 4812, "recipients_sent": 3900, "recipients_failed": 100, "recipients_pending": 812,
  "chunks_total": 49, "chunks_sent": 39, "chunks_failed": 1, "chunks_pending": 9,
  "partial": true,
  "errors": [{ "chunk_index": 12, "first_recipient": "a@x.com", "last_recipient": "c@x.com", "recipient_count": 100, "error": "Resend 422 validation_error: ...", "attempts": 1, "resumable": true }],
  "updated_at": "2026-10-23T12:00:00.000Z"
}
§§§

- Recipients are sent in batches ("chunks") of up to 100, in sorted order. A batch either fully succeeds or fully fails.
- §errors§ lists up to 20 failed batches, lowest §chunk_index§ first. Each has §first_recipient§ and §last_recipient§ (the range it covers in sorted order), §recipient_count§ (how many recipients it covers), §error§ (Resend's error, or why the outcome is unknown), §attempts§ and §resumable§.
- **Partial failure:** the draft ends as §failed§ with §partial: true§. Recipients in successful batches got their email; the others did not. A human can **resume**, which retries only the failed batches, never the ones already sent. You can't resume; tell the user.
- §resumable: false§ means the outcome of that batch is unknown and too old to retry without risking a duplicate. A human has to check the Resend dashboard.
- Don't "fix" a partial failure by revising the draft or creating a new one with the same list. A new revision is sent to its whole list, so recipients who already got the email would get a second copy. If the user really wants to send to only the failed recipients, list them with §?status=failed§ and create a new draft for just those.

## What the human does (you can't)

These happen in the review UI. Your key is refused on all of them (403 §agent_cannot_review§), but knowing them helps you explain what's going on to the user.

- **Approve** a §pending_approval§ draft. The reviewer approves the exact revision on screen: its id, content hash and recipient count. If you revised the draft meanwhile, the approval is refused (§revision_changed§, §content_hash_mismatch§ or §recipient_count_mismatch§) and nothing is sent; the reviewer reloads and reviews your new revision. Approving starts sending in the background, so the draft becomes §approved§, then §sent§ or §failed§.
- **Reject** with a reason, which you see in §review.reason§.
- **Resume** a §failed§ draft, or an §approved§ one that has stopped making progress. Only the failed batches are retried; batches already sent are never sent again. Batches with §resumable: false§ are skipped. Resume is refused with §not_resumable§ if the draft was never approved or already finished sending, and with §retry_unsafe§ if every remaining batch is unsafe to retry.

## Rules to know

- **Approval applies to one exact revision**: the recipient set, subject and HTML. Any revision you make after submitting withdraws the approval request and needs a new approval.
- **Always submit the current revision.** If submit returns §revision_changed§ (409), its message names the current revision id; submit that (or GET the draft and use §revision.id§).
- **You can't send.** Your key is refused (403) on every review route. Don't try; ask the human.
- **Approved and sent drafts are locked.** While a draft is §approved§ (sending) or §sent§ it can't be revised (§draft_locked§). Create a new draft instead.
- Creating a draft is not idempotent. If a create request times out, list drafts (§GET /api/agent/drafts§) before retrying so you don't create duplicates.

## Request limits

- §recipients§: required, 1 to ${maxRecipients} unique plain addresses (§a@b.com§, not §Name <a@b.com>§), each at most 254 characters.
- §subject§: one line, at most 998 characters.
- §html§: the email's HTML, up to about 1 MB, identical for everyone. A fragment such as §<p>Hi</p>§ is fine; a full §<html>§ document works too. No separate plain-text part and no attachments.
- §from§ is fixed by the service. Sending a §from§ (or any unknown field) is rejected.

## Using an existing HTML or .eml file

The service has no file upload or attachments. To send an email the user already has, read the file and put its content in the draft.

**An HTML file:** send its whole content as §html§.

- Images must be absolute §https://§ URLs. Relative paths (§images/logo.png§) and §file://§ paths show as broken images, both to the reviewer and in the inbox. Tell the user if the file has any.
- Avoid images embedded as §data:§ URIs: many email clients (Gmail included) block them, and they count towards the 1 MB limit.
- Scripts and forms are stripped by email clients and blocked in the review preview. Don't rely on them.

**An .eml file** (a saved MIME message):

- Use the §text/html§ part as §html§, decoded from its transfer encoding (quoted-printable or base64) to plain text. Never send the raw MIME source or still-encoded text.
- Use the §Subject§ header as §subject§, decoded if it is an encoded word (§=?UTF-8?B?...?=§ or §=?UTF-8?Q?...?=§).
- Don't copy §To§, §Cc§ or §Bcc§ into §recipients§ without asking the user, and follow "Who can receive email" above.
- These are dropped, so tell the user: §From§ and §Reply-To§ (the sender is fixed), the plain-text part (only HTML is sent), attachments, and inline images referenced as §cid:§ (they show as broken images, so replace them with §https://§ URLs if the user can host them).

## Errors

Every error is JSON: §{"error":{"code","message","hint"}}§. Read §hint§; it says what to do.

| code | HTTP | meaning |
|---|---|---|
| §unauthorized§ | 401 | Missing or invalid API key |
| §wrong_credential_type§ | 403 | A reviewer credential was used on an agent route |
| §agent_cannot_review§ | 403 | Your key was used on a review route. Humans only |
| §validation_error§ | 400 | Bad body or query: a missing or unknown field, or a wrong type. §issues§ lists each problem (§path§ names the field) and §hint§ describes a valid request. Also returned for §to§/§cc§/§bcc§, and for a recipients §status§ filter before approval |
| §invalid_recipients§ | 400 | Some addresses are invalid. §invalid§ lists up to 20 as §{index, value}§ (§index§ is the position in your array; very long values are cut at 320 characters), §invalid_count§ has the total |
| §too_many_recipients§ | 400 | More than ${maxRecipients} unique recipients. §max_recipients§ and §recipient_count§ give the numbers. Split the list into several drafts |
| §no_recipients§ | 400 | §recipients§ is empty |
| §invalid_json§ | 400 | Body isn't valid JSON (an empty body counts as §{}§) |
| §not_found§ | 404 | No such draft or revision |
| §revision_changed§ | 409 | The revision you named is no longer current |
| §invalid_state§ | 409 | Not allowed in the draft's current status |
| §draft_locked§ | 409 | Approved (sending) or sent drafts can't be revised |
| §no_changes§ | 409 | The revision is identical to the current one |
| §internal_error§ | 500 | Unexpected server error. Retry once after a few seconds; a create may have succeeded, so list drafts first |
`;
  return md.replaceAll("§", "`");
}
