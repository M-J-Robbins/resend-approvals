import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { AppError } from "./errors";

// Compare SHA-256 digests so lengths always match and timing doesn't leak.
const digest = (s: string) => createHash("sha256").update(s).digest();
const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

function bearer(req: Request): string | null {
  const m = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

function cookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** Agent routes accept ONLY the agent key. */
export function requireAgent(req: Request): void {
  const token = bearer(req);
  if (!token) {
    throw new AppError(
      401,
      "unauthorized",
      "Missing agent API key.",
      "Send the header 'Authorization: Bearer <AGENT_API_KEY>'.",
    );
  }
  if (!safeEqual(token, env().AGENT_API_KEY)) {
    if (safeEqual(token, env().REVIEWER_TOKEN)) {
      throw new AppError(
        403,
        "wrong_credential_type",
        "Reviewer credentials cannot be used on agent endpoints.",
      );
    }
    throw new AppError(401, "unauthorized", "Invalid agent API key.");
  }
}

/**
 * Reviewer routes accept ONLY the reviewer token (header, or the httpOnly
 * cookie the review UI sets). The agent key is explicitly refused.
 */
export function requireReviewer(req: Request): void {
  const token = bearer(req) ?? cookie(req, "reviewer_token");
  if (!token) {
    throw new AppError(
      401,
      "unauthorized",
      "Missing reviewer token.",
      "Humans sign in through the review UI.",
    );
  }
  if (!safeEqual(token, env().REVIEWER_TOKEN)) {
    if (safeEqual(token, env().AGENT_API_KEY)) {
      throw new AppError(
        403,
        "agent_cannot_review",
        "Agent credentials cannot approve, reject or send drafts. A human must review them.",
        "Submit the draft for approval and poll its status.",
      );
    }
    throw new AppError(401, "unauthorized", "Invalid reviewer token.");
  }
}
