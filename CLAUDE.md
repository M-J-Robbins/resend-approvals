# Agent email approval service

Agents draft emails through a REST API. A human reviews and approves or rejects each draft in a web UI. Approved emails are sent through Resend. Stack: Next.js (App Router), Neon Postgres, Drizzle, TypeScript.

## Commands

- `npm run dev` / `npm run build`
- `npm run typecheck`
- `npm test` (Vitest, `tests/`): runs against the real database in `.env.local` with a fake Resend. `tests/setup.ts` refuses to run on the `production` branch.
- `npm run db:push` (apply the schema to the branch in `.env.local`, over the direct `DATABASE_URL_UNPOOLED` connection)
- `neon checkout <branch>` switches Neon branch and rewrites the Neon vars in `.env.local`
- Env vars are documented in `.env.example`. Copy it to `.env.local`.

## Layout

- `src/db/schema.ts`: Drizzle schema (`drafts`, `revisions`, `reviews`, `sends`)
- `src/services/drafts.ts`: agent operations (create, revise, submit, get, list)
- `src/services/review.ts`: human operations (approve, reject, retry-send) and the Resend send
- `src/lib/`: auth, env, errors, hashing, validation, Resend client
- Routes are thin wrappers over the services:
  - `/api/agent/*` accepts only the agent key
  - `/api/review/*` accepts only the reviewer token

## Invariants (do not break these)

1. **Revisions are immutable.** Never UPDATE a row in `revisions`. A change inserts a new revision and sets the draft back to `draft`.
2. **Approval binds to a revision.** Approve takes `revision_id` and `content_hash`. The hash is recomputed from the stored row, never trusted from the client.
3. **Credentials never cross.** The agent key must be rejected on `/api/review/*`. The reviewer token must be rejected on `/api/agent/*`. Agents can never approve, reject, retry or trigger a send.
4. **No double sends.** Three layers, all required:
   - Approve is a conditional `UPDATE ... WHERE status='pending_approval' AND current_revision_id=?`, so only one request wins.
   - `sends.revision_id` is unique, and only the request that inserts the row calls Resend.
   - The stored `sends.idempotency_key` is sent as Resend's `Idempotency-Key` header.
5. **Resend is called outside DB transactions**, never inside one.
6. **Idempotency key rotation:** keep the key after an uncertain outcome (timeout, 5xx, 409). Rotate it only after a definite 4xx rejection. Never retry an uncertain send once the key is older than 23h (Resend remembers keys for 24h).
7. **`from` is fixed server-side.** Agents cannot set it.
8. **Lock `drafts` before `sends`.** Every transaction that writes both must touch the `drafts` row first. The reverse order deadlocks under concurrent retries.

## Behaviour to preserve

- Errors carry a stable `code`, a plain-English `message` and a `hint`, because agents read them.
- Draft responses include `next_actions` so agents don't have to guess the next step.
- The sender is `onboarding@resend.dev` (no verified domain). Resend only delivers it to the email address of the account that owns the API key. Other recipients fail and must surface as a `failed` send with Resend's error.

## Status

Done:
- Schema, services, auth, validation, Resend client.
- API routes, all thin wrappers using `guard()` / `readJson()` / `agentJson()` from `src/lib/route.ts`:
  - Agent: `GET /api/agent` (unauthenticated discovery), `GET`/`POST /api/agent/drafts`, `GET`/`PUT /api/agent/drafts/[id]`, `POST /api/agent/drafts/[id]/submit`
  - Review: `GET /api/review/drafts`, `GET /api/review/drafts/[id]`, `POST .../approve`, `.../reject`, `.../retry-send` (approve and retry set `maxDuration = 30`)
  - Reviewer session: `GET`/`POST`/`DELETE /api/review/session` (httpOnly, `SameSite=Strict` cookie holding the reviewer token)
  - `GET /api/health` (unauthenticated DB check)
- Agent docs: `/openapi.json`, `/llms.txt`, `/SKILL.md`, generated from `src/lib/docs/`. `/SKILL.md` reads the optional `SANDBOX_RECIPIENT` env var straight from `process.env` (deliberately not in `src/lib/env.ts`, so a missing docs hint never stops the app). It's public, and must also be set in Vercel when deploying.
- Neon: project linked (`.neon`, `neon.ts`). Day-to-day work uses the `dev` branch, which has no expiry. `production` is the default branch. New branches created from `neon.ts` expire after 7 days. Schema is pushed to both branches.

- Tests (`tests/`): content hash, credential separation, concurrent approval, revisions, send retry (including 10 concurrent retries).

- Review UI at `/` (client components in `src/components/`, one CSS Module each; styles use `src/app/tokens.css` plus element defaults in `src/app/base.css`):
  - Sign-in with the reviewer token; any 401 returns to sign-in. All server access goes through `src/lib/client/api.ts` (`/api/review/*` only, `import type` from services).
  - List with a status filter (default `pending_approval`), polling every 5s while the tab is visible. `?draft=` and `?status=` live in the URL. Master-detail above 48rem, single column with a Back link below.
  - Detail: To/Cc/Bcc in full, subject, revision number and short hash, Preview/HTML source tabs, desktop/375px preview, review and send facts, revision history.
  - The preview is `<iframe sandbox="" srcdoc>` with `referrerPolicy="no-referrer"`. Never add `allow-*` flags, and never render agent HTML anywhere else except as escaped text.
  - The open draft is a snapshot: polling refreshes it only while it is the same revision, and a newer revision shows a Reload notice instead of swapping content. Approve sends the `revision_id` and `content_hash` captured when the confirm dialog opened.
  - Light and dark themes: `.dark` / `.dark-theme` classes, or `prefers-color-scheme` via the "Added by UI build" block in `tokens.css` (a generated copy of the dark values).

To do: nothing outstanding.