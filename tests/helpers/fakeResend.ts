import type { Batch, BatchResult } from "@/lib/resend";

export type Behaviour =
  /** Resend accepts the whole batch. */
  | "ok"
  /** Resend answers 4xx: nothing was created, the outcome is certain. */
  | "reject"
  /** The request never reached Resend (network/timeout): outcome unknown. */
  | "timeout"
  /** Resend created the emails but the response was lost: outcome unknown, emails EXIST. */
  | "lose_response"
  /** 429 rate_limit_exceeded with retry-after: the request was not processed. */
  | "rate_limit"
  /** 429 daily_quota_exceeded: not processed, and later requests will fail too. */
  | "quota"
  /** The process dies before reaching Resend. */
  | "crash"
  /** The process dies after Resend created the emails. */
  | "crash_after_create";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Stands in for sendBatch(). It models the Resend behaviour the design relies
 * on: a repeated Idempotency-Key returns the original response and does NOT
 * create the emails again, and a second request with a key that is still in
 * flight gets a 409. `emailsPerRecipient` is therefore the ground truth for
 * "how many emails each recipient would really have received".
 */
class FakeResend {
  /** Long enough that concurrent workers genuinely overlap with an in-flight request. */
  delayMs = 50;
  retryAfterMs = 50;
  calls: { key: string; batch: Batch }[] = [];
  created = new Map<string, { ids: string[]; batch: Batch }>();
  emailsPerRecipient = new Map<string, number>();
  private script: Behaviour[] = [];
  private byKey: { match: string; behaviours: Behaviour[] }[] = [];
  private inFlight = new Set<string>();
  private counter = 0;

  reset() {
    this.delayMs = 50;
    this.retryAfterMs = 50;
    this.calls = [];
    this.created.clear();
    this.emailsPerRecipient.clear();
    this.script = [];
    this.byKey = [];
    this.inFlight.clear();
    this.counter = 0;
  }

  /** Behaviour of the next calls, in order. Unscripted calls succeed. */
  queue(...behaviours: Behaviour[]) {
    this.script.push(...behaviours);
  }

  /**
   * Behaviour of the next calls whose key contains `match` (e.g. ":c1:" for
   * chunk 1), in order. Takes precedence over queue().
   */
  queueFor(match: string, ...behaviours: Behaviour[]) {
    this.byKey.push({ match, behaviours });
  }

  /** Emails that really exist. */
  get distinctEmails() {
    let n = 0;
    for (const c of this.created.values()) n += c.ids.length;
    return n;
  }

  keysFor(match: string) {
    return this.calls.map((c) => c.key).filter((k) => k.includes(match));
  }

  private nextBehaviour(key: string): Behaviour {
    const scripted = this.byKey.find((s) => key.includes(s.match) && s.behaviours.length > 0);
    if (scripted) return scripted.behaviours.shift()!;
    return this.script.shift() ?? "ok";
  }

  private create(key: string, batch: Batch) {
    const ids = batch.recipients.map(() => `email_${++this.counter}`);
    this.created.set(key, { ids, batch });
    for (const r of batch.recipients) {
      this.emailsPerRecipient.set(r, (this.emailsPerRecipient.get(r) ?? 0) + 1);
    }
    return ids;
  }

  send = async (batch: Batch, key: string): Promise<BatchResult> => {
    this.calls.push({ key, batch });
    if (batch.recipients.length < 1 || batch.recipients.length > 100) {
      throw new Error(`fake Resend: batch of ${batch.recipients.length} emails`);
    }
    const behaviour = this.nextBehaviour(key);
    if (behaviour === "crash") throw new Error("process died");

    if (this.inFlight.has(key)) {
      await sleep(this.delayMs);
      return { ok: false, outcome: "uncertain", message: "Resend 409 concurrent_idempotent_requests" };
    }
    this.inFlight.add(key);
    try {
      await sleep(this.delayMs);

      const existing = this.created.get(key);
      if (existing) return { ok: true, ids: existing.ids };

      switch (behaviour) {
        case "reject":
          return { ok: false, outcome: "definite", message: "Resend 422 validation_error: test rejection" };
        case "timeout":
          return { ok: false, outcome: "uncertain", message: "Could not confirm the result with Resend (timed out)." };
        case "lose_response":
          this.create(key, batch);
          return { ok: false, outcome: "uncertain", message: "Could not confirm the result with Resend (timed out)." };
        case "rate_limit":
          return {
            ok: false,
            outcome: "rate_limited",
            message: "Resend 429 rate_limit_exceeded: Too many requests.",
            retryAfterMs: this.retryAfterMs,
          };
        case "quota":
          return {
            ok: false,
            outcome: "definite",
            message: "Resend 429 daily_quota_exceeded: You have reached your daily email quota.",
            quotaExceeded: true,
          };
        case "crash_after_create":
          this.create(key, batch);
          throw new Error("process died");
        case "ok":
          return { ok: true, ids: this.create(key, batch) };
      }
    } finally {
      this.inFlight.delete(key);
    }
  };
}

export const fakeResend = new FakeResend();
