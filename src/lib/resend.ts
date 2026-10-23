import { env } from "./env";

/** One chunk: every recipient gets an individual copy of the same email. */
export interface Batch {
  recipients: string[];
  subject: string;
  html: string;
}

export type BatchResult =
  /** ids[i] is the Resend email id for recipients[i]. */
  | { ok: true; ids: string[] }
  | {
      ok: false;
      /**
       * definite:     Resend answered with a 4xx rejection, so no email exists for this request.
       * uncertain:    outcome unknown (timeout, network error, 5xx, 409, malformed reply).
       * rate_limited: 429 rate_limit_exceeded; the request was not processed. Retry the
       *               same key after retryAfterMs.
       */
      outcome: "definite" | "uncertain" | "rate_limited";
      message: string;
      retryAfterMs?: number;
      /** A quota 429: every later request will be refused too, so stop sending. */
      quotaExceeded?: boolean;
    };

const TIMEOUT_MS = 20_000;

/**
 * POST /emails/batch: up to 100 emails, response `{ data: [{ id }] }` in input
 * order.
 *
 * Validation mode, verified 2026-10-23: the official Node SDK (resend 6.34.1)
 * sends `x-batch-validation: strict` by default; `permissive` instead queues
 * the valid emails and reports the rest in `errors`. We send `strict`
 * explicitly. A live probe confirmed that a strict batch with one malformed
 * address, one email missing html, or one example.com recipient under the
 * testing sender is rejected as a whole (422) and the daily quota did not
 * move, i.e. nothing was sent. So a chunk either fully succeeds or fully fails.
 */
export async function sendBatch(batch: Batch, idempotencyKey: string): Promise<BatchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const from = env().EMAIL_FROM;
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env().RESEND_API_KEY}`,
        "Content-Type": "application/json",
        // Resend answers 403 to requests without a User-Agent.
        "User-Agent": "resend-approvals",
        "Idempotency-Key": idempotencyKey,
        "x-batch-validation": "strict",
      },
      body: JSON.stringify(
        batch.recipients.map((to) => ({ from, to: [to], subject: batch.subject, html: batch.html })),
      ),
      signal: controller.signal,
    });

    const body = (await res.json().catch(() => null)) as {
      data?: unknown;
      name?: unknown;
      message?: unknown;
    } | null;

    if (res.ok) {
      const ids = Array.isArray(body?.data)
        ? body.data.map((d: { id?: unknown }) => (typeof d?.id === "string" ? d.id : null))
        : [];
      if (ids.length === batch.recipients.length && ids.every((id) => id !== null)) {
        return { ok: true, ids: ids as string[] };
      }
      return {
        ok: false,
        outcome: "uncertain",
        message: `Resend ${res.status}: unexpected response (expected ${batch.recipients.length} ids).`,
      };
    }

    const name = typeof body?.name === "string" ? body.name : "";
    const detail = typeof body?.message === "string" ? body.message : res.statusText || "no details";
    const message = `Resend ${res.status} ${name ? `${name}: ` : ""}${detail}`;

    if (res.status === 429) {
      if (name === "daily_quota_exceeded" || name === "monthly_quota_exceeded") {
        return { ok: false, outcome: "definite", message, quotaExceeded: true };
      }
      const seconds = Number(res.headers.get("retry-after"));
      return {
        ok: false,
        outcome: "rate_limited",
        message,
        retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000,
      };
    }
    return {
      ok: false,
      // 409 means "same key still in flight" (or reused), which is NOT a rejection.
      outcome: res.status >= 400 && res.status < 500 && res.status !== 409 ? "definite" : "uncertain",
      message,
    };
  } catch (e) {
    const reason =
      e instanceof Error && e.name === "AbortError"
        ? `timed out after ${TIMEOUT_MS / 1000}s`
        : e instanceof Error
          ? e.message
          : "network error";
    return {
      ok: false,
      outcome: "uncertain",
      message: `Could not confirm the result with Resend (${reason}).`,
    };
  } finally {
    clearTimeout(timer);
  }
}
