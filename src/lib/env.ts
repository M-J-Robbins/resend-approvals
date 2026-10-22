import { z } from "zod";

const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    RESEND_API_KEY: z.string().min(1),
    EMAIL_FROM: z.string().min(1).default("Agent Drafts <onboarding@resend.dev>"),
    AGENT_API_KEY: z.string().min(32),
    REVIEWER_TOKEN: z.string().min(32),
  })
  .refine((v) => v.AGENT_API_KEY !== v.REVIEWER_TOKEN, {
    message: "AGENT_API_KEY and REVIEWER_TOKEN must be different secrets",
    path: ["REVIEWER_TOKEN"],
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parsed lazily and cached. Throws a readable error if config is missing. */
export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}
