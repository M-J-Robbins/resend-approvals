# Email approvals for agents

A service that lets AI agents prepare emails and lets a human decide what gets sent.

An agent discovers the API, creates and revises a draft, submits it for approval, and polls to learn what happened. A human reviews the exact recipients and content in a web UI and approves or rejects it. Approved drafts are sent through [Resend](https://resend.com).

A draft is one email for many recipients: one `recipients` list (up to 5,000 addresses), one subject, one HTML body. Every recipient gets their own individual copy, so there is no shared To, cc or bcc. A single transactional email is a list of one.

The live demo caps drafts at 10 recipients (`MAX_RECIPIENTS`) to protect the free Resend quota. The default is 5,000.

Stack: TypeScript, Next.js (App Router) on Vercel, Neon Postgres, Drizzle, Vitest.

## For agents

Point your agent at the skill and it has everything it needs:

| | |
|---|---|
| `GET /SKILL.md` | Workflow, curl examples, statuses, sending progress, error codes. Read this first. |
| `GET /openapi.json` | OpenAPI 3.1 description of the agent API |
| `GET /llms.txt` | Short index for LLMs |
| `GET /api/agent` | Unauthenticated discovery: links to the docs and what an agent can and cannot do |

Agents authenticate with `Authorization: Bearer <AGENT_API_KEY>`. The flow:

1. `POST /api/agent/drafts` with `{ "recipients": [...], "subject": "...", "html": "..." }`
2. `PUT /api/agent/drafts/{id}` to revise (each change is a new revision)
3. `POST /api/agent/drafts/{id}/submit` with the current `revision_id`
4. Poll `GET /api/agent/drafts/{id}`: `status`, `review`, `send` progress and `next_actions`. Each draft response also has a `review_url` the agent hands to the human
5. `GET /api/agent/drafts/{id}/recipients` to page through the list and per-recipient send status

Every error has a stable `code`, a plain-English `message` and a `hint` that describes a valid request. Agents should send to `delivered@resend.dev` on the demo deployment (see [Running locally](#running-locally)). Every draft response has `next_actions`, so an agent never has to guess what to do next.

## For humans

The review UI is at `/`. Sign in with the reviewer token. From there you can:

- see pending drafts, with their recipient counts
- inspect a draft: recipients (searchable, paged), subject, a sandboxed preview of the HTML and its source, and the revision history
- approve or reject it
- watch sending progress, and resume a send that failed or stalled

The preview renders agent HTML in `<iframe sandbox="" srcdoc>` with no `allow-*` flags, so scripts, forms and pop-ups in an email can't touch the reviewer's session. The UI only talks to the server through `/api/review/*`.

## How a draft moves

```
draft ──submit──▶ pending_approval ──approve──▶ approved ──▶ sent
  ▲                    │                           │
  └──── revise ────────┤                           └──▶ failed ──resume──▶ approved
                       └──reject──▶ rejected ──revise──▶ draft
```

- `approved` means sending is in progress. `sent` means Resend accepted every email; delivery isn't tracked (no webhooks).
- `failed` means sending finished with at least one failed batch. `send.partial` is true if some recipients were sent. Only a human can resume, and resuming retries only the failed batches.
- Revising is refused while a draft is `approved` or `sent`.

## Guarantees

Each of these is exercised by the tests.

**Approval binds to exactly what the human saw.** Approve sends `revision_id`, `content_hash` and `recipient_count`. The server recomputes the hash from the stored revision (canonical recipient set, subject, html) and compares it, so a stale or tampered approval is refused. Revisions are immutable. Any change by the agent creates a new revision, withdraws the pending request and needs a new approval.

**Agent credentials can never approve or send.** There are two separate secrets. The agent key is refused (403) on every `/api/review/*` route, and the reviewer token is refused on every `/api/agent/*` route. Approve, reject and resume exist only on review routes.

**No double sends.** There are three independent layers:

1. Approve is a conditional `UPDATE drafts ... WHERE status = 'pending_approval' AND current_revision_id = ?`, so exactly one of any number of concurrent approvals wins. Repeats return the current state.
2. `sends.revision_id` is unique, so the job and its batches are created once. Each batch is claimed by one worker at a time (`FOR UPDATE SKIP LOCKED`), and only the worker holding the claim may record its outcome.
3. Each batch has its own Resend `Idempotency-Key`. A retry after an unknown outcome reuses it, so Resend deduplicates an email that was actually sent.

**Retries follow the outcome:**

| Outcome | What happens |
|---|---|
| Timeout, network error, 5xx, 409 | Unknown outcome: keep the key, mark the batch failed, retry with the same key |
| Definite 4xx rejection | Nothing was sent: rotate to a new key so a cached error can't block the retry |
| 429 rate limit | Not processed: wait for `retry-after`, retry with the same key |
| 429 quota exceeded | Stop, and mark the remaining batches failed without sending them |
| Unknown outcome and key older than 23h | Never retried automatically (Resend forgets keys after 24h). It's shown as not resumable |

Resend is never called inside a database transaction. Batch boundaries are a pure function of the revision and are stored with the job, so a retry always covers the same recipients.

## Sending

Approve answers `202` once the job exists. A worker started with Next.js `after()` then sends the batches in the background:

- up to 100 recipients per batch, using Resend's batch endpoint in strict mode, so a batch fully succeeds or fully fails
- about 5 requests per second (Resend allows 10 per team)
- the worker stops itself after 240s, inside the route's 300s `maxDuration`

If a worker dies, its batch is picked up again with the same key after 90 seconds. The UI offers **Resume sending** when nothing has progressed for 2 minutes.

## Running locally

Requirements: Node 20.12+, a Neon (or any Postgres) database, a Resend API key.

```bash
npm install
cp .env.example .env.local   # fill in the values; each is documented in the file
npm run db:migrate           # apply drizzle/ migrations
npm run dev                  # http://localhost:3000
```

`AGENT_API_KEY` and `REVIEWER_TOKEN` must be different secrets of at least 32 characters (`openssl rand -hex 32`).

Without a verified domain, the sender is `onboarding@resend.dev`. Resend then only delivers to the email address of the account that owns the API key, and to test addresses such as `delivered@resend.dev`. Any other recipient fails its batch with Resend's error, so `/SKILL.md` tells agents to send to `delivered@resend.dev`.

`drizzle/README.md` covers a database that was created with `db:push` before migrations existed.

## Tests

```bash
npm test         # Vitest
npm run typecheck
```

The tests run against a real Postgres database, with Resend replaced by a fake that models the batch endpoint and its idempotency behaviour. That fake counts how many emails each recipient really received. `tests/setup.ts` refuses to run against a production branch.

Covered:

- **Approval:** approval binding (hash, revision and count mismatch), revise racing approve, approve racing reject, 10 concurrent approvals creating exactly one job.
- **Workers and recovery:** racing workers never sending the same batch twice, and a worker killed mid-send recovered with no duplicate email, including when Resend created the email but the response was lost.
- **Failures:** partial failure and resume, 429 retried with the same key, the 23-hour rule per batch, and a 5,000-recipient job emailing everyone exactly once.
- **Inputs and access:** recipient validation and paging, and credential separation on the real route handlers.

Each concurrency test repeats several rounds.

## Layout

```
src/
  app/                 Next.js routes: review UI at /, API under /api, docs at /SKILL.md etc.
    api/agent/         agent-key routes (thin wrappers over services)
    api/review/        reviewer-token routes
  services/drafts.ts   agent operations, the draft view and send progress
  services/review.ts   approve, reject, resume, and the send worker
  lib/                 auth, env, errors, hashing, validation, chunking, Resend client, docs builders
  components/          review UI (client components, CSS Modules)
  db/schema.ts         drafts, revisions, reviews, sends, send_chunks
drizzle/               migrations
tests/                 Vitest suites and the fake Resend
```

## Scope and limits

Out of scope:

- personalisation or merge variables
- attachments, scheduling and unsubscribe headers
- delivery and bounce webhooks
- user accounts (the credentials are preconfigured)

Known limits:

- **Very large HTML:** batches shrink towards one recipient, so a send could need more than one 240s worker run. It then waits for a human to resume; there is no automatic rescheduling.
- **Rate limit:** the 5 requests per second limit is per worker. Two workers running at once (for example an approve and a resume) could approach Resend's limit; 429s are handled.
- **Recipient case:** addresses are lowercased before storing and hashing. Strictly, the part before the `@` can be case-sensitive.
