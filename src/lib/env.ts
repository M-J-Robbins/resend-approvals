import { z } from "zod";

const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    RESEND_API_KEY: z.string().min(1),
    EMAIL_FROM: z.string().min(1).default("Agent Drafts <onboarding@resend.dev>"),
    AGENT_API_KEY: z.string().min(32),
    REVIEWER_TOKEN: z.string().min(32),
    // Recipients per draft. Each one is a separate email, so this also bounds a job's size.
    MAX_RECIPIENTS: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.coerce.number().int().positive().default(5000),
    ),
  })
  .refine((v) => v.AGENT_API_KEY !== v.REVIEWER_TOKEN, {
    message: "AGENT_API_KEY and REVIEWER_TOKEN must be different secrets",
    path: ["REVIEWER_TOKEN"],
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export interface Sender {
  /** The friendly name, e.g. "Agent Drafts", or null if EMAIL_FROM is a bare address. */
  name: string | null;
  address: string;
}

/** Splits EMAIL_FROM ("Name <address>" or a bare address) for display in the review UI. */
export function parseSender(from: string): Sender {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (!match) return { name: null, address: from.trim() };
  return { name: match[1].trim() || null, address: match[2].trim() };
}

/** Parsed lazily and cached. Throws a readable error if config is missing. */
export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}
