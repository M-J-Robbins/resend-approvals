import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
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
 * approved    human approved; send claimed and in flight
 * rejected    human rejected; agent must revise to continue
 * sent        Resend accepted it
 * failed      approved, but the send failed; a human can retry
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
    // "to" is a reserved word in Postgres, so the columns have a suffix.
    to: text("to_recipients").array().notNull(),
    cc: text("cc_recipients")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    bcc: text("bcc_recipients")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
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

/** One send per revision, enforced by the unique index. This is the double-send guard. */
export const sends = pgTable(
  "sends",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("snd")),
    revisionId: text("revision_id")
      .notNull()
      .references(() => revisions.id),
    status: sendStatus("status").notNull().default("sending"),
    resendEmailId: text("resend_email_id"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(1),
    // Sent to Resend as the Idempotency-Key. Starts as the revision id and is
    // only rotated after Resend definitively rejects a request (see review.ts).
    idempotencyKey: text("idempotency_key").notNull(),
    // When the current key was first sent to Resend (null while unused).
    // Resend remembers keys for 24h, so retrying an uncertain send with the
    // same key is only safe inside that window.
    keyFirstUsedAt: timestamp("key_first_used_at", { withTimezone: true }),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("sends_revision_uq").on(t.revisionId)],
);

export type DraftStatus = (typeof draftStatus.enumValues)[number];
export type DraftRow = typeof drafts.$inferSelect;
export type RevisionRow = typeof revisions.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;
export type SendRow = typeof sends.$inferSelect;
