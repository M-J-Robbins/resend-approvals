import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  drafts,
  revisions,
  reviews,
  sendChunks,
  sends,
  type SendChunkRow,
} from "@/db/schema";
import { chunkCountFor, chunkIdempotencyKey, chunkRange, chunkSizeFor } from "@/lib/chunks";
import { conflict, notFound } from "@/lib/errors";
import { computeContentHash } from "@/lib/hash";
import { sendBatch } from "@/lib/resend";
import { getDraftView, isChunkResumable, KEY_SAFE_MS, type DraftView } from "./drafts";

/** A "sending" chunk this old is assumed to belong to a worker that died. */
const STUCK_AFTER_SECONDS = 90;
/** Stays below the routes' maxDuration (300s, the Hobby maximum with fluid compute). */
const DEFAULT_BUDGET_MS = 240_000;
/** Resend allows 10 requests/s per team, shared across keys; stay at half. */
const DEFAULT_MAX_RPS = 5;
/** 429 retries for one chunk before the worker gives up and leaves it pending. */
const MAX_RATE_LIMIT_RETRIES = 5;

const KEY_SAFE_SECONDS = KEY_SAFE_MS / 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Double-send protection has three layers:
 *  1. The conditional UPDATE on drafts lets exactly one approve request win.
 *  2. sends.revision_id is unique, so a job (and its chunks) is created at most
 *     once, and each chunk is claimed by one worker at a time (SKIP LOCKED).
 *  3. Each chunk's stored Idempotency-Key lets Resend dedupe a retried request
 *     whose outcome we never learned.
 *
 * Approve only creates the job. It never calls Resend: the route starts
 * processSends() after the response.
 */
export async function approveDraft(
  id: string,
  input: { revisionId: string; contentHash: string; recipientCount: number },
): Promise<DraftView> {
  await getDb().transaction(async (tx) => {
    const [revision] = await tx
      .select()
      .from(revisions)
      .where(and(eq(revisions.id, input.revisionId), eq(revisions.draftId, id)));
    if (!revision) throw notFound("Revision", input.revisionId);

    // Hash what is actually stored, not what the client claims it reviewed.
    if (computeContentHash(revision) !== input.contentHash) {
      throw conflict(
        "content_hash_mismatch",
        "content_hash does not match the revision being approved.",
        "Reload the draft and approve exactly what is shown.",
      );
    }
    if (input.recipientCount !== revision.recipientCount) {
      throw conflict(
        "recipient_count_mismatch",
        `recipient_count is ${input.recipientCount}, but this revision has ${revision.recipientCount} recipients.`,
        "Reload the draft and approve the recipient count that is shown.",
      );
    }

    const approved = await tx
      .update(drafts)
      .set({ status: "approved", updatedAt: sql`now()` })
      .where(
        and(
          eq(drafts.id, id),
          eq(drafts.status, "pending_approval"),
          eq(drafts.currentRevisionId, input.revisionId),
        ),
      )
      .returning({ id: drafts.id });

    if (approved.length === 0) {
      const [draft] = await tx.select().from(drafts).where(eq(drafts.id, id));
      if (!draft) throw notFound("Draft", id);
      if (draft.currentRevisionId !== input.revisionId) {
        throw conflict(
          "revision_changed",
          "The agent revised this draft after you opened it, so this approval was not applied.",
          "Reload the draft and review the new revision.",
        );
      }
      const [prior] = await tx
        .select()
        .from(reviews)
        .where(eq(reviews.revisionId, input.revisionId));
      // Repeated / concurrent approval: already done, report state, create nothing.
      if (prior?.decision === "approved") return;
      throw conflict(
        "invalid_state",
        `Draft is '${draft.status}', not pending_approval.`,
      );
    }

    await tx
      .insert(reviews)
      .values({ revisionId: input.revisionId, decision: "approved" });

    const chunkSize = chunkSizeFor(revision);
    const chunkCount = chunkCountFor(revision.recipientCount, chunkSize);
    const [job] = await tx
      .insert(sends)
      .values({ revisionId: input.revisionId, chunkSize, chunkCount })
      .onConflictDoNothing()
      .returning({ id: sends.id });
    // Only the request that created the job creates its chunks.
    if (!job) return;

    await tx.execute(sql`
      insert into send_chunks (id, revision_id, chunk_index, idempotency_key)
      select 'chk_' || replace(gen_random_uuid()::text, '-', ''), ${input.revisionId}, i,
             ${input.revisionId} || ':c' || i || ':g1'
      from generate_series(0, ${chunkCount - 1}::int) as i`);
  });

  return getDraftView(id);
}

export async function rejectDraft(
  id: string,
  input: { revisionId: string; reason: string },
): Promise<DraftView> {
  await getDb().transaction(async (tx) => {
    const [revision] = await tx
      .select({ id: revisions.id })
      .from(revisions)
      .where(and(eq(revisions.id, input.revisionId), eq(revisions.draftId, id)));
    if (!revision) throw notFound("Revision", input.revisionId);

    const rejected = await tx
      .update(drafts)
      .set({ status: "rejected", updatedAt: sql`now()` })
      .where(
        and(
          eq(drafts.id, id),
          eq(drafts.status, "pending_approval"),
          eq(drafts.currentRevisionId, input.revisionId),
        ),
      )
      .returning({ id: drafts.id });

    if (rejected.length === 0) {
      const [draft] = await tx.select().from(drafts).where(eq(drafts.id, id));
      if (!draft) throw notFound("Draft", id);
      if (draft.currentRevisionId !== input.revisionId) {
        throw conflict(
          "revision_changed",
          "The agent revised this draft after you opened it, so this rejection was not applied.",
          "Reload the draft and review the new revision.",
        );
      }
      const [prior] = await tx
        .select()
        .from(reviews)
        .where(eq(reviews.revisionId, input.revisionId));
      if (prior?.decision === "rejected") return; // repeated rejection is harmless
      throw conflict(
        "invalid_state",
        `Draft is '${draft.status}', not pending_approval.`,
      );
    }

    await tx.insert(reviews).values({
      revisionId: input.revisionId,
      decision: "rejected",
      reason: input.reason,
    });
  });

  return getDraftView(id);
}

/**
 * The worker. Claims chunks one at a time, sends each as one Resend batch
 * outside any transaction, and records the outcome. Several workers can run
 * for the same draft at once: SKIP LOCKED gives each chunk to one of them.
 * If a worker dies mid-chunk, the chunk stays "sending" and is reclaimed with
 * the same key once it is older than 90 seconds.
 */
export async function processSends(
  draftId: string,
  opts: { budgetMs?: number; maxRequestsPerSecond?: number } = {},
): Promise<void> {
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const minGapMs = 1000 / (opts.maxRequestsPerSecond ?? DEFAULT_MAX_RPS);
  const deadline = Date.now() + budgetMs;
  const db = getDb();

  const [draft] = await db.select().from(drafts).where(eq(drafts.id, draftId));
  if (!draft) throw notFound("Draft", draftId);
  if (draft.status !== "approved") return;
  const [revision] = await db
    .select()
    .from(revisions)
    .where(eq(revisions.id, draft.currentRevisionId));
  const [job] = await db.select().from(sends).where(eq(sends.revisionId, revision.id));
  if (!job) return;

  await failExpiredChunks(revision.id);

  let lastRequestAt = 0;
  const throttle = async () => {
    const wait = lastRequestAt + minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  };

  while (Date.now() < deadline) {
    const chunk = await claimChunk(revision.id);
    if (!chunk) break;

    const { start, end } = chunkRange(chunk.chunkIndex, job.chunkSize, revision.recipientCount);
    const batch = {
      recipients: revision.recipients.slice(start, end),
      subject: revision.subject,
      html: revision.html,
    };

    let result: Awaited<ReturnType<typeof sendBatch>>;
    let rateLimited = 0;
    for (;;) {
      await throttle();
      result = await sendBatch(batch, chunk.idempotencyKey);
      if (result.ok || result.outcome !== "rate_limited") break;
      // 429: Resend did not process the request. Same key, after retry-after,
      // if the budget allows; otherwise hand the chunk back untouched.
      const wait = result.retryAfterMs ?? 1000;
      if (++rateLimited > MAX_RATE_LIMIT_RETRIES || Date.now() + wait >= deadline) break;
      await touchChunk(chunk);
      await sleep(wait);
    }

    await recordOutcome(chunk, result);
    if (!result.ok && result.quotaExceeded) {
      await failPendingChunks(revision.id, `Not attempted: ${result.message}`);
      break;
    }
    if (!result.ok && result.outcome === "rate_limited") break;
  }

  await finalizeDraft(draftId);
}

/**
 * Atomically takes the lowest-index chunk that is pending, or "sending" but
 * abandoned, and whose key is still inside Resend's dedupe window.
 */
async function claimChunk(revisionId: string): Promise<SendChunkRow | null> {
  const [row] = (await getDb().execute(sql`
    update send_chunks
    set status = 'sending',
        attempts = attempts + 1,
        key_first_used_at = coalesce(key_first_used_at, now()),
        updated_at = now()
    where id = (
      select id from send_chunks
      where revision_id = ${revisionId}
        and (status = 'pending'
             or (status = 'sending' and updated_at < now() - make_interval(secs => ${STUCK_AFTER_SECONDS})))
        and (key_first_used_at is null
             or key_first_used_at > now() - make_interval(secs => ${KEY_SAFE_SECONDS}))
      order by chunk_index
      for update skip locked
      limit 1
    )
    returning *`)) as unknown as Record<string, unknown>[];
  return row ? toChunkRow(row) : null;
}

/** Raw `returning *` rows are snake_case strings; map them like Drizzle would. */
function toChunkRow(r: Record<string, unknown>): SendChunkRow {
  const date = (v: unknown) => (v == null ? null : new Date(v as string));
  return {
    id: r.id as string,
    revisionId: r.revision_id as string,
    chunkIndex: Number(r.chunk_index),
    status: r.status as SendChunkRow["status"],
    idempotencyKey: r.idempotency_key as string,
    keyGeneration: Number(r.key_generation),
    keyFirstUsedAt: date(r.key_first_used_at),
    attempts: Number(r.attempts),
    resendEmailIds: (r.resend_email_ids as string[] | null) ?? null,
    error: (r.error as string | null) ?? null,
    createdAt: date(r.created_at)!,
    updatedAt: date(r.updated_at)!,
  };
}

/** Only the worker that holds the claim (same attempt number) may write. */
const ownsChunk = (c: SendChunkRow) =>
  and(eq(sendChunks.id, c.id), eq(sendChunks.status, "sending"), eq(sendChunks.attempts, c.attempts));

/** Keeps a chunk that is waiting out a 429 from looking abandoned. */
async function touchChunk(c: SendChunkRow) {
  await getDb().update(sendChunks).set({ updatedAt: sql`now()` }).where(ownsChunk(c));
}

async function recordOutcome(
  c: SendChunkRow,
  result: Awaited<ReturnType<typeof sendBatch>>,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    if (result.ok) {
      await tx
        .update(sendChunks)
        .set({ status: "sent", resendEmailIds: result.ids, error: null, updatedAt: sql`now()` })
        .where(ownsChunk(c));
      return;
    }
    if (result.outcome === "rate_limited") {
      // Never processed by Resend: back to pending with the same key.
      await tx
        .update(sendChunks)
        .set({ status: "pending", error: result.message, updatedAt: sql`now()` })
        .where(ownsChunk(c));
      return;
    }
    const generation = c.keyGeneration + 1;
    await tx
      .update(sendChunks)
      .set({
        status: "failed",
        error: result.message,
        updatedAt: sql`now()`,
        // Resend rejected the request outright, so no email exists and a
        // cached error under the same key must not block the retry: use a new
        // key. If the outcome is unknown, keep the key so Resend can dedupe.
        ...(result.outcome === "definite"
          ? {
              keyGeneration: generation,
              idempotencyKey: chunkIdempotencyKey(c.revisionId, c.chunkIndex, generation),
              keyFirstUsedAt: null,
            }
          : {}),
      })
      .where(ownsChunk(c));
  });
}

/**
 * Chunks whose outcome may be unknown and whose key Resend has (nearly)
 * forgotten can never be retried safely: mark them failed so the job can
 * finish. A pending chunk with a set key timestamp was reset by a resume
 * after an uncertain failure; an abandoned "sending" chunk is uncertain too.
 */
async function failExpiredChunks(revisionId: string): Promise<void> {
  await getDb().execute(sql`
    update send_chunks
    set status = 'failed',
        error = coalesce(error || ' ', '') || '(Outcome unknown and the idempotency key is older than 23 hours, so it is not retried automatically.)',
        updated_at = now()
    where revision_id = ${revisionId}
      and key_first_used_at <= now() - make_interval(secs => ${KEY_SAFE_SECONDS})
      and (status = 'pending'
           or (status = 'sending' and updated_at < now() - make_interval(secs => ${STUCK_AFTER_SECONDS})))`);
}

/** After a quota error every later request would fail too; record that without sending. */
async function failPendingChunks(revisionId: string, error: string): Promise<void> {
  await getDb()
    .update(sendChunks)
    .set({ status: "failed", error, updatedAt: sql`now()` })
    .where(and(eq(sendChunks.revisionId, revisionId), eq(sendChunks.status, "pending")));
}

/**
 * Settles the draft once no chunk is pending or in flight: "sent" if every
 * chunk was accepted, otherwise "failed" (possibly partial). Idempotent and
 * safe to run from several workers: the drafts row lock serialises them.
 */
export async function finalizeDraft(draftId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    // Lock order: drafts, then sends, then send_chunks.
    const [draft] = await tx
      .select()
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .for("update");
    if (!draft || draft.status !== "approved") return;
    const [job] = await tx
      .select()
      .from(sends)
      .where(eq(sends.revisionId, draft.currentRevisionId))
      .for("update");
    if (!job) return;

    const [counts] = await tx
      .select({
        open: sql<number>`count(*) filter (where ${sendChunks.status} in ('pending', 'sending'))::int`,
        failed: sql<number>`count(*) filter (where ${sendChunks.status} = 'failed')::int`,
      })
      .from(sendChunks)
      .where(eq(sendChunks.revisionId, job.revisionId));
    if (counts.open > 0) return;

    const status = counts.failed === 0 ? "sent" : "failed";
    await tx.update(drafts).set({ status, updatedAt: sql`now()` }).where(eq(drafts.id, draftId));
    await tx.update(sends).set({ status, updatedAt: sql`now()` }).where(eq(sends.id, job.id));
  });
}

export type ResumeResult = DraftView & {
  resume: { chunks_reset: number; skipped_unsafe: number; hint?: string };
};

const UNSAFE_HINT =
  "Some chunks may already have been delivered, and Resend can no longer deduplicate them (idempotency keys last 24h). Check the Resend dashboard for those recipients before deciding what to do.";

/**
 * Reviewer-only. Puts failed chunks back in the queue (keeping each chunk's
 * key rules) and the draft back to "approved". The route then starts a worker.
 * Chunks still pending or abandoned mid-send need no reset: the worker
 * reclaims them.
 */
export async function resumeSend(id: string): Promise<ResumeResult> {
  const resume = await getDb().transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(drafts)
      .where(eq(drafts.id, id))
      .for("update");
    if (!draft) throw notFound("Draft", id);
    if (draft.status !== "failed" && draft.status !== "approved") {
      throw conflict(
        "not_resumable",
        `Draft is '${draft.status}'; only a send that is failed or in progress can be resumed.`,
      );
    }
    const [job] = await tx
      .select()
      .from(sends)
      .where(eq(sends.revisionId, draft.currentRevisionId))
      .for("update");
    if (!job) throw conflict("not_resumable", "No send exists for the current revision.");

    const chunks = await tx
      .select()
      .from(sendChunks)
      .where(eq(sendChunks.revisionId, job.revisionId))
      .for("update");
    const now = Date.now();
    const failed = chunks.filter((c) => c.status === "failed");
    const safe = failed.filter((c) => isChunkResumable(c, now));
    const skippedUnsafe = failed.length - safe.length;
    const open = chunks.some((c) => c.status === "pending" || c.status === "sending");

    if (safe.length === 0 && !open && skippedUnsafe > 0) {
      throw conflict(
        "retry_unsafe",
        `${skippedUnsafe} failed chunk${skippedUnsafe === 1 ? "" : "s"} can't be resumed safely.`,
        UNSAFE_HINT,
      );
    }

    if (safe.length > 0) {
      await tx
        .update(sendChunks)
        .set({ status: "pending", updatedAt: sql`now()` })
        .where(inArray(sendChunks.id, safe.map((c) => c.id)));
    }
    await tx.update(drafts).set({ status: "approved", updatedAt: sql`now()` }).where(eq(drafts.id, id));
    await tx.update(sends).set({ status: "sending", updatedAt: sql`now()` }).where(eq(sends.id, job.id));
    return {
      chunks_reset: safe.length,
      skipped_unsafe: skippedUnsafe,
      ...(skippedUnsafe > 0 ? { hint: UNSAFE_HINT } : {}),
    };
  });

  return { ...(await getDraftView(id)), resume };
}

