import { describe, expect, it } from "vitest";
import { requireAgent, requireReviewer } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";

// Route handlers under test. Credentials are checked before anything else
// happens, so these never reach the database or Resend.
import { POST as createDraftRoute } from "@/app/api/agent/drafts/route";
import { GET as agentRecipientsRoute } from "@/app/api/agent/drafts/[id]/recipients/route";
import { POST as approveRoute } from "@/app/api/review/drafts/[id]/approve/route";
import { POST as rejectRoute } from "@/app/api/review/drafts/[id]/reject/route";
import { POST as resumeRoute } from "@/app/api/review/drafts/[id]/resume/route";
import { GET as reviewRecipientsRoute } from "@/app/api/review/drafts/[id]/recipients/route";
import { GET as reviewListRoute } from "@/app/api/review/drafts/route";
import { GET as reviewGetRoute } from "@/app/api/review/drafts/[id]/route";

const agentKey = () => env().AGENT_API_KEY;
const reviewerToken = () => env().REVIEWER_TOKEN;

const withBearer = (token: string, init: RequestInit = {}) =>
  new Request("http://localhost/api/x", {
    method: "POST",
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
const withCookie = (token: string) =>
  new Request("http://localhost/api/x", { headers: { cookie: `reviewer_token=${token}` } });
const bare = () => new Request("http://localhost/api/x");

function thrownBy(fn: () => void): AppError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected the call to throw");
}

describe("credential separation", () => {
  it("accepts the agent key on agent routes only", () => {
    expect(() => requireAgent(withBearer(agentKey()))).not.toThrow();

    const wrong = thrownBy(() => requireAgent(withBearer(reviewerToken())));
    expect([wrong.status, wrong.code]).toEqual([403, "wrong_credential_type"]);
  });

  it("accepts the reviewer token (header or cookie) on review routes only", () => {
    expect(() => requireReviewer(withBearer(reviewerToken()))).not.toThrow();
    expect(() => requireReviewer(withCookie(reviewerToken()))).not.toThrow();

    for (const req of [withBearer(agentKey()), withCookie(agentKey())]) {
      const err = thrownBy(() => requireReviewer(req));
      expect([err.status, err.code]).toEqual([403, "agent_cannot_review"]);
    }
  });

  it("answers 401 for missing or unknown credentials", () => {
    for (const fn of [requireAgent, requireReviewer]) {
      expect(thrownBy(() => fn(bare())).status).toBe(401);
      expect(thrownBy(() => fn(withBearer("not-a-real-token"))).status).toBe(401);
    }
  });
});

describe("agent key against the real route handlers", () => {
  const ctx = { params: Promise.resolve({ id: "drf_does_not_matter" }) };
  const body = JSON.stringify({
    revision_id: "rev_x",
    content_hash: "0".repeat(64),
    recipient_count: 1,
    reason: "x",
  });

  const reviewRoutes: [string, () => Promise<Response>][] = [
    ["POST approve", () => approveRoute(withBearer(agentKey(), { body }), ctx)],
    ["POST reject", () => rejectRoute(withBearer(agentKey(), { body }), ctx)],
    ["POST resume", () => resumeRoute(withBearer(agentKey(), { body: "{}" }), ctx)],
    ["GET review list", () => reviewListRoute(withBearer(agentKey(), { method: "GET" }))],
    ["GET review draft", () => reviewGetRoute(withBearer(agentKey(), { method: "GET" }), ctx)],
    ["GET review recipients", () => reviewRecipientsRoute(withBearer(agentKey(), { method: "GET" }), ctx)],
  ];

  it.each(reviewRoutes)("is refused with 403 on %s", async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("agent_cannot_review");
  });

  it.each([
    [
      "POST create draft",
      () =>
        createDraftRoute(
          withBearer(reviewerToken(), {
            body: JSON.stringify({ recipients: ["a@example.com"], subject: "x", html: "<p>x</p>" }),
          }),
        ),
    ],
    ["GET agent recipients", () => agentRecipientsRoute(withBearer(reviewerToken(), { method: "GET" }), ctx)],
  ] as [string, () => Promise<Response>][])("the reviewer token is refused on %s", async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("wrong_credential_type");
  });
});
