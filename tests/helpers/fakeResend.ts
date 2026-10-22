import type { EmailContent } from "@/lib/hash";
import type { SendResult } from "@/lib/resend";

export type Behaviour =
  /** Resend accepts the email. */
  | "ok"
  /** Resend answers 4xx: no email exists, the outcome is certain. */
  | "reject"
  /** The request never reached Resend (network/timeout): outcome unknown. */
  | "timeout"
  /** Resend created the email but the response was lost: outcome unknown, email EXISTS. */
  | "lose_response"
  /** The process dies before reaching Resend. */
  | "crash"
  /** The process dies after Resend created the email. */
  | "crash_after_create";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Stands in for sendEmail(). It models the one Resend behaviour the design
 * relies on: a repeated Idempotency-Key returns the original response and does
 * NOT create a second email. `created` is therefore the ground truth for
 * "how many emails would really have been delivered".
 */
class FakeResend {
  /** Long enough that concurrent requests genuinely overlap with an in-flight send. */
  delayMs = 50;
  calls: { key: string; content: EmailContent }[] = [];
  created = new Map<string, { id: string; content: EmailContent }>();
  private script: Behaviour[] = [];
  private counter = 0;

  reset() {
    this.calls = [];
    this.created.clear();
    this.script = [];
    this.counter = 0;
  }

  /** Behaviour of the next calls, in order. Unscripted calls succeed. */
  queue(...behaviours: Behaviour[]) {
    this.script.push(...behaviours);
  }

  get distinctEmails() {
    return this.created.size;
  }

  private create(key: string, content: EmailContent) {
    const entry = { id: `email_${++this.counter}`, content };
    this.created.set(key, entry);
    return entry;
  }

  send = async (content: EmailContent, key: string): Promise<SendResult> => {
    this.calls.push({ key, content });
    await sleep(this.delayMs);
    const behaviour = this.script.shift() ?? "ok";

    const existing = this.created.get(key);
    if (existing) return { ok: true, id: existing.id };

    switch (behaviour) {
      case "reject":
        return { ok: false, definite: true, message: "Resend 403 validation_error: test rejection" };
      case "timeout":
        return { ok: false, definite: false, message: "Could not confirm the result with Resend (timed out)." };
      case "lose_response":
        this.create(key, content);
        return { ok: false, definite: false, message: "Could not confirm the result with Resend (timed out)." };
      case "crash":
        throw new Error("process died");
      case "crash_after_create":
        this.create(key, content);
        throw new Error("process died");
      case "ok":
        return { ok: true, id: this.create(key, content).id };
    }
  };
}

export const fakeResend = new FakeResend();
