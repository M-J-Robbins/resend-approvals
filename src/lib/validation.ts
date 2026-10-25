import { z } from "zod";
import { draftStatus } from "@/db/schema";
import { AppError, validationError } from "./errors";
import { canonicalRecipients } from "./hash";

/** Invalid addresses listed in an invalid_recipients error. */
const MAX_REPORTED_INVALID = 20;

const address = z.email().max(254);

// Element types only. Address checks, the cap and de-duplication happen in
// checkRecipients(), so one bad address out of 5,000 gets a precise answer.
const recipients = z.array(z.string());

const subject = z
  .string()
  .trim()
  .min(1, "Subject is required.")
  .max(998)
  .refine((s) => !/[\r\n]/.test(s), "Subject must be a single line.");

const html = z.string().min(1, "html is required.").max(1_000_000);

// .strict() so an agent that sends e.g. "from" gets told it's not allowed
// instead of having the field silently ignored.
const createDraftBody = z
  .object({ recipients, subject, html })
  .strict();

/** Omitted fields keep their current value; `recipients` replaces the whole list. */
const reviseDraftBody = z
  .object({
    recipients: recipients.optional(),
    subject: subject.optional(),
    html: html.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide at least one field to change.",
  });

const LEGACY_FIELDS = ["to", "cc", "bcc"] as const;

/** The old shape gets a specific answer instead of a generic "unrecognized key". */
function rejectLegacyFields(raw: unknown) {
  if (typeof raw !== "object" || raw === null) return;
  const used = LEGACY_FIELDS.filter((k) => k in raw);
  if (used.length === 0) return;
  throw new AppError(
    400,
    "validation_error",
    `The field${used.length > 1 ? "s" : ""} ${used.map((k) => `'${k}'`).join(", ")} ${used.length > 1 ? "are" : "is"} not supported.`,
    "cc/bcc/to are not supported: send `recipients`; each recipient receives an individual email.",
  );
}

/** Parses with a hint that describes a valid body, so an agent can fix its request without the docs. */
function parseWithHint<T extends z.ZodType>(schema: T, raw: unknown, hint: string): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) throw validationError(result.error, hint);
  return result.data;
}

export function parseCreateDraft(raw: unknown) {
  rejectLegacyFields(raw);
  return parseWithHint(
    createDraftBody,
    raw,
    "Send a JSON object with exactly these fields: `recipients` (an array of email addresses), `subject` (one line) and `html` (the email's HTML). Other fields, such as `body`, `text` or `from`, are not accepted.",
  );
}

export function parseReviseDraft(raw: unknown) {
  rejectLegacyFields(raw);
  return parseWithHint(
    reviseDraftBody,
    raw,
    "Send one or more of `recipients`, `subject` and `html`. Omitted fields are kept; `recipients` and `html` replace the current value in full, so to add a recipient send the current list plus the new address (the draft's `revision.recipients_preview` has up to 10; page the rest from its /recipients endpoint). Other fields, such as `body`, `text`, `from` or `add_recipients`, are not accepted.",
  );
}

export function parseSubmit(raw: unknown) {
  return parseWithHint(
    submitBody,
    raw,
    'Send {"revision_id": "<the draft\'s current revision.id>"}. The `submit` entry in the draft\'s `next_actions` has the exact body.',
  );
}

/**
 * Validates every address and returns the canonical list. Never drops an
 * address silently: one invalid address fails the whole request.
 */
export function checkRecipients(
  list: string[],
  max: number,
): { recipients: string[]; duplicatesRemoved: number } {
  if (list.length === 0) {
    throw new AppError(
      400,
      "no_recipients",
      "The recipients list is empty.",
      "Send at least one email address in `recipients`.",
    );
  }

  const canonical = canonicalRecipients(list);
  if (canonical.recipients.length > max) {
    throw new AppError(
      400,
      "too_many_recipients",
      `${canonical.recipients.length} unique recipients is more than the limit of ${max} per draft.`,
      `Split the list into several drafts of at most ${max} recipients each.`,
      { max_recipients: max, recipient_count: canonical.recipients.length },
    );
  }

  const invalid: { index: number; value: string }[] = [];
  let invalidCount = 0;
  list.forEach((value, index) => {
    if (address.safeParse(value.trim()).success) return;
    invalidCount++;
    if (invalid.length < MAX_REPORTED_INVALID) {
      invalid.push({ index, value: value.length > 320 ? `${value.slice(0, 320)}…` : value });
    }
  });
  if (invalidCount > 0) {
    throw new AppError(
      400,
      "invalid_recipients",
      `${invalidCount} recipient${invalidCount === 1 ? " is" : "s are"} not a valid email address.`,
      "Fix or remove the listed addresses (index is the position in the array you sent) and send the request again. Use plain addresses like delivered@resend.dev, not 'Name <delivered@resend.dev>'.",
      { invalid_count: invalidCount, invalid },
    );
  }

  return canonical;
}

const submitBody = z
  .object({ revision_id: z.string("revision_id is required.").min(1) })
  .strict();

export const approveBody = z
  .object({
    revision_id: z.string().min(1),
    content_hash: z.string().regex(/^[a-f0-9]{64}$/, "Expected a SHA-256 hex digest."),
    recipient_count: z.number().int().min(1),
  })
  .strict();

export const rejectBody = z
  .object({
    revision_id: z.string().min(1),
    reason: z.string().trim().min(1, "A reason is required.").max(1000),
  })
  .strict();

export const statusFilter = z.enum(draftStatus.enumValues);

export const recipientsQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  q: z.string().trim().max(254).optional(),
  status: z.enum(["pending", "sent", "failed"]).optional(),
  revision_id: z.string().min(1).optional(),
});

export type CreateDraftInput = ReturnType<typeof parseCreateDraft>;
export type ReviseDraftInput = ReturnType<typeof parseReviseDraft>;
export type RecipientsQuery = z.infer<typeof recipientsQuery>;
