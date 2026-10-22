import { createHash } from "node:crypto";

export interface EmailContent {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
}

const dedupe = (list: string[]) => {
  const seen = new Set<string>();
  return list
    .map((a) => a.trim())
    .filter((a) => {
      const k = a.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
};

/** Trim and de-duplicate recipients. Addresses are otherwise kept exactly as the agent wrote them. */
export function normalizeContent(c: EmailContent): EmailContent {
  return {
    to: dedupe(c.to),
    cc: dedupe(c.cc),
    bcc: dedupe(c.bcc),
    subject: c.subject.trim(),
    html: c.html,
  };
}

/**
 * Hash of everything a human approves. A JSON array with fixed positions is
 * canonical: no key-order ambiguity, no field can be confused for another.
 */
export function computeContentHash(c: EmailContent): string {
  return createHash("sha256")
    .update(JSON.stringify([c.to, c.cc, c.bcc, c.subject, c.html]))
    .digest("hex");
}
