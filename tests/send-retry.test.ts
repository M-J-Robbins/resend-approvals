import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { sends } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { getDraftView } from "@/services/drafts";
import { approveDraft, retrySend } from "@/services/review";
import { fakeResend } from "./helpers/fakeResend";
import { approveInput, cleanupAll, expectAppError, pendingDraft, rowsFor } from "./helpers/factory";

vi.mock("@/lib/resend", async () => {
  const { fakeResend } = await import("./helpers/fakeResend");
  return { sendEmail: fakeResend.send };
});

beforeEach(() => fakeResend.reset());
afterAll(cleanupAll);

const HOUR = 60 * 60 * 1000;

describe("a send that Resend definitely rejected", () => {
  it("is marked failed, then retried under a fresh idempotency key", async () => {
    fakeResend.queue("reject");
    const draft = await pendingDraft();

    const failed = await approveDraft(draft.id, approveInput(draft));
    expect(failed.status).toBe("failed");
    expect(failed.send?.status).toBe("failed");
    expect(failed.send?.error).toContain("test rejection");
    expect(fakeResend.distinctEmails).toBe(0);

    const retried = await retrySend(draft.id);
    expect(retried.status).toBe("sent");
    expect(retried.send?.attempts).toBe(2);

    // Rotated after the definite rejection, so a cached error can't block the retry.
    expect(fakeResend.calls.map((c) => c.key)).toEqual([draft.revision.id, `${draft.revision.id}:2`]);
    expect(fakeResend.distinctEmails).toBe(1);
  });
});

describe("a send whose outcome is unknown", () => {
  it("reuses the same key, so an email that DID go out is not duplicated", async () => {
    // Resend created the email, but our request never saw the answer.
    fakeResend.queue("lose_response");
    const draft = await pendingDraft();

    const failed = await approveDraft(draft.id, approveInput(draft));
    expect(failed.status).toBe("failed");
    expect(fakeResend.distinctEmails).toBe(1);

    const retried = await retrySend(draft.id);
    expect(retried.status).toBe("sent");

    expect(fakeResend.calls.map((c) => c.key)).toEqual([draft.revision.id, draft.revision.id]);
    expect(fakeResend.distinctEmails).toBe(1); // still one real email
    expect(retried.send?.resend_email_id).toBe(fakeResend.created.get(draft.revision.id)?.id);
  });

  it("also works when the request never reached Resend", async () => {
    fakeResend.queue("timeout");
    const draft = await pendingDraft();

    expect((await approveDraft(draft.id, approveInput(draft))).status).toBe("failed");
    expect(fakeResend.distinctEmails).toBe(0);

    expect((await retrySend(draft.id)).status).toBe("sent");
    expect(fakeResend.distinctEmails).toBe(1);
  });

  it("refuses to retry once Resend can no longer deduplicate (key older than 23h)", async () => {
    fakeResend.queue("timeout");
    const draft = await pendingDraft();
    await approveDraft(draft.id, approveInput(draft));

    await getDb()
      .update(sends)
      .set({ keyFirstUsedAt: new Date(Date.now() - 25 * HOUR) })
      .where(eq(sends.revisionId, draft.revision.id));

    await expectAppError(retrySend(draft.id), 409, "retry_unsafe");
    expect(fakeResend.calls).toHaveLength(1); // no second attempt was made
  });
});

describe("concurrent retries", () => {
  it("trigger exactly one additional send (10 at once)", async () => {
    fakeResend.queue("timeout");
    const draft = await pendingDraft();
    await approveDraft(draft.id, approveInput(draft));
    expect(fakeResend.calls).toHaveLength(1);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => retrySend(draft.id)),
    );

    // One retry went through; every other caller was turned away with a 409,
    // never a 500 and never a second send.
    expect(fakeResend.calls).toHaveLength(2);
    expect(fakeResend.distinctEmails).toBe(1);
    for (const r of results) {
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(AppError);
        expect((r.reason as AppError).status).toBe(409);
      }
    }
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);

    const final = await getDraftView(draft.id);
    expect(final.status).toBe("sent");
    expect(final.send?.attempts).toBe(2);
  });

  it("refuses to retry a draft that is not failed", async () => {
    const draft = await pendingDraft();
    await expectAppError(retrySend(draft.id), 409, "not_retryable");
    expect(fakeResend.calls).toHaveLength(0);
  });
});

describe("a request that dies mid-send", () => {
  it("is recovered by a retry without a second email", async () => {
    // The process dies right after Resend created the email: the row is stuck in "sending".
    fakeResend.queue("crash_after_create");
    const draft = await pendingDraft();

    await expect(approveDraft(draft.id, approveInput(draft))).rejects.toThrow("process died");

    const stuck = await getDraftView(draft.id);
    expect(stuck.status).toBe("approved");
    expect(stuck.send?.status).toBe("sending");
    expect(fakeResend.distinctEmails).toBe(1);

    // Too soon: the original request might still be running.
    await expectAppError(retrySend(draft.id), 409, "send_in_progress");

    // Two minutes later the row is considered abandoned.
    await getDb()
      .update(sends)
      .set({ updatedAt: new Date(Date.now() - 2 * 60 * 1000) })
      .where(eq(sends.revisionId, draft.revision.id));

    const recovered = await retrySend(draft.id);
    expect(recovered.status).toBe("sent");
    expect(fakeResend.calls.map((c) => c.key)).toEqual([draft.revision.id, draft.revision.id]);
    expect(fakeResend.distinctEmails).toBe(1);
    expect(recovered.send?.resend_email_id).toBe(fakeResend.created.get(draft.revision.id)?.id);
    expect((await rowsFor(draft.revision.id)).sends).toHaveLength(1);
  });
});
