# Email approvals for agents

A service that lets AI agents prepare emails and lets a human decide what gets sent.

An agent discovers the API, creates and revises a draft, submits it for approval, and polls to learn what happened. A human reviews the exact recipients and content in a web UI and approves or rejects it. Approved drafts are sent through [Resend](https://resend.com).

A draft is one email for many recipients: one `recipients` list (up to 5,000 addresses), one subject, one HTML body. Every recipient gets their own individual copy, so there is no shared To, cc or bcc. A single transactional email is a list of one.

Stack: TypeScript, Next.js (App Router) on Vercel, Neon Postgres, Drizzle, Vitest.

## Try it

The service is live at **https://resend-approvals.vercel.app**. The agent key and the reviewer token were shared with the Resend team in the Slack submission message. They will be rotated after the review.

1. **Give your agent the docs and the agent key.** For example: *"Read https://resend-approvals.vercel.app/SKILL.md. Using this API key, draft an email inviting the team to Thursday's planning meeting, send it to delivered@resend.dev, and submit it for my approval."* The agent returns a `review_url`.
2. **Review it as a human.** Open the `review_url`, or https://resend-approvals.vercel.app/, and sign in with the reviewer token. Check the recipients and the preview, then approve or reject.
3. **Watch the agent find out.** Ask the agent for the draft's status. It sees `approved`, then `sent` (or the reviewer's reason if you rejected it).

Things worth trying:
- ask the agent to revise a draft while it is open in the review UI
- try to approve with the agent key (it is refused)
- approve the same draft from two tabs (it is sent once)

**Limits of the demo deployment.** It sends from Resend's shared testing sender (`onboarding@resend.dev`), which only delivers to Resend's test addresses, so use `delivered@resend.dev` or `delivered+anything@resend.dev`. Any other address fails its batch, and the failure is shown in the UI and to the agent. Drafts are capped at 10 recipients (`MAX_RECIPIENTS`) to protect the free plan's daily quota; the service itself supports 5,000.

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
2. `PUT /api/agent/drafts/{id}` to revise (each change is a new revision). Fields replace their value in full, so the response's `recipients_change` warns if recipients were dropped
3. `POST /api/agent/drafts/{id}/submit` with the current `revision_id`
4. Poll `GET /api/agent/drafts/{id}`: `status`, `review`, `send` progress and `next_actions`. Each draft response also has a `review_url` the agent hands to the human
5. `GET /api/agent/drafts/{id}/recipients` to page through the list and per-recipient send status

Every error has a stable `code`, a plain-English `message` and a `hint` that describes a valid request. Agents should send to `delivered@resend.dev` on the demo deployment (see [Try it](#try-it)). Every draft response has `next_actions`, so an agent never has to guess what to do next.

## For humans

The review UI is at `/`. Sign in with the reviewer token. From there you can:

- see pending drafts, with their recipient counts
- inspect a draft like a received email: From, To (searchable, paged recipients), subject and preview text, a sandboxed preview of the HTML and its source, the email's size with a warning near Gmail's 102 KB clipping limit, and the revision history
- check its review hints: a "Review hints (N)" button next to Approve lists things worth checking (so far: the email's size against Gmail's clipping limit). Each hint can be ignored or added to the review notes. The notes are the reason sent to the agent on rejection, and Approve is turned off while there are any
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

`AGENT_API_KEY` and `REVIEWER_TOKEN` must be different secrets of at least 32 characters (`openssl rand -hex 32`). The other variables are documented in `.env.example`.

Without a verified domain, the sender is `onboarding@resend.dev`. Resend then only delivers to the email address of the account that owns the API key, and to test addresses such as `delivered@resend.dev`. Any other recipient fails its batch with Resend's error, so `/SKILL.md` tells agents to send to `delivered@resend.dev`.

`drizzle/README.md` covers a database that was created with `db:push` before migrations existed.

## Tests

```bash
npm test         # Vitest
npm run typecheck
npm run lint     # ESLint with Next's config
```

The tests use the database in `.env.local`, so point it at a development database or branch (on Neon, a branch of your project). They delete only the rows they create. They run against a real Postgres database, with Resend replaced by a fake that models the batch endpoint and its idempotency behaviour. That fake counts how many emails each recipient really received. `tests/setup.ts` refuses to run against a production branch.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, the migrations, the tests and the build on every pull request, against a throwaway Postgres 17 container with dummy keys.

Covered:

- **Approval:** approval binding (hash, revision and count mismatch), revise racing approve, approve racing reject, 10 concurrent approvals creating exactly one job.
- **Workers and recovery:** racing workers never sending the same batch twice, and a worker killed mid-send recovered with no duplicate email, including when Resend created the email but the response was lost.
- **Failures:** partial failure and resume, 429 retried with the same key, the 23-hour rule per batch, and a 5,000-recipient job emailing everyone exactly once.
- **Inputs and access:** recipient validation and paging, and credential separation on the real route handlers.
- **Agent guidance:** every validation error carries a hint, draft responses carry a `review_url`, and a revise that drops recipients is flagged.

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

## Design decisions and tradeoffs

**One email, many recipients, each sent an individual copy.** A draft has one recipient list instead of To, Cc and Bcc. The reviewer approves one list, one subject and one body. Nobody sees anyone else's address, and the send maps directly onto Resend's batch endpoint. The cost: no shared threads, such as a group email where everyone can reply all. A single transactional email is just a list of one.

**Approval is bound to an immutable revision.** Approve names a revision and repeats its content hash and recipient count. The server recomputes the hash from the stored row. The simpler alternative, approving a draft id, has a race: the agent edits between the reviewer reading and clicking. Immutable revisions also give the review UI a full history for free. The cost is a row per edit, which is small next to the guarantee.

**Postgres is the lock and the queue.** Double sends are prevented by a conditional `UPDATE`, a unique constraint on the send job, and `FOR UPDATE SKIP LOCKED` to claim batches. A message queue or Redis lock would add a second system, and a queue is at-least-once anyway, so it would still need the database checks and the idempotency keys. The state already lives in Postgres, and one transaction can check it and change it together.

**Background sending with Next.js `after()`, not a job queue or cron.** Approve answers `202` and the same function keeps running to send. That needs no extra infrastructure on Vercel, and a demo-sized send is a single Resend request. The cost: a run is capped at 300 seconds (the worker stops itself at 240), and nothing restarts a stalled or very long send by itself, so a human clicks **Resume**. The UI offers it after 2 minutes with no progress. A durable queue (for example QStash or Inngest) is the next step if sends got large; the chunk table already holds all the state a queue worker would need.

**An idempotency key per batch, retried by outcome.** Resend's batch endpoint takes one `Idempotency-Key` per request, so each batch of up to 100 has its own. A retry after an unknown outcome (timeout, 5xx) reuses the key, so Resend drops a duplicate. A definite rejection rotates the key. A batch whose outcome is unknown and whose key is older than 23 hours is never retried automatically, because Resend forgets keys after 24 hours. The alternative, never retrying unknown outcomes, would turn every network blip into a failed send.

**Strict batch validation.** Batches use `x-batch-validation: strict`, so a batch fully succeeds or fully fails. That keeps each batch's state simple and makes retries safe. The cost: one bad address fails up to 99 good ones in the same batch. Addresses are validated when the draft is created, which makes this rare outside the demo's testing sender.

**Two preconfigured secrets, no accounts.** One agent key and one reviewer token, each refused on the other's routes. That is enough to make sure agents can't approve. The cost: drafts don't record which agent made them, so every agent sees the whole draft list. Per-agent keys would fix that.

**REST plus written docs for agents.** Agents get `/SKILL.md`, an OpenAPI spec and `/llms.txt`. Every response lists `next_actions`, and every error has a `hint`. That works with any agent that can make HTTP requests, without installing anything. The docs were tested by giving fresh agent sessions only the skill URL, then fixing whatever they hesitated over. Two examples: the test-recipient rule moved to the top of the skill, and revise responses now warn when the recipient list shrank. An MCP server would be more convenient for some agents, and is the first thing on the list below.

**A sandboxed preview.** Agent HTML is rendered in `<iframe sandbox="" srcdoc>`, so scripts and forms can't run. Remote images still load, so a tracking pixel in a draft would record an "open" when the reviewer looks at it. Blocking remote images until the reviewer allows them would fix that.

**Mobile presets are device sizes, not email client sizes.** The mobile preview's presets use each phone's screen size in CSS pixels. A real email client takes some of that space for its own toolbars, headers and margins, and some clients add padding around the email, so the area an email actually gets is smaller and differs between apps. The presets are a quick starting point for checking a layout at phone widths, not an exact match for how Gmail or Apple Mail will show it. Width and height can be dragged or typed to any size.

**Dark mode preview uses the email's own `prefers-color-scheme` styles.** The preview's Colour scheme dropdown (Light, Dark or System) sets `color-scheme` on the iframe, which switches the email's `@media (prefers-color-scheme: dark)` rules (and dark-only `<picture>` sources) on or off without changing its HTML or the sandbox. Light is the default, because most email clients show light. This matches clients that honour those styles, such as Apple Mail. Gmail's apps apply their own colour inversion and Outlook has its own dark mode selectors, and the preview shows neither. It needs a browser that lets an iframe's `color-scheme` decide the email's `prefers-color-scheme`: Chrome, Firefox and Safari 27 or later do; Safari 26 and earlier don't ([WebKit bug 284973](https://bugs.webkit.org/show_bug.cgi?id=284973)). The UI checks this once, using hidden iframes with a tiny test page of its own, and where it isn't supported it says so: the preview then follows the system setting, so the reviewer can change their system appearance or use another browser. Checked in Chrome, Firefox and Safari 27.

**Android forced dark is simulated, with one sandbox exception.** Emails without their own dark mode are recoloured by Android (and Gmail on Android) using Chromium's auto dark mode. The preview's "Android forced dark" and "Gmail Android dark" options reproduce that algorithm (Gmail's is the same, except that it leaves an email declaring `<meta name="color-scheme" content="light only">` untouched; no other value matters). Both keep `color-scheme: light` on the iframe, so the email's own dark media queries don't fire and only the simulation changes colours. The algorithm it reads every element's computed colours and rewrites text, backgrounds and borders in CIE Lab, with Chromium's thresholds and matrices. It follows Chromium's [dark mode colour filter](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/platform/graphics/dark_mode_color_filter.cc), [classifier](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/platform/graphics/dark_mode_color_classifier.cc) and [Lab colour space](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/platform/graphics/dark_mode_lab_color_space.h). Reading computed styles needs access to the rendered email, so while this option is selected the preview iframe is `sandbox="allow-same-origin"`: our page can read it, but the email still can't run scripts, submit forms or open windows. It is never combined with `allow-scripts`, because an email with both could lift its own sandbox and act as the signed-in reviewer. Every other option keeps `sandbox=""`.

**Syntax highlighting with the CSS Custom Highlight API.** The HTML source tab uses Zeno's [Dracula theme](https://draculatheme.com/). A small tokenizer finds the tags, attributes, values, comments and entities. The CSS Custom Highlight API then colours ranges of the source's single text node, so no markup is ever built from the agent's HTML and a large email doesn't create thousands of elements. The API has limited support in older browsers (it needs Chrome or Edge 105+, Safari 17.2+ or Firefox 140+); in those the source is shown uncoloured but is otherwise the same. Comments use a slightly lighter blue-grey than Dracula's, because the original is hard to read against the dark background.

**"sent" means accepted by Resend.** There are no delivery or bounce webhooks, so the service reports what Resend accepted, not what reached an inbox.

## Out of scope

- personalisation or merge variables
- attachments, scheduling and unsubscribe headers (an agent sending an existing HTML or .eml file puts its HTML in the draft; `/SKILL.md` says what is dropped)
- delivery and bounce webhooks
- user accounts (the credentials are preconfigured)

## With more time

- **An MCP server** with the same operations as the agent API, for agents that prefer tools to HTTP.
- **Per-agent keys**, so drafts have an owner and the list can be filtered by it.
- **A durable queue for sending**, so stalled and very large sends resume without a human.
- **A verified sending domain**, so any address can receive the demo's emails.
- **Delivery webhooks**, to report delivered, bounced and complained per recipient.
- **Richer review of the content:**
  - a toggle to view an email's HTML, plain-text and AMP versions, for emails that come from .eml files
  - mobile presets that match each email client's real viewing area (its toolbars and padding), not just the phone's screen size
  - remote images blocked until the reviewer allows them
  - dark mode as Gmail and Outlook render it (their own colour inversion and selectors), not only `prefers-color-scheme`
  - warnings for images that won't load (`cid:`, relative paths)
  - schema.org markup extracted and checked
  - colour contrast checked in dark mode and in Android/Gmail forced dark too, not only light mode

## Known limits

- **Very large HTML:** batches shrink towards one recipient, so a send could need more than one 240s worker run. It then waits for a human to resume; there is no automatic rescheduling.
- **Rate limit:** the 5 requests per second limit is per worker. Two workers running at once (for example an approve and a resume) could approach Resend's limit; 429s are handled.
- **Recipient case:** addresses are lowercased before storing and hashing. Strictly, the part before the `@` can be case-sensitive.
- **CSS `light-dark()` in Safari's dark mode preview:** in Safari, styles written with `light-dark()` don't switch when the preview's Light / Dark control changes, even though `@media (prefers-color-scheme)` rules and `<picture>` sources do. In Chrome all three switch. To check an email's `light-dark()` styles, use Chrome.
