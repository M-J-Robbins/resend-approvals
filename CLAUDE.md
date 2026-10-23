# Agent email approval service

Agents draft emails through a REST API. A human reviews and approves or rejects each draft in a web UI. Approved emails are sent through Resend. Stack: Next.js (App Router), Neon Postgres, Drizzle, TypeScript.

A draft is "one email, many recipients": one canonical `recipients` list (up to `MAX_RECIPIENTS`, default 5,000), one subject, one HTML body. Each recipient receives their own individual copy. There is no to/cc/bcc. Sending is asynchronous: approve creates a send job, and a background worker sends it as Resend batch requests ("chunks") of up to 100.

## Commands

- `npm run dev` / `npm run build`
- `npm run typecheck`
- `npm test` (Vitest, `tests/`): runs against the real database in `.env.local` with a fake Resend. `tests/setup.ts` refuses to run on the `production` branch.
- `npm run db:generate` / `npm run db:migrate` (migrations in `drizzle/`, applied over the direct `DATABASE_URL_UNPOOLED` connection to the branch in `.env.local`). `drizzle/README.md` explains the one-off baseline step for databases that were created with `db:push`.
- `npm run db:push` (apply the schema directly; dev experiments only, now that migrations exist)
- `neon checkout <branch>` switches Neon branch and rewrites the Neon vars in `.env.local`
- Env vars are documented in `.env.example`. Copy it to `.env.local`.

## Layout

- `src/db/schema.ts`: Drizzle schema (`drafts`, `revisions`, `reviews`, `sends`, `send_chunks`)
  - `revisions.recipients` is the canonical list (trimmed, lowercased, de-duplicated, sorted). Chunk N covers `recipients[N*chunk_size, (N+1)*chunk_size)`; addresses are never copied into `send_chunks`.
  - `sends` is the one job row per revision (aggregate status, `chunk_size`, `chunk_count`). `send_chunks` holds one row per Resend batch request with its own idempotency key, attempts and Resend ids.
- `src/services/drafts.ts`: agent operations (create, revise, submit, get, list, list recipients) and the draft view with send progress
- `src/services/review.ts`: human operations (approve, reject, resume) and the worker (`processSends`, `finalizeDraft`)
- `src/lib/`: auth, env, errors, hashing, validation, chunking (`chunks.ts`), Resend batch client
- Approve and resume answer 202 and start the worker with `after()` (`sendInBackground` in `src/lib/route.ts`). Both routes have `maxDuration = 300` (the Hobby maximum with fluid compute); the worker stops itself after 240s, and a resume picks up what is left.
- Routes are thin wrappers over the services:
  - `/api/agent/*` accepts only the agent key
  - `/api/review/*` accepts only the reviewer token

## Invariants (do not break these)

1. **Revisions are immutable.** Never UPDATE a row in `revisions`. A change inserts a new revision and sets the draft back to `draft`.
2. **Approval binds to a revision.** Approve takes `revision_id`, `content_hash` and `recipient_count`. The hash covers the canonical recipient set, subject and html, and is recomputed from the stored row, never trusted from the client. The count must match the stored count.
3. **Credentials never cross.** The agent key must be rejected on `/api/review/*`. The reviewer token must be rejected on `/api/agent/*`. Agents can never approve, reject, resume or trigger a send.
4. **No double sends.** Three layers, all required:
   - Approve is a conditional `UPDATE ... WHERE status='pending_approval' AND current_revision_id=?`, so only one request wins.
   - `sends.revision_id` is unique, and only the request that inserts the job row inserts its chunks. Each chunk is claimed by one worker at a time (`UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)`), and outcomes are only recorded by the worker holding the claim (same `attempts`).
   - Each chunk's stored `idempotency_key` is sent as Resend's `Idempotency-Key` header.
5. **Resend is called outside DB transactions**, never inside one. Approve never calls Resend.
6. **Idempotency keys are per chunk:** `<revisionId>:c<chunkIndex>:g<keyGeneration>`. Keep the key after an uncertain outcome (timeout, network error, 5xx, 409). Rotate it (generation + 1, `key_first_used_at` reset) only after a definite 4xx rejection. A 429 rate limit was not processed: retry the same key after `retry-after`. Never retry an uncertain chunk once its key is older than 23h (Resend remembers keys for 24h); such chunks stay `failed` and resume reports them as `skipped_unsafe`.
7. **Chunking is deterministic.** Chunk size is a pure function of the revision (`chunkSizeFor` in `src/lib/chunks.ts`: `min(100, floor(10 MB / per-email bytes))`, at least 1) and is stored on the job at approval, so chunk boundaries never move on a retry.
8. **Lock order is `drafts`, then `sends`, then `send_chunks`.** Every transaction that writes more than one of them takes the locks in that order. The reverse order deadlocks under concurrent workers and resumes.
9. **`from` is fixed server-side.** Agents cannot set it.
10. **Revisions are never edited while sending.** Revising is refused (`draft_locked`) while a draft is `approved` or `sent`.

## Behaviour to preserve

- Errors carry a stable `code`, a plain-English `message` and a `hint`, because agents read them.
- Draft responses include `next_actions` so agents don't have to guess the next step.
- The sender is `onboarding@resend.dev` (no verified domain). Resend only delivers it to the email address of the account that owns the API key and to its test addresses (`delivered@resend.dev`, `delivered+label@resend.dev`). Batches are sent with `x-batch-validation: strict`, so one other address fails its whole batch, which must surface as a `failed` chunk with Resend's error.
- "sent" means accepted by Resend. There are no delivery webhooks.
- Draft statuses: `approved` means sending is in progress, `sent` means every chunk succeeded, `failed` means the job finished with at least one failed chunk (`send.partial` when some succeeded). Only a human can resume.

## Status

Done:
- Schema, services, auth, validation, Resend batch client, migrations (`drizzle/0000_baseline`, `0001_recipients_and_send_chunks`). The dev branch is migrated. **Production is not**: apply `0001` there when deploying (see `drizzle/README.md`).
- API routes, all thin wrappers using `guard()` / `readJson()` / `agentJson()` from `src/lib/route.ts`:
  - Agent: `GET /api/agent` (unauthenticated discovery), `GET`/`POST /api/agent/drafts`, `GET`/`PUT /api/agent/drafts/[id]`, `POST /api/agent/drafts/[id]/submit`, `GET /api/agent/drafts/[id]/recipients`
  - Review: `GET /api/review/drafts`, `GET /api/review/drafts/[id]`, `GET .../recipients`, `POST .../approve` (202), `.../reject`, `.../resume` (202)
  - Reviewer session: `GET`/`POST`/`DELETE /api/review/session` (httpOnly, `SameSite=Strict` cookie holding the reviewer token)
  - `GET /api/health` (unauthenticated DB check)
- Agent docs: `/openapi.json`, `/llms.txt`, `/SKILL.md`, generated from `src/lib/docs/`. `/SKILL.md` reads the optional `SANDBOX_RECIPIENT` env var straight from `process.env` (deliberately not in `src/lib/env.ts`, so a missing docs hint never stops the app), and the docs read `MAX_RECIPIENTS` the same way. Both are public and must also be set in Vercel when deploying.
- Neon: project linked (`.neon`, `neon.ts`). Day-to-day work uses the `dev` branch, which has no expiry. `production` is the default branch. New branches created from `neon.ts` expire after 7 days.

- Tests (`tests/`): canonical hashing and chunk boundaries, credential separation, recipients validation and paging, concurrent approval (one job, ceil(N/size) batches), racing workers, crash recovery, partial failure and resume, 429 handling, the 23h rule per chunk, a 5,000-recipient job. `tests/helpers/fakeResend.ts` models the batch endpoint and counts emails per recipient.

- Review UI at `/` (client components in `src/components/`, one CSS Module each; styles use `src/app/tokens.css` plus element defaults in `src/app/base.css`):
  - Sign-in with the reviewer token; any 401 returns to sign-in. All server access goes through `src/lib/client/api.ts` (`/api/review/*` only, `import type` from services).
  - List with a status filter (default `pending_approval`) and recipient counts, polling every 5s while the tab is visible. `?draft=` and `?status=` live in the URL. Master-detail above 48rem, single column with a Back link below.
  - Detail: recipients panel (count and duplicates removed; the searchable list, 50 per page with per-recipient status once approved, opens in a native HTML `popover` from a "View all" button), subject, revision number and short hash, Preview/HTML source tabs, desktop/375px preview, review and send facts, revision history.
  - The preview is `<iframe sandbox="" srcdoc>` with `referrerPolicy="no-referrer"`. Never add `allow-*` flags, and never render agent HTML anywhere else except as escaped text.
  - The open draft is a snapshot: polling refreshes it only while it is the same revision, and a newer revision shows a Reload notice instead of swapping content. The recipients panel is pinned to that revision. Approve sends the `revision_id`, `content_hash` and `recipient_count` captured when the confirm dialog opened; above 100 recipients the reviewer types the count to enable it.
  - While a draft is `approved` it polls every 2s and shows a `role="progressbar"` with sent/failed/pending counts in words. A failed job lists the failed batches with **Resume sending**; so does an approved job with no progress for 2 minutes.
  - Light and dark themes: `.dark` / `.dark-theme` classes, or `prefers-color-scheme` via the "Added by UI build" block in `tokens.css` (a generated copy of the dark values).

To do:
- Apply migration `0001` to production when deploying (the owner does this).
- A job too large to finish in one 240s worker run (only possible with very large HTML, where chunks shrink towards 1 recipient) stops with chunks pending and needs a resume; there is no self-rescheduling.
