import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { expect } from "vitest";
import { getDb } from "@/db";
import { drafts, revisions, reviews, sends } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { createDraft, submitDraft, type DraftView } from "@/services/drafts";

const createdDraftIds: string[] = [];

/** A draft in status "draft". Tracked so cleanupAll() can remove it. */
export async function newDraft(): Promise<DraftView> {
  const view = await createDraft({
    to: ["recipient@example.com"],
    cc: [],
    bcc: [],
    subject: `[vitest] ${randomUUID()}`,
    html: "<p>Hello from a test</p>",
  });
  createdDraftIds.push(view.id);
  return view;
}

/** A draft submitted and waiting for approval. */
export async function pendingDraft(): Promise<DraftView> {
  const draft = await newDraft();
  return submitDraft(draft.id, draft.revision.id);
}

/** What a reviewer would send after looking at this draft. */
export const approveInput = (v: DraftView) => ({
  revisionId: v.revision.id,
  contentHash: v.revision.content_hash,
});

export async function rowsFor(revisionId: string) {
  const db = getDb();
  return {
    reviews: await db.select().from(reviews).where(eq(reviews.revisionId, revisionId)),
    sends: await db.select().from(sends).where(eq(sends.revisionId, revisionId)),
  };
}

export async function expectAppError(
  promise: Promise<unknown>,
  status: number,
  code: string,
) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `expected AppError ${code} but the call succeeded`).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(status);
  expect((err as AppError).code).toBe(code);
}

/** Deletes only the rows this test run created. Never truncates. */
export async function cleanupAll() {
  if (createdDraftIds.length === 0) return;
  const db = getDb();
  const ids = [...createdDraftIds];
  createdDraftIds.length = 0;

  const revs = await db
    .select({ id: revisions.id })
    .from(revisions)
    .where(inArray(revisions.draftId, ids));
  const revIds = revs.map((r) => r.id);
  if (revIds.length > 0) {
    await db.delete(sends).where(inArray(sends.revisionId, revIds));
    await db.delete(reviews).where(inArray(reviews.revisionId, revIds));
  }
  await db.delete(revisions).where(inArray(revisions.draftId, ids));
  await db.delete(drafts).where(inArray(drafts.id, ids));
}
