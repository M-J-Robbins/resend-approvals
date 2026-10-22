import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  drafts,
  newId,
  revisions,
  reviews,
  sends,
  type DraftStatus,
} from "@/db/schema";
import { conflict, notFound } from "@/lib/errors";
import { computeContentHash, normalizeContent } from "@/lib/hash";
import {
  createDraftBody,
  type CreateDraftInput,
  type ReviseDraftInput,
} from "@/lib/validation";

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
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    html: string;
    content_hash: string;
    created_at: string;
  };
  /** Decision on the current revision, or null if nobody has decided yet. */
  review: { decision: "approved" | "rejected"; reason: string | null; decided_at: string } | null;
  /** Send state for the current revision, or null if it was never approved. */
  send: {
    status: "sending" | "sent" | "failed";
    resend_email_id: string | null;
    error: string | null;
    attempts: number;
    updated_at: string;
  } | null;
  revisions: { id: string; number: number; content_hash: string; created_at: string }[];
  created_at: string;
  updated_at: string;
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
      to: revision.to,
      cc: revision.cc,
      bcc: revision.bcc,
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
    send: send
      ? {
          status: send.status,
          resend_email_id: send.resendEmailId,
          error: send.error,
          attempts: send.attempts,
          updated_at: send.updatedAt.toISOString(),
        }
      : null,
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

/** Tells an agent what it can do next, so it never has to guess. */
export function agentNextActions(v: DraftView): NextAction[] {
  const path = `/api/agent/drafts/${v.id}`;
  const revise: NextAction = {
    action: "revise",
    description:
      "Change any of to, cc, bcc, subject, html (omitted fields are kept). Creates a new revision that needs a new approval.",
    method: "PUT",
    path,
  };
  const poll = (description: string): NextAction => ({
    action: "poll",
    description,
    method: "GET",
    path,
  });

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
      ];
    case "pending_approval":
      return [
        poll("Waiting for a human reviewer. Poll this endpoint; do not resubmit."),
        { ...revise, description: `${revise.description} Revising withdraws the pending approval request.` },
      ];
    case "approved":
      return [poll("Approved by a human; the email is being sent. Poll for the final send status.")];
    case "rejected":
      return [
        {
          ...revise,
          description: `A human rejected this revision${v.review?.reason ? `: "${v.review.reason}"` : ""}. Revise the draft to address that, then submit it again.`,
        },
      ];
    case "sent":
      return [{ action: "none", description: "The email was sent. Nothing more to do." }];
    case "failed":
      return [
        poll("The send failed (see send.error). A human can retry it; agents cannot."),
        revise,
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
      to: revisions.to,
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
    to: r.to,
    updated_at: r.updatedAt.toISOString(),
  }));
}

/* ------------------------------------------------------------------ */
/* Agent operations                                                    */
/* ------------------------------------------------------------------ */

export async function createDraft(input: CreateDraftInput): Promise<DraftView> {
  const content = normalizeContent(input);
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

    // Re-validate the merged result (recipient limit, required fields).
    const merged = normalizeContent(
      createDraftBody.parse({
        to: patch.to ?? current.to,
        cc: patch.cc ?? current.cc,
        bcc: patch.bcc ?? current.bcc,
        subject: patch.subject ?? current.subject,
        html: patch.html ?? current.html,
      }),
    );
    const contentHash = computeContentHash(merged);

    if (contentHash === current.contentHash) {
      // Nothing changed: don't mint a revision (and don't withdraw a pending approval).
      if (draft.status === "draft" || draft.status === "pending_approval") return;
      throw conflict(
        "no_changes",
        `The content is identical to revision ${current.number}, which is '${draft.status}'.`,
        draft.status === "rejected"
          ? "Change the content to address the reviewer's reason."
          : "Ask a human to retry the send.",
      );
    }

    const number = draft.revisionCount + 1;
    const revisionId = newId("rev");
    await tx.insert(revisions).values({
      id: revisionId,
      draftId: id,
      number,
      ...merged,
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
