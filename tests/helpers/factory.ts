import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { expect } from "vitest";
import { getDb } from "@/db";
import { drafts, revisions, reviews, sendChunks, sends } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { createDraft, submitDraft, type DraftView } from "@/services/drafts";
import { processSends } from "@/services/review";
import { fakeResend } from "./fakeResend";

const createdDraftIds: string[] = [];

/** n distinct addresses, unique to this call so tests never share recipients. */
export function addresses(n: number, tag = randomUUID().slice(0, 8)): string[] {
  return Array.from({ length: n }, (_, i) => `r${String(i).padStart(5, "0")}-${tag}@example.com`);
}

/** A draft in status "draft". Tracked so cleanupAll() can remove it. */
export async function newDraft(
  opts: { recipients?: string[]; count?: number; html?: string } = {},
): Promise<DraftView> {
  const view = await createDraft({
    recipients: opts.recipients ?? addresses(opts.count ?? 1),
    subject: `[vitest] ${randomUUID()}`,
    html: opts.html ?? "<p>Hello from a test</p>",
  });
  createdDraftIds.push(view.id);
  return view;
}

/** A draft submitted and waiting for approval. */
export async function pendingDraft(opts: Parameters<typeof newDraft>[0] = {}): Promise<DraftView> {
  const draft = await newDraft(opts);
  return submitDraft(draft.id, draft.revision.id);
}

/** What a reviewer would send after looking at this draft. */
export const approveInput = (v: DraftView) => ({
  revisionId: v.revision.id,
  contentHash: v.revision.content_hash,
  recipientCount: v.revision.recipient_count,
});

/** Runs the worker without the production throttle so tests stay fast. */
export const runWorker = (draftId: string, opts: Parameters<typeof processSends>[1] = {}) =>
  processSends(draftId, { maxRequestsPerSecond: 1000, ...opts });

export async function rowsFor(revisionId: string) {
  const db = getDb();
  return {
    reviews: await db.select().from(reviews).where(eq(reviews.revisionId, revisionId)),
    sends: await db.select().from(sends).where(eq(sends.revisionId, revisionId)),
    chunks: await db
      .select()
      .from(sendChunks)
      .where(eq(sendChunks.revisionId, revisionId))
      .orderBy(sendChunks.chunkIndex),
  };
}

export async function storedRecipients(revisionId: string): Promise<string[]> {
  const [r] = await getDb()
    .select({ recipients: revisions.recipients })
    .from(revisions)
    .where(eq(revisions.id, revisionId));
  return r.recipients;
}

/** Every stored recipient received exactly one email, and nobody else received any. */
export async function expectEachRecipientEmailedOnce(revisionId: string) {
  const recipients = await storedRecipients(revisionId);
  const counts = fakeResend.emailsPerRecipient;
  const wrong = recipients.filter((r) => counts.get(r) !== 1);
  expect(wrong.slice(0, 5), `${wrong.length} recipients not emailed exactly once`).toEqual([]);
  expect(counts.size).toBe(recipients.length);
}

/** Ages chunk timestamps to simulate time passing. */
export async function ageChunks(
  revisionId: string,
  chunkIndexes: number[],
  set: { updatedAt?: Date; keyFirstUsedAt?: Date },
) {
  const db = getDb();
  const rows = await db
    .select({ id: sendChunks.id, chunkIndex: sendChunks.chunkIndex })
    .from(sendChunks)
    .where(eq(sendChunks.revisionId, revisionId));
  const ids = rows.filter((r) => chunkIndexes.includes(r.chunkIndex)).map((r) => r.id);
  await db.update(sendChunks).set(set).where(inArray(sendChunks.id, ids));
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
  return err as AppError;
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
    await db.delete(sendChunks).where(inArray(sendChunks.revisionId, revIds));
    await db.delete(sends).where(inArray(sends.revisionId, revIds));
    await db.delete(reviews).where(inArray(reviews.revisionId, revIds));
  }
  await db.delete(revisions).where(inArray(revisions.draftId, ids));
  await db.delete(drafts).where(inArray(drafts.id, ids));
}
