import { createHash } from "node:crypto";

export interface EmailContent {
  /** Each address receives its own individual copy. */
  recipients: string[];
  subject: string;
  html: string;
}

/**
 * The canonical recipient list: trimmed, lowercased, de-duplicated and sorted
 * ascending. The same set in any order or case gives the same list, so it
 * gives the same hash, and chunk N always covers the same addresses.
 */
export function canonicalRecipients(list: string[]): {
  recipients: string[];
  duplicatesRemoved: number;
} {
  const unique = [...new Set(list.map((a) => a.trim().toLowerCase()))];
  // Plain code-unit order: no locale, so it is identical on every machine.
  unique.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { recipients: unique, duplicatesRemoved: list.length - unique.length };
}

export function normalizeContent(c: EmailContent): EmailContent {
  return {
    recipients: canonicalRecipients(c.recipients).recipients,
    subject: c.subject.trim(),
    html: c.html,
  };
}

/**
 * Hash of everything a human approves: the recipient SET, subject and html.
 * A JSON array with fixed positions is canonical: no key-order ambiguity, no
 * field can be confused for another. Recipients are canonicalised here too, so
 * the hash never depends on how the list was written.
 */
export function computeContentHash(c: EmailContent): string {
  return createHash("sha256")
    .update(
      JSON.stringify([canonicalRecipients(c.recipients).recipients, c.subject, c.html]),
    )
    .digest("hex");
}
