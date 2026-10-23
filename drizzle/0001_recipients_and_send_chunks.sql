-- Breaking change: to/cc/bcc become one canonical recipients list, and the
-- per-send idempotency state moves to send_chunks. Existing rows can't be
-- converted (content hashes would change), so refuse to run on a database that
-- still has drafts rather than deleting anything. Clear test data first.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "drafts") OR EXISTS (SELECT 1 FROM "revisions") OR EXISTS (SELECT 1 FROM "sends") THEN
		RAISE EXCEPTION 'Migration 0001 needs empty drafts/revisions/reviews/sends tables. Delete the test rows first.';
	END IF;
END $$;--> statement-breakpoint
CREATE TYPE "public"."chunk_status" AS ENUM('pending', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "send_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"revision_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"status" "chunk_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"key_generation" integer DEFAULT 1 NOT NULL,
	"key_first_used_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"resend_email_ids" text[],
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "recipients" text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "recipient_count" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "duplicates_removed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sends" ADD COLUMN "chunk_size" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "sends" ADD COLUMN "chunk_count" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "send_chunks" ADD CONSTRAINT "send_chunks_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "send_chunks_revision_chunk_uq" ON "send_chunks" USING btree ("revision_id","chunk_index");--> statement-breakpoint
ALTER TABLE "revisions" DROP COLUMN "to_recipients";--> statement-breakpoint
ALTER TABLE "revisions" DROP COLUMN "cc_recipients";--> statement-breakpoint
ALTER TABLE "revisions" DROP COLUMN "bcc_recipients";--> statement-breakpoint
ALTER TABLE "sends" DROP COLUMN "resend_email_id";--> statement-breakpoint
ALTER TABLE "sends" DROP COLUMN "error";--> statement-breakpoint
ALTER TABLE "sends" DROP COLUMN "attempts";--> statement-breakpoint
ALTER TABLE "sends" DROP COLUMN "idempotency_key";--> statement-breakpoint
ALTER TABLE "sends" DROP COLUMN "key_first_used_at";