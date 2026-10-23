/**
 * How a revision's recipients are split into Resend batch requests.
 *
 * Everything here is a pure function of the revision (recipients, subject,
 * html), never of config or time: chunk boundaries must be identical on every
 * retry, because each chunk's idempotency key names a fixed set of addresses.
 * approveDraft also stores the size on the job, so a later change to these
 * constants can't move the boundaries of a job that already exists.
 */

/** Resend's batch endpoint takes at most 100 emails per request. */
export const MAX_CHUNK_SIZE = 100;

/**
 * Request body budget per batch. Resend documents a 40 MB limit per email but
 * no limit for the batch body; a probe on 2026-10-23 had bodies of 6, 12, 25
 * and 45 MB all parsed (answered with the expected 422 for a planted invalid
 * address, never 413). 10 MB stays far below every observed limit.
 */
export const PAYLOAD_BUDGET_BYTES = 10_000_000;

/** Room per email for from, to, the JSON keys and punctuation. */
const PER_EMAIL_OVERHEAD_BYTES = 1024;

export function chunkSizeFor(content: { subject: string; html: string }): number {
  const perEmail =
    Buffer.byteLength(JSON.stringify(content.html)) +
    Buffer.byteLength(JSON.stringify(content.subject)) +
    PER_EMAIL_OVERHEAD_BYTES;
  return Math.max(1, Math.min(MAX_CHUNK_SIZE, Math.floor(PAYLOAD_BUDGET_BYTES / perEmail)));
}

export const chunkCountFor = (recipientCount: number, chunkSize: number) =>
  Math.ceil(recipientCount / chunkSize);

/** Chunk N covers recipients[start, end) of the stored, sorted list. */
export function chunkRange(chunkIndex: number, chunkSize: number, recipientCount: number) {
  const start = chunkIndex * chunkSize;
  return { start, end: Math.min(start + chunkSize, recipientCount) };
}

export const chunkIdempotencyKey = (revisionId: string, chunkIndex: number, generation: number) =>
  `${revisionId}:c${chunkIndex}:g${generation}`;
