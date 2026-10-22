import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { drafts, revisions, reviews, sends, type SendRow } from "@/db/schema";
import { conflict, notFound } from "@/lib/errors";
import { computeContentHash } from "@/lib/hash";
import { sendEmail } from "@/lib/resend";
import { getDraftView, type DraftView } from "./drafts";

/** A "sending" row this old is assumed to belong to a crashed request. */
const STUCK_AFTER_MS = 60_000;
/** Resend remembers idempotency keys for 24h; stay clear of the edge. */
const KEY_SAFE_MS = 23 * 60 * 60 * 1000;

/**
 * Double-send protection has three layers:
 *  1. The conditional UPDATE on drafts lets exactly one approve request win.
 *  2. sends.revision_id is unique, so a send is claimed at most once.
 *  3. Resend's Idempotency-Key (the stored key) dedupes if we retry a request
 *     whose outcome we never learned.
 */
export async function approveDraft(
  id: string,
  input: { revisionId: string; contentHash: string },
): Promise<DraftView> {
  const claimed = await getDb().transaction(async (tx) => {
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
      // Repeated / concurrent approval: already done, report state, send nothing.
      if (prior?.decision === "approved") return null;
      throw conflict(
        "invalid_state",
        `Draft is '${draft.status}', not pending_approval.`,
      );
    }

    await tx
      .insert(reviews)
      .values({ revisionId: input.revisionId, decision: "approved" });

    const [send] = await tx
      .insert(sends)
      .values({
        revisionId: input.revisionId,
        idempotencyKey: input.revisionId,
        keyFirstUsedAt: sql`now()`,
      })
      .onConflictDoNothing()
      .returning();
    return send ?? null;
  });

  // Resend is called outside the transaction, and only by the request that claimed the send.
  if (claimed) await executeSend(claimed);
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
 * Reviewer-only. Retries a failed send, or one stuck in "sending" because the
 * request that owned it died. Same revision, same stored idempotency key.
 */
export async function retrySend(id: string): Promise<DraftView> {
  const claimed = await getDb().transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(drafts)
      .where(eq(drafts.id, id))
      .for("update");
    if (!draft) throw notFound("Draft", id);
    if (draft.status !== "failed" && draft.status !== "approved") {
      throw conflict(
        "not_retryable",
        `Draft is '${draft.status}'; only failed sends can be retried.`,
      );
    }

    const [send] = await tx
      .select()
      .from(sends)
      .where(eq(sends.revisionId, draft.currentRevisionId))
      .for("update");
    if (!send) {
      throw conflict("not_retryable", "No send exists for the current revision.");
    }
    if (send.status === "sent") return null;

    const idleMs = Date.now() - send.updatedAt.getTime();
    if (send.status === "sending" && idleMs < STUCK_AFTER_MS) {
      throw conflict(
        "send_in_progress",
        "A send for this revision is already in progress.",
        "Check the draft again in about a minute.",
      );
    }
    if (
      send.keyFirstUsedAt &&
      Date.now() - send.keyFirstUsedAt.getTime() > KEY_SAFE_MS
    ) {
      throw conflict(
        "retry_unsafe",
        "The earlier attempt may have delivered, and Resend can no longer deduplicate it (idempotency keys last 24h).",
        "Check the Resend dashboard for this email before deciding what to do.",
      );
    }

    const [updated] = await tx
      .update(sends)
      .set({
        status: "sending",
        attempts: sql`${sends.attempts} + 1`,
        keyFirstUsedAt: sql`coalesce(${sends.keyFirstUsedAt}, now())`,
        updatedAt: sql`now()`,
      })
      .where(eq(sends.id, send.id))
      .returning();
    await tx
      .update(drafts)
      .set({ status: "approved", updatedAt: sql`now()` })
      .where(eq(drafts.id, id));
    return updated;
  });

  if (claimed) await executeSend(claimed);
  return getDraftView(id);
}

/**
 * Performs the Resend call for a send row this request has claimed, then
 * records the outcome. If the process dies in between, the row stays
 * "sending" and retrySend() picks it up with the same idempotency key.
 */
async function executeSend(send: SendRow): Promise<void> {
  const db = getDb();
  const [revision] = await db
    .select()
    .from(revisions)
    .where(eq(revisions.id, send.revisionId));

  const result = await sendEmail(revision, send.idempotencyKey);

  // Lock order must match approveDraft/retrySend: drafts first, then sends.
  // Reversing it deadlocks against a concurrent retry holding the drafts row.
  await db.transaction(async (tx) => {
    await tx
      .update(drafts)
      .set({ status: result.ok ? "sent" : "failed", updatedAt: sql`now()` })
      .where(eq(drafts.id, revision.draftId));

    if (result.ok) {
      await tx
        .update(sends)
        .set({
          status: "sent",
          resendEmailId: result.id,
          error: null,
          updatedAt: sql`now()`,
        })
        .where(eq(sends.id, send.id));
      return;
    }

    await tx
      .update(sends)
      .set({
        status: "failed",
        error: result.message,
        updatedAt: sql`now()`,
        // Resend rejected the request outright, so no email exists and a
        // cached error under the same key must not block the retry: use a new
        // key. If the outcome is unknown, keep the key so Resend can dedupe.
        ...(result.definite
          ? {
              idempotencyKey: `${send.revisionId}:${send.attempts + 1}`,
              keyFirstUsedAt: null,
            }
          : {}),
      })
      .where(eq(sends.id, send.id));
  });
}
