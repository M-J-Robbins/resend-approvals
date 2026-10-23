import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  drafts,
  newId,
  revisions,
  reviews,
  sendChunks,
  sends,
  type DraftStatus,
  type RevisionRow,
  type SendRow,
} from "@/db/schema";
import { chunkRange } from "@/lib/chunks";
import { env } from "@/lib/env";
import { AppError, conflict, notFound } from "@/lib/errors";
import { computeContentHash } from "@/lib/hash";
import {
  checkRecipients,
  type CreateDraftInput,
  type RecipientsQuery,
  type ReviseDraftInput,
} from "@/lib/validation";

/** Recipients shown inline in a draft; the rest are paged via /recipients. */
const RECIPIENTS_PREVIEW = 10;
/** Failed chunks listed in send.errors. */
const MAX_SEND_ERRORS = 20;
/** Resend remembers idempotency keys for 24h; stay clear of the edge. */
export const KEY_SAFE_MS = 23 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Views: the JSON shape returned to agents and to the review UI       */
/* ------------------------------------------------------------------ */

export interface DraftView {
  id: string;
  status: DraftStatus;
  /** The revision a human would approve right now. */
  revision: {
    id: string;
    number: number;
    /** Unique recipients. Each one receives an individual email. */
    recipient_count: number;
    /** The first recipients in sorted order. Page the rest via /recipients. */
    recipients_preview: string[];
    /** Duplicates collapsed when this revision's list was given. */
    duplicates_removed: number;
    subject: string;
    html: string;
    content_hash: string;
    created_at: string;
  };
  /** Decision on the current revision, or null if nobody has decided yet. */
  review: { decision: "approved" | "rejected"; reason: string | null; decided_at: string } | null;
  /** Send progress for the current revision, or null if it was never approved. */
  send: SendProgress | null;
  revisions: { id: string; number: number; content_hash: string; created_at: string }[];
  created_at: string;
  updated_at: string;
}

/** "sent" means accepted by Resend, not delivered. */
export interface SendProgress {
  status: "sending" | "sent" | "failed";
  recipients_total: number;
  recipients_sent: number;
  recipients_failed: number;
  /** Not yet attempted, or in flight. */
  recipients_pending: number;
  chunks_total: number;
  chunks_sent: number;
  chunks_failed: number;
  chunks_pending: number;
  /** Some recipients were sent and some failed. */
  partial: boolean;
  /** Failed chunks, lowest index first (at most 20). */
  errors: {
    chunk_index: number;
    first_recipient: string;
    last_recipient: string;
    recipient_count: number;
    error: string | null;
    attempts: number;
    /** false when the outcome is unknown and Resend can no longer deduplicate a retry. */
    resumable: boolean;
  }[];
  /** Last recorded progress on the job or any chunk. */
  updated_at: string;
}

export interface RecipientItem {
  email: string;
  /** null until the draft is approved. */
  status: "pending" | "sent" | "failed" | null;
  resend_email_id: string | null;
}

export interface NextAction {
  action: string;
  description: string;
  method?: string;
  path?: string;
  body?: Record<string, string>;
}

export async function getDraftView(id: string): Promise<DraftView> {
  const db = getDb();
  const [draft] = await db.select().from(drafts).where(eq(drafts.id, id));
  if (!draft) throw notFound("Draft", id);

  const [revision] = await db
    .select()
    .from(revisions)
    .where(eq(revisions.id, draft.currentRevisionId));
  const [review] = await db
    .select()
    .from(reviews)
    .where(eq(reviews.revisionId, revision.id));
  const [send] = await db
    .select()
    .from(sends)
    .where(eq(sends.revisionId, revision.id));
  const progress = send ? await sendProgress(send, revision) : null;
  const history = await db
    .select({
      id: revisions.id,
      number: revisions.number,
      contentHash: revisions.contentHash,
      createdAt: revisions.createdAt,
    })
    .from(revisions)
    .where(eq(revisions.draftId, id))
    .orderBy(revisions.number);

  return {
    id: draft.id,
    status: draft.status,
    revision: {
      id: revision.id,
      number: revision.number,
      recipient_count: revision.recipientCount,
      recipients_preview: revision.recipients.slice(0, RECIPIENTS_PREVIEW),
      duplicates_removed: revision.duplicatesRemoved,
      subject: revision.subject,
      html: revision.html,
      content_hash: revision.contentHash,
      created_at: revision.createdAt.toISOString(),
    },
    review: review
      ? {
          decision: review.decision,
          reason: review.reason,
          decided_at: review.decidedAt.toISOString(),
        }
      : null,
    send: progress,
    revisions: history.map((h) => ({
      id: h.id,
      number: h.number,
      content_hash: h.contentHash,
      created_at: h.createdAt.toISOString(),
    })),
    created_at: draft.createdAt.toISOString(),
    updated_at: draft.updatedAt.toISOString(),
  };
}

async function sendProgress(send: SendRow, revision: RevisionRow): Promise<SendProgress> {
  const db = getDb();
  const size = send.chunkSize;
  const total = revision.recipientCount;
  // Recipients in chunk i: the last chunk may be short.
  const chunkLen = sql<number>`least(${size}, ${total} - ${sendChunks.chunkIndex} * ${size})`;
  const [agg] = await db
    .select({
      chunksSent: sql<number>`count(*) filter (where ${sendChunks.status} = 'sent')::int`,
      chunksFailed: sql<number>`count(*) filter (where ${sendChunks.status} = 'failed')::int`,
      recipientsSent: sql<number>`coalesce(sum(${chunkLen}) filter (where ${sendChunks.status} = 'sent'), 0)::int`,
      recipientsFailed: sql<number>`coalesce(sum(${chunkLen}) filter (where ${sendChunks.status} = 'failed'), 0)::int`,
      lastUpdate: sql<string | null>`max(${sendChunks.updatedAt})`,
    })
    .from(sendChunks)
    .where(eq(sendChunks.revisionId, revision.id));

  const failed = await db
    .select()
    .from(sendChunks)
    .where(and(eq(sendChunks.revisionId, revision.id), eq(sendChunks.status, "failed")))
    .orderBy(sendChunks.chunkIndex)
    .limit(MAX_SEND_ERRORS);

  const lastChunkUpdate = agg.lastUpdate ? new Date(agg.lastUpdate) : send.updatedAt;
  const updatedAt = lastChunkUpdate > send.updatedAt ? lastChunkUpdate : send.updatedAt;

  return {
    status: send.status,
    recipients_total: total,
    recipients_sent: agg.recipientsSent,
    recipients_failed: agg.recipientsFailed,
    recipients_pending: total - agg.recipientsSent - agg.recipientsFailed,
    chunks_total: send.chunkCount,
    chunks_sent: agg.chunksSent,
    chunks_failed: agg.chunksFailed,
    chunks_pending: send.chunkCount - agg.chunksSent - agg.chunksFailed,
    partial: agg.recipientsSent > 0 && agg.recipientsFailed > 0,
    errors: failed.map((c) => {
      const { start, end } = chunkRange(c.chunkIndex, size, total);
      return {
        chunk_index: c.chunkIndex,
        first_recipient: revision.recipients[start],
        last_recipient: revision.recipients[end - 1],
        recipient_count: end - start,
        error: c.error,
        attempts: c.attempts,
        resumable: isChunkResumable(c),
      };
    }),
    updated_at: updatedAt.toISOString(),
  };
}

/**
 * A failed chunk can be retried unless its outcome is unknown AND its key is
 * too old for Resend to deduplicate. A definite rejection resets
 * key_first_used_at (new key), so a set timestamp means "uncertain".
 */
export function isChunkResumable(c: { keyFirstUsedAt: Date | null }, now = Date.now()): boolean {
  return !c.keyFirstUsedAt || now - c.keyFirstUsedAt.getTime() <= KEY_SAFE_MS;
}

/** One page of a revision's recipients, with per-recipient send status once approved. */
export async function listRecipients(draftId: string, query: RecipientsQuery) {
  const db = getDb();
  const [draft] = await db.select().from(drafts).where(eq(drafts.id, draftId));
  if (!draft) throw notFound("Draft", draftId);
  const revisionId = query.revision_id ?? draft.currentRevisionId;
  const [revision] = await db
    .select({ id: revisions.id, recipientCount: revisions.recipientCount })
    .from(revisions)
    .where(and(eq(revisions.id, revisionId), eq(revisions.draftId, draftId)));
  if (!revision) throw notFound("Revision", revisionId);
  const [send] = await db.select().from(sends).where(eq(sends.revisionId, revisionId));

  if (query.status && !send) {
    throw new AppError(
      400,
      "validation_error",
      "The status filter only applies once the draft has been approved.",
      "Leave out `status` until the draft is approved; before that no recipient has a send status.",
    );
  }

  const q = query.q ? query.q.toLowerCase() : null;
  // Chunk size 1 when there is no job: the join then simply finds no chunk.
  const size = send?.chunkSize ?? 1;
  const statusCond =
    query.status === "pending"
      ? sql`c.status in ('pending', 'sending')`
      : query.status
        ? sql`c.status = ${query.status}`
        : sql`true`;
  const filtered = sql`
    select e.email, (e.ord - 1)::int as idx, c.status as chunk_status,
           case when c.status = 'sent' then c.resend_email_ids[((e.ord - 1) % ${size}) + 1] end as resend_email_id
    from revisions rv
    cross join lateral unnest(rv.recipients) with ordinality as e(email, ord)
    left join send_chunks c on c.revision_id = rv.id and c.chunk_index = (e.ord - 1) / ${size}
    where rv.id = ${revisionId}
      and (${q}::text is null or strpos(e.email, ${q}::text) > 0)
      and ${statusCond}`;

  const [{ total }] = (await db.execute(
    sql`select count(*)::int as total from (${filtered}) f`,
  )) as unknown as { total: number }[];
  const rows = (await db.execute(
    sql`${filtered} order by idx offset ${query.offset} limit ${query.limit}`,
  )) as unknown as { email: string; chunk_status: string | null; resend_email_id: string | null }[];
  const domains = (await db.execute(sql`
    select split_part(e.email, '@', 2) as domain, count(*)::int as count
    from revisions rv cross join lateral unnest(rv.recipients) as e(email)
    where rv.id = ${revisionId}
    group by 1 order by 2 desc, 1 limit 5`)) as unknown as { domain: string; count: number }[];

  const items: RecipientItem[] = rows.map((r) => ({
    email: r.email,
    status: !send
      ? null
      : r.chunk_status === "sent"
        ? "sent"
        : r.chunk_status === "failed"
          ? "failed"
          : "pending",
    resend_email_id: r.resend_email_id,
  }));

  return {
    revision_id: revisionId,
    recipient_count: revision.recipientCount,
    total,
    offset: query.offset,
    limit: query.limit,
    items,
    top_domains: domains.map((d) => ({ domain: d.domain, count: d.count })),
  };
}

/** Tells an agent what it can do next, so it never has to guess. */
export function agentNextActions(v: DraftView): NextAction[] {
  const path = `/api/agent/drafts/${v.id}`;
  const revise: NextAction = {
    action: "revise",
    description:
      "Change any of recipients, subject, html (omitted fields are kept; recipients replaces the whole list). Creates a new revision that needs a new approval.",
    method: "PUT",
    path,
  };
  const poll = (description: string): NextAction => ({
    action: "poll",
    description,
    method: "GET",
    path,
  });

  const recipients: NextAction = {
    action: "list_recipients",
    description: `Page through all ${v.revision.recipient_count} recipients (and their send status once approved).`,
    method: "GET",
    path: `${path}/recipients?offset=0&limit=500`,
  };
  const s = v.send;

  switch (v.status) {
    case "draft":
      return [
        {
          action: "submit",
          description: `Submit revision ${v.revision.number} for human approval.`,
          method: "POST",
          path: `${path}/submit`,
          body: { revision_id: v.revision.id },
        },
        revise,
        recipients,
      ];
    case "pending_approval":
      return [
        poll("Waiting for a human reviewer. Poll this endpoint; do not resubmit."),
        { ...revise, description: `${revise.description} Revising withdraws the pending approval request.` },
      ];
    case "approved":
      return [
        poll(
          `Approved by a human; sending in progress (${s?.recipients_sent ?? 0} of ${v.revision.recipient_count} accepted by Resend so far). Poll every 5 to 10 seconds until the status is sent or failed. The draft can't be revised now.`,
        ),
        recipients,
      ];
    case "rejected":
      return [
        {
          ...revise,
          description: `A human rejected this revision${v.review?.reason ? `: "${v.review.reason}"` : ""}. Revise the draft to address that, then submit it again.`,
        },
      ];
    case "sent":
      return [
        {
          action: "none",
          description: `Resend accepted all ${v.revision.recipient_count} emails. "sent" means accepted by Resend, not delivered. Nothing more to do.`,
        },
        recipients,
      ];
    case "failed":
      return [
        poll(
          s?.partial
            ? `Partially sent: ${s.recipients_sent} of ${s.recipients_total} accepted, ${s.recipients_failed} failed (see send.errors). A human can resume sending the failed chunks; agents cannot. Tell the user.`
            : "The send failed (see send.errors). A human can resume it; agents cannot. Tell the user.",
        ),
        {
          ...recipients,
          description: "List the recipients that were not sent.",
          path: `${path}/recipients?status=failed&offset=0&limit=500`,
        },
        {
          ...revise,
          description: `${revise.description}${s?.partial ? " Warning: the new revision is sent to its whole list, so recipients who were already sent get a second email. Prefer asking a human to resume." : ""}`,
        },
      ];
  }
}

export async function listDrafts(
  opts: { status?: DraftStatus; limit?: number } = {},
) {
  const rows = await getDb()
    .select({
      id: drafts.id,
      status: drafts.status,
      revisionNumber: revisions.number,
      subject: revisions.subject,
      recipientCount: revisions.recipientCount,
      updatedAt: drafts.updatedAt,
    })
    .from(drafts)
    .innerJoin(revisions, eq(drafts.currentRevisionId, revisions.id))
    .where(opts.status ? eq(drafts.status, opts.status) : undefined)
    .orderBy(desc(drafts.updatedAt))
    .limit(Math.min(opts.limit ?? 50, 100));

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    revision_number: r.revisionNumber,
    subject: r.subject,
    recipient_count: r.recipientCount,
    updated_at: r.updatedAt.toISOString(),
  }));
}

/* ------------------------------------------------------------------ */
/* Agent operations                                                    */
/* ------------------------------------------------------------------ */

export async function createDraft(input: CreateDraftInput): Promise<DraftView> {
  const { recipients, duplicatesRemoved } = checkRecipients(input.recipients, env().MAX_RECIPIENTS);
  const content = { recipients, subject: input.subject.trim(), html: input.html };
  const draftId = newId("drf");
  const revisionId = newId("rev");

  await getDb().transaction(async (tx) => {
    // drafts.current_revision_id has no FK (circular), so the draft goes first.
    await tx.insert(drafts).values({
      id: draftId,
      currentRevisionId: revisionId,
      revisionCount: 1,
    });
    await tx.insert(revisions).values({
      id: revisionId,
      draftId,
      number: 1,
      ...content,
      recipientCount: recipients.length,
      duplicatesRemoved,
      contentHash: computeContentHash(content),
    });
  });

  return getDraftView(draftId);
}

/**
 * Never edits a revision: writes a new one and returns the draft to "draft".
 * The row lock serialises this against approve, which updates the same row.
 */
export async function reviseDraft(
  id: string,
  patch: ReviseDraftInput,
): Promise<DraftView> {
  await getDb().transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(drafts)
      .where(eq(drafts.id, id))
      .for("update");
    if (!draft) throw notFound("Draft", id);

    if (draft.status === "approved" || draft.status === "sent") {
      throw conflict(
        "draft_locked",
        draft.status === "sent"
          ? "This draft was already sent and cannot be revised."
          : "This draft was approved and is being sent; it can no longer be revised.",
        draft.status === "sent"
          ? "Create a new draft instead."
          : "Poll the draft for its send status.",
      );
    }

    const [current] = await tx
      .select()
      .from(revisions)
      .where(eq(revisions.id, draft.currentRevisionId));

    // A provided list replaces the whole list; the stored one is already canonical.
    const list = patch.recipients
      ? checkRecipients(patch.recipients, env().MAX_RECIPIENTS)
      : { recipients: current.recipients, duplicatesRemoved: current.duplicatesRemoved };
    const merged = {
      recipients: list.recipients,
      subject: patch.subject ?? current.subject,
      html: patch.html ?? current.html,
    };
    const contentHash = computeContentHash(merged);

    if (contentHash === current.contentHash) {
      // Nothing changed: don't mint a revision (and don't withdraw a pending approval).
      if (draft.status === "draft" || draft.status === "pending_approval") return;
      throw conflict(
        "no_changes",
        `The content is identical to revision ${current.number}, which is '${draft.status}'.`,
        draft.status === "rejected"
          ? "Change the content to address the reviewer's reason."
          : "Ask a human to resume the send.",
      );
    }

    const number = draft.revisionCount + 1;
    const revisionId = newId("rev");
    await tx.insert(revisions).values({
      id: revisionId,
      draftId: id,
      number,
      ...merged,
      recipientCount: merged.recipients.length,
      duplicatesRemoved: list.duplicatesRemoved,
      contentHash,
    });
    await tx
      .update(drafts)
      .set({
        currentRevisionId: revisionId,
        revisionCount: number,
        status: "draft",
        updatedAt: sql`now()`,
      })
      .where(eq(drafts.id, id));
  });

  return getDraftView(id);
}

export async function submitDraft(
  id: string,
  revisionId: string,
): Promise<DraftView> {
  const db = getDb();
  const updated = await db
    .update(drafts)
    .set({ status: "pending_approval", updatedAt: sql`now()` })
    .where(
      and(
        eq(drafts.id, id),
        eq(drafts.currentRevisionId, revisionId),
        eq(drafts.status, "draft"),
      ),
    )
    .returning({ id: drafts.id });

  if (updated.length === 0) {
    const [draft] = await db.select().from(drafts).where(eq(drafts.id, id));
    if (!draft) throw notFound("Draft", id);
    if (draft.currentRevisionId !== revisionId) {
      throw conflict(
        "revision_changed",
        `revision_id '${revisionId}' is not the current revision ('${draft.currentRevisionId}').`,
        "GET the draft and submit its current revision_id.",
      );
    }
    // Submitting twice is harmless.
    if (draft.status !== "pending_approval") {
      throw conflict(
        "invalid_state",
        `Draft is '${draft.status}' and cannot be submitted.`,
        draft.status === "rejected"
          ? "Revise the draft first, then submit the new revision."
          : "Poll the draft for its status.",
      );
    }
  }

  return getDraftView(id);
}
