CREATE TYPE "public"."draft_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."send_status" AS ENUM('sending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "draft_status" DEFAULT 'draft' NOT NULL,
	"current_revision_id" text NOT NULL,
	"revision_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"revision_id" text NOT NULL,
	"decision" "review_decision" NOT NULL,
	"reason" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"draft_id" text NOT NULL,
	"number" integer NOT NULL,
	"to_recipients" text[] NOT NULL,
	"cc_recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"bcc_recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sends" (
	"id" text PRIMARY KEY NOT NULL,
	"revision_id" text NOT NULL,
	"status" "send_status" DEFAULT 'sending' NOT NULL,
	"resend_email_id" text,
	"error" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text NOT NULL,
	"key_first_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sends" ADD CONSTRAINT "sends_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drafts_status_idx" ON "drafts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_revision_uq" ON "reviews" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_draft_number_uq" ON "revisions" USING btree ("draft_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "sends_revision_uq" ON "sends" USING btree ("revision_id");