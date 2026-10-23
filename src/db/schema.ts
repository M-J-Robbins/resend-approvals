import { randomUUID } from "node:crypto";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const newId = (prefix: string) =>
  `${prefix}_${randomUUID().replace(/-/g, "")}`;

/**
 * draft       agent is still working on it (or revised it)
 * pending_approval  submitted; waiting for a human
 * approved    human approved; the send job is in progress
 * rejected    human rejected; agent must revise to continue
 * sent        Resend accepted every chunk (accepted, not necessarily delivered)
 * failed      the send job finished with at least one failed chunk (possibly
 *             partial); a human can resume it
 */
export const draftStatus = pgEnum("draft_status", [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "sent",
  "failed",
]);
export const reviewDecision = pgEnum("review_decision", [
  "approved",
  "rejected",
]);
export const sendStatus = pgEnum("send_status", ["sending", "sent", "failed"]);
export const chunkStatus = pgEnum("chunk_status", [
  "pending",
  "sending",
  "sent",
  "failed",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const drafts = pgTable(
  "drafts",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("drf")),
    status: draftStatus("status").notNull().default("draft"),
    // No FK: drafts and revisions reference each other. Revisions have the FK.
    currentRevisionId: text("current_revision_id").notNull(),
    // Incremented atomically on revise; becomes the new revision's number.
    revisionCount: integer("revision_count").notNull().default(1),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("drafts_status_idx").on(t.status)],
);

/** Immutable. Never UPDATE a row in this table. */
export const revisions = pgTable(
  "revisions",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("rev")),
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id),
    number: integer("number").notNull(),
    // Canonical form: trimmed, lowercased, de-duplicated, sorted ascending.
    // Send chunks address slices of this array by index, so it must never change.
    recipients: text("recipients").array().notNull(),
    recipientCount: integer("recipient_count").notNull(),
    // How many duplicates the agent's list had. Informational, not hashed.
    duplicatesRemoved: integer("duplicates_removed").notNull().default(0),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    contentHash: text("content_hash").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("revisions_draft_number_uq").on(t.draftId, t.number)],
);

/** One decision per revision, enforced by the unique index. */
export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("rvw")),
    revisionId: text("revision_id")
      .notNull()
      .references(() => revisions.id),
    decision: reviewDecision("decision").notNull(),
    reason: text("reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("reviews_revision_uq").on(t.revisionId)],
);

/**
 * The send job: one per revision, enforced by the unique index. This is the
 * double-send guard. Its status is the aggregate of its chunks.
 */
export const sends = pgTable(
  "sends",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("snd")),
    revisionId: text("revision_id")
      .notNull()
      .references(() => revisions.id),
    status: sendStatus("status").notNull().default("sending"),
    // Fixed when the job is created, so chunk boundaries never move on retry
    // even if the chunking rule changes in a later deploy.
    chunkSize: integer("chunk_size").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("sends_revision_uq").on(t.revisionId)],
);

/**
 * One Resend batch request. Chunk N covers
 * revisions.recipients[N * chunk_size, (N + 1) * chunk_size); the addresses
 * are not copied here.
 */
export const sendChunks = pgTable(
  "send_chunks",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("chk")),
    revisionId: text("revision_id")
      .notNull()
      .references(() => revisions.id),
    chunkIndex: integer("chunk_index").notNull(),
    status: chunkStatus("status").notNull().default("pending"),
    // Sent to Resend as the Idempotency-Key: <revisionId>:c<chunkIndex>:g<keyGeneration>.
    // Only rotated (generation + 1) after Resend definitively rejects a request.
    idempotencyKey: text("idempotency_key").notNull(),
    keyGeneration: integer("key_generation").notNull().default(1),
    // When the current key was first sent to Resend (null while unused, and
    // reset on rotation). Resend remembers keys for 24h, so retrying an
    // uncertain chunk with the same key is only safe inside that window.
    keyFirstUsedAt: timestamp("key_first_used_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    // Aligned by index with the chunk's recipients.
    resendEmailIds: text("resend_email_ids").array(),
    error: text("error"),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("send_chunks_revision_chunk_uq").on(t.revisionId, t.chunkIndex),
  ],
);

export type DraftStatus = (typeof draftStatus.enumValues)[number];
export type DraftRow = typeof drafts.$inferSelect;
export type RevisionRow = typeof revisions.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;
export type SendRow = typeof sends.$inferSelect;
export type SendChunkRow = typeof sendChunks.$inferSelect;
