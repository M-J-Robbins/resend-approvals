import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { getDraftView } from "@/services/drafts";
import { approveDraft, finalizeDraft, processSends, resumeSend } from "@/services/review";
import { fakeResend } from "./helpers/fakeResend";
import {
  ageChunks,
  approveInput,
  cleanupAll,
  expectAppError,
  expectEachRecipientEmailedOnce,
  pendingDraft,
  rowsFor,
  runWorker,
} from "./helpers/factory";

vi.mock("@/lib/resend", async () => {
  const { fakeResend } = await import("./helpers/fakeResend");
  return { sendBatch: fakeResend.send };
});

beforeEach(() => fakeResend.reset());
afterAll(cleanupAll);

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** A pending draft of `count` recipients, approved: chunks of 100. */
async function approved(count: number) {
  const draft = await pendingDraft({ count });
  await approveDraft(draft.id, approveInput(draft));
  const key = (chunk: number, generation = 1) => `${draft.revision.id}:c${chunk}:g${generation}`;
  return { draft, key };
}

describe("a chunk that Resend definitely rejected", () => {
  it("makes the job failed and partial, and resume sends only that chunk under a fresh key", async () => {
    fakeResend.queueFor(":c1:", "reject");
    const { draft, key } = await approved(250);

    await runWorker(draft.id);
    const failed = await getDraftView(draft.id);
    expect(failed.status).toBe("failed");
    expect(failed.send).toMatchObject({
      status: "failed",
      recipients_sent: 150,
      recipients_failed: 100,
      recipients_pending: 0,
      chunks_sent: 2,
      chunks_failed: 1,
      partial: true,
    });
    expect(failed.send?.errors).toHaveLength(1);
    expect(failed.send?.errors[0]).toMatchObject({
      chunk_index: 1,
      recipient_count: 100,
      attempts: 1,
      resumable: true,
    });
    expect(failed.send?.errors[0].error).toContain("test rejection");

    const callsBefore = fakeResend.calls.length;
    const resumed = await resumeSend(draft.id);
    expect(resumed.status).toBe("approved");
    expect(resumed.resume).toEqual({ chunks_reset: 1, skipped_unsafe: 0 });
    await runWorker(draft.id);

    // Only chunk 1 was sent again, under generation 2.
    expect(fakeResend.calls.slice(callsBefore).map((c) => c.key)).toEqual([key(1, 2)]);
    const final = await getDraftView(draft.id);
    expect(final.status).toBe("sent");
    expect(final.send?.partial).toBe(false);
    await expectEachRecipientEmailedOnce(draft.revision.id);
  });
});

describe("a chunk whose outcome is unknown", () => {
  it("reuses the same key, so a batch that DID go out is not duplicated", async () => {
    // Resend created the emails, but our request never saw the answer.
    fakeResend.queueFor(":c0:", "lose_response");
    const { draft, key } = await approved(150);

    await runWorker(draft.id);
    const failed = await getDraftView(draft.id);
    expect(failed.status).toBe("failed");
    expect(failed.send?.errors[0]).toMatchObject({ chunk_index: 0, resumable: true });

    await resumeSend(draft.id);
    await runWorker(draft.id);

    expect(fakeResend.keysFor(":c0:")).toEqual([key(0), key(0)]);
    expect((await getDraftView(draft.id)).status).toBe("sent");
    await expectEachRecipientEmailedOnce(draft.revision.id);
    // The stored ids are the ones from the batch that really exists.
    const [chunk0] = (await rowsFor(draft.revision.id)).chunks;
    expect(chunk0.resendEmailIds).toEqual(fakeResend.created.get(key(0))?.ids);
  });

  it("also works when the request never reached Resend", async () => {
    fakeResend.queueFor(":c0:", "timeout");
    const { draft, key } = await approved(50);

    await runWorker(draft.id);
    expect((await getDraftView(draft.id)).status).toBe("failed");
    expect(fakeResend.distinctEmails).toBe(0);

    await resumeSend(draft.id);
    await runWorker(draft.id);
    expect(fakeResend.keysFor(":c0:")).toEqual([key(0), key(0)]);
    expect((await getDraftView(draft.id)).status).toBe("sent");
    await expectEachRecipientEmailedOnce(draft.revision.id);
  });
});

describe("the 23-hour rule, per chunk", () => {
  it("resumes the safe chunk and skips the one whose key Resend has forgotten", async () => {
    fakeResend.queueFor(":c0:", "timeout");
    fakeResend.queueFor(":c1:", "timeout");
    const { draft, key } = await approved(250);
    await runWorker(draft.id);
    expect((await getDraftView(draft.id)).send?.chunks_failed).toBe(2);

    await ageChunks(draft.revision.id, [0], { keyFirstUsedAt: new Date(Date.now() - 25 * HOUR) });

    const view = await getDraftView(draft.id);
    expect(view.send?.errors.map((e) => [e.chunk_index, e.resumable])).toEqual([
      [0, false],
      [1, true],
    ]);

    const resumed = await resumeSend(draft.id);
    expect(resumed.resume.chunks_reset).toBe(1);
    expect(resumed.resume.skipped_unsafe).toBe(1);
    expect(resumed.resume.hint).toContain("Resend can no longer deduplicate");
    await runWorker(draft.id);

    expect(fakeResend.keysFor(":c0:")).toEqual([key(0)]); // never retried
    expect(fakeResend.keysFor(":c1:")).toEqual([key(1), key(1)]);
    const final = await getDraftView(draft.id);
    expect(final.status).toBe("failed");
    expect(final.send).toMatchObject({ recipients_sent: 150, recipients_failed: 100, partial: true });

    // Nothing safe is left to resume.
    await expectAppError(resumeSend(draft.id), 409, "retry_unsafe");
  });

  it("does not reclaim an abandoned chunk once its key is too old", async () => {
    fakeResend.queueFor(":c0:", "crash_after_create");
    const { draft, key } = await approved(50);
    await expect(runWorker(draft.id)).rejects.toThrow("process died");

    await ageChunks(draft.revision.id, [0], {
      updatedAt: new Date(Date.now() - 2 * MINUTE),
      keyFirstUsedAt: new Date(Date.now() - 25 * HOUR),
    });
    await runWorker(draft.id);

    expect(fakeResend.keysFor(":c0:")).toEqual([key(0)]);
    const final = await getDraftView(draft.id);
    expect(final.status).toBe("failed");
    expect(final.send?.errors[0]).toMatchObject({ chunk_index: 0, resumable: false });
    expect(fakeResend.distinctEmails).toBe(50);
  });

  it("rotates the key after a definite rejection, so an old key never blocks a resume", async () => {
    fakeResend.queueFor(":c0:", "reject");
    const { draft, key } = await approved(50);
    await runWorker(draft.id);
    // The rejected key is long gone, but the chunk now has a fresh, unused one.
    await ageChunks(draft.revision.id, [0], { updatedAt: new Date(Date.now() - 30 * HOUR) });

    const resumed = await resumeSend(draft.id);
    expect(resumed.resume).toEqual({ chunks_reset: 1, skipped_unsafe: 0 });
    await runWorker(draft.id);
    expect(fakeResend.keysFor(":c0:")).toEqual([key(0), key(0, 2)]);
    expect((await getDraftView(draft.id)).status).toBe("sent");
  });
});

describe("rate limits", () => {
  it("retries a 429 with the same key after retry-after", async () => {
    fakeResend.retryAfterMs = 300;
    fakeResend.queueFor(":c0:", "rate_limit", "rate_limit");
    const { draft, key } = await approved(150);

    const started = Date.now();
    await runWorker(draft.id);
    expect(Date.now() - started).toBeGreaterThanOrEqual(600);

    expect(fakeResend.keysFor(":c0:")).toEqual([key(0), key(0), key(0)]);
    const [chunk0] = (await rowsFor(draft.revision.id)).chunks;
    expect(chunk0.attempts).toBe(1); // one claim; the 429s were never processed
    expect((await getDraftView(draft.id)).status).toBe("sent");
    await expectEachRecipientEmailedOnce(draft.revision.id);
  });

  it("hands the chunk back as pending when retry-after would pass the budget", async () => {
    fakeResend.retryAfterMs = 5_000;
    fakeResend.queueFor(":c0:", "rate_limit");
    const { draft } = await approved(50);

    await runWorker(draft.id, { budgetMs: 1_000 });
    const [chunk0] = (await rowsFor(draft.revision.id)).chunks;
    expect(chunk0.status).toBe("pending");
    expect((await getDraftView(draft.id)).status).toBe("approved");

    await runWorker(draft.id);
    expect((await getDraftView(draft.id)).status).toBe("sent");
    await expectEachRecipientEmailedOnce(draft.revision.id);
  });

  it("stops at a quota error and marks the rest failed without sending them", async () => {
    fakeResend.queueFor(":c1:", "quota");
    const { draft } = await approved(450);
    await runWorker(draft.id);

    expect(fakeResend.calls.map((c) => c.key.split(":")[1])).toEqual(["c0", "c1"]);
    const final = await getDraftView(draft.id);
    expect(final.status).toBe("failed");
    expect(final.send).toMatchObject({ chunks_sent: 1, chunks_failed: 4, partial: true });
    expect(final.send?.errors.every((e) => e.resumable)).toBe(true);
    expect(final.send?.errors[1].error).toContain("Not attempted");
  });

  it("spaces requests to the configured rate", async () => {
    fakeResend.delayMs = 0;
    const { draft } = await approved(400);
    const started = Date.now();
    await processSends(draft.id, { maxRequestsPerSecond: 10 });
    // 4 requests at most 10/s: at least 3 gaps of 100ms.
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(fakeResend.calls).toHaveLength(4);
  });
});

describe("a worker that dies mid-run", () => {
  it("is recovered by resume, and a batch Resend created but never confirmed is not re-sent", async () => {
    // Chunk 0 goes out; chunk 1 is created by Resend and then the process dies.
    fakeResend.queueFor(":c1:", "crash_after_create");
    const { draft, key } = await approved(350);

    await expect(runWorker(draft.id)).rejects.toThrow("process died");
    const stuck = await getDraftView(draft.id);
    expect(stuck.status).toBe("approved");
    expect(stuck.send).toMatchObject({ chunks_sent: 1, chunks_pending: 3 });

    // Too soon: chunk 1 might still be in flight, so a new worker leaves it alone.
    await runWorker(draft.id);
    expect(fakeResend.keysFor(":c1:")).toEqual([key(1)]);
    expect((await getDraftView(draft.id)).status).toBe("approved");

    // Two minutes later it is considered abandoned.
    await ageChunks(draft.revision.id, [1], { updatedAt: new Date(Date.now() - 2 * MINUTE) });
    const resumed = await resumeSend(draft.id);
    expect(resumed.resume.chunks_reset).toBe(0);
    await runWorker(draft.id);

    expect(fakeResend.keysFor(":c1:")).toEqual([key(1), key(1)]);
    expect((await getDraftView(draft.id)).status).toBe("sent");
    await expectEachRecipientEmailedOnce(draft.revision.id);
    const chunk1 = (await rowsFor(draft.revision.id)).chunks[1];
    expect(chunk1.resendEmailIds).toEqual(fakeResend.created.get(key(1))?.ids);
    expect(chunk1.attempts).toBe(2);
  });

  it("is recovered when it died before reaching Resend", async () => {
    fakeResend.queueFor(":c0:", "crash");
    const { draft, key } = await approved(50);
    await expect(runWorker(draft.id)).rejects.toThrow("process died");
    await ageChunks(draft.revision.id, [0], { updatedAt: new Date(Date.now() - 2 * MINUTE) });

    await resumeSend(draft.id);
    await runWorker(draft.id);
    expect(fakeResend.keysFor(":c0:")).toEqual([key(0), key(0)]);
    await expectEachRecipientEmailedOnce(draft.revision.id);
  });
});

describe("concurrent resumes", () => {
  it("never send a chunk twice (10 resumes with their workers, 5 rounds)", async () => {
    for (let round = 0; round < 5; round++) {
      fakeResend.reset();
      fakeResend.delayMs = 20;
      fakeResend.queueFor(":c0:", "timeout");
      fakeResend.queueFor(":c2:", "lose_response");
      const { draft } = await approved(500);
      await runWorker(draft.id);
      expect((await getDraftView(draft.id)).send?.chunks_failed, `round ${round}`).toBe(2);

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, async () => {
          await resumeSend(draft.id);
          await runWorker(draft.id);
        }),
      );
      for (const r of results) {
        if (r.status === "rejected") {
          expect(r.reason, `round ${round}`).toBeInstanceOf(AppError);
          expect((r.reason as AppError).status).toBe(409);
        }
      }
      await runWorker(draft.id);

      expect((await getDraftView(draft.id)).status, `round ${round}`).toBe("sent");
      await expectEachRecipientEmailedOnce(draft.revision.id);
    }
  });

  it("refuses to resume a draft that was never approved", async () => {
    const draft = await pendingDraft();
    await expectAppError(resumeSend(draft.id), 409, "not_resumable");
    expect(fakeResend.calls).toHaveLength(0);
  });
});

describe("finalizeDraft", () => {
  it("is idempotent and safe to run concurrently", async () => {
    const { draft } = await approved(120);
    await runWorker(draft.id);
    await Promise.all(Array.from({ length: 5 }, () => finalizeDraft(draft.id)));
    const view = await getDraftView(draft.id);
    expect(view.status).toBe("sent");
    expect(view.send?.status).toBe("sent");
  });

  it("changes nothing while chunks are pending", async () => {
    const { draft } = await approved(120);
    await finalizeDraft(draft.id);
    expect((await getDraftView(draft.id)).status).toBe("approved");
  });
});

describe("a full-size job", () => {
  it("sends a 5,000-recipient draft with every recipient emailed exactly once", async () => {
    fakeResend.delayMs = 5;
    const { draft } = await approved(5000);
    const rows = await rowsFor(draft.revision.id);
    expect(rows.chunks).toHaveLength(50);

    await Promise.all([runWorker(draft.id), runWorker(draft.id)]);

    expect(fakeResend.calls).toHaveLength(50);
    await expectEachRecipientEmailedOnce(draft.revision.id);
    const final = await getDraftView(draft.id);
    expect(final.status).toBe("sent");
    expect(final.send).toMatchObject({ recipients_sent: 5000, chunks_sent: 50, partial: false });
  });
});
