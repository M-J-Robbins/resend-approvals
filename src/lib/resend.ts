import { env } from "./env";
import type { EmailContent } from "./hash";

export type SendResult =
  | { ok: true; id: string }
  | {
      ok: false;
      /**
       * true:  Resend answered with a 4xx rejection, so no email exists for this request.
       * false: outcome unknown (timeout, network error, 5xx, 409 in flight, malformed reply).
       */
      definite: boolean;
      message: string;
    };

const TIMEOUT_MS = 20_000;

/**
 * Plain fetch instead of the SDK: we need the exact status code and full
 * control over the Idempotency-Key header and timeout.
 */
export async function sendEmail(
  content: EmailContent,
  idempotencyKey: string,
): Promise<SendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env().RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: env().EMAIL_FROM,
        to: content.to,
        ...(content.cc.length ? { cc: content.cc } : {}),
        ...(content.bcc.length ? { bcc: content.bcc } : {}),
        subject: content.subject,
        html: content.html,
      }),
      signal: controller.signal,
    });

    const body = (await res.json().catch(() => null)) as {
      id?: unknown;
      name?: unknown;
      message?: unknown;
    } | null;

    if (res.ok && typeof body?.id === "string") {
      return { ok: true, id: body.id };
    }

    const name = typeof body?.name === "string" ? `${body.name}: ` : "";
    const detail =
      typeof body?.message === "string"
        ? body.message
        : res.statusText || "no details";
    return {
      ok: false,
      // 409 means "same key still in flight", which is NOT a rejection.
      definite: res.status >= 400 && res.status < 500 && res.status !== 409,
      message: `Resend ${res.status} ${name}${detail}`,
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
      definite: false,
      message: `Could not confirm the result with Resend (${reason}).`,
    };
  } finally {
    clearTimeout(timer);
  }
}
