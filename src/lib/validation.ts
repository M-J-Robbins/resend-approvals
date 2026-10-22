import { z } from "zod";
import { draftStatus } from "@/db/schema";

const MAX_RECIPIENTS = 50; // Resend's per-email limit

const address = z.string().trim().email().max(254);
const recipients = z.array(address).max(MAX_RECIPIENTS);

const subject = z
  .string()
  .trim()
  .min(1, "Subject is required.")
  .max(998)
  .refine((s) => !/[\r\n]/.test(s), "Subject must be a single line.");

const html = z.string().min(1, "html is required.").max(1_000_000);

const withinRecipientLimit = (v: {
  to?: string[];
  cc?: string[];
  bcc?: string[];
}) =>
  (v.to?.length ?? 0) + (v.cc?.length ?? 0) + (v.bcc?.length ?? 0) <=
  MAX_RECIPIENTS;

const limitMessage = {
  message: `At most ${MAX_RECIPIENTS} recipients across to, cc and bcc.`,
};

// .strict() so an agent that sends e.g. "from" gets told it's not allowed
// instead of having the field silently ignored.
export const createDraftBody = z
  .object({
    to: recipients.min(1, "At least one 'to' recipient is required."),
    cc: recipients.default([]),
    bcc: recipients.default([]),
    subject,
    html,
  })
  .strict()
  .refine(withinRecipientLimit, limitMessage);

/** Omitted fields keep their current value. */
export const reviseDraftBody = z
  .object({
    to: recipients.min(1).optional(),
    cc: recipients.optional(),
    bcc: recipients.optional(),
    subject: subject.optional(),
    html: html.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide at least one field to change.",
  });

export const submitBody = z
  .object({ revision_id: z.string().min(1) })
  .strict();

export const approveBody = z
  .object({
    revision_id: z.string().min(1),
    content_hash: z.string().regex(/^[a-f0-9]{64}$/, "Expected a SHA-256 hex digest."),
  })
  .strict();

export const rejectBody = z
  .object({
    revision_id: z.string().min(1),
    reason: z.string().trim().min(1, "A reason is required.").max(1000),
  })
  .strict();

export const statusFilter = z.enum(draftStatus.enumValues);

export type CreateDraftInput = z.infer<typeof createDraftBody>;
export type ReviseDraftInput = z.infer<typeof reviseDraftBody>;
