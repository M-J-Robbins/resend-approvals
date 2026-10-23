import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { getDraftView } from "@/services/drafts";
import { approveDraft, rejectDraft } from "@/services/review";
import { fakeResend } from "./helpers/fakeResend";
import {
  approveInput,
  cleanupAll,
  expectAppError,
  expectEachRecipientEmailedOnce,
  pendingDraft,
  rowsFor,
  runWorker,
  storedRecipients,
} from "./helpers/factory";

// Replace the real Resend call. vi.mock is hoisted above the imports.
vi.mock("@/lib/resend", async () => {
  const { fakeResend } = await import("./helpers/fakeResend");
  return { sendBatch: fakeResend.send };
});

beforeEach(() => fakeResend.reset());
afterAll(cleanupAll);

describe("repeated and concurrent approval", () => {
  it("10 approvals racing create exactly one job and ceil(N/size) batch calls", async () => {
    const draft = await pendingDraft({ count: 250 });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => approveDraft(draft.id, approveInput(draft))),
    );

    // Losers are told the current state rather than failing.
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    // Approving never calls Resend itself.
    expect(fakeResend.calls).toHaveLength(0);

    const rows = await rowsFor(draft.revision.id);
    expect(rows.reviews).toHaveLength(1);
    expect(rows.sends).toHaveLength(1);
    expect(rows.sends[0].chunkSize).toBe(100);
    expect(rows.chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
    expect(rows.chunks.every((c) => c.status === "pending" && c.attempts === 0)).toBe(true);

    const approved = await getDraftView(draft.id);
    expect(approved.status).toBe("approved");
    expect(approved.send).toMatchObject({
      status: "sending",
      recipients_total: 250,
      recipients_pending: 250,
      chunks_total: 3,
      chunks_pending: 3,
    });

    await runWorker(draft.id);

    expect(fakeResend.calls).toHaveLength(Math.ceil(250 / 100));
    await expectEachRecipientEmailedOnce(draft.revision.id);
    const final = await getDraftView(draft.id);
    expect(final.status).toBe("sent");
    expect(final.send).toMatchObject({
      status: "sent",
      recipients_sent: 250,
      recipients_failed: 0,
      recipients_pending: 0,
      chunks_sent: 3,
      partial: false,
      errors: [],
    });
  });

  it("does not create or send anything when the same approval is repeated later", async () => {
    const draft = await pendingDraft({ count: 3 });

    await approveDraft(draft.id, approveInput(draft));
    await runWorker(draft.id);
    const again = await approveDraft(draft.id, approveInput(draft));
    await runWorker(draft.id);

    expect(again.status).toBe("sent");
    expect(fakeResend.calls).toHaveLength(1);
    const rows = await rowsFor(draft.revision.id);
    expect(rows.sends).toHaveLength(1);
    expect(rows.chunks).toHaveLength(1);
  });

  it("sends each stored recipient an individual email with the approved subject and html", async () => {
    const draft = await pendingDraft({ count: 150 });
    await approveDraft(draft.id, approveInput(draft));
    await runWorker(draft.id);

    const recipients = await storedRecipients(draft.revision.id);
    // Chunk N is recipients[N*100 .. (N+1)*100) of the sorted list.
    const byKey = new Map(fakeResend.calls.map((c) => [c.key, c.batch]));
    expect(byKey.get(`${draft.revision.id}:c0:g1`)?.recipients).toEqual(recipients.slice(0, 100));
    expect(byKey.get(`${draft.revision.id}:c1:g1`)?.recipients).toEqual(recipients.slice(100));
    for (const { batch } of fakeResend.calls) {
      expect(batch.subject).toBe(draft.revision.subject);
      expect(batch.html).toBe(draft.revision.html);
    }
    await expectEachRecipientEmailedOnce(draft.revision.id);
  });

  it("refuses an approval whose recipient_count differs from the revision", async () => {
    const draft = await pendingDraft({ count: 5 });
    await expectAppError(
      approveDraft(draft.id, { ...approveInput(draft), recipientCount: 4 }),
      409,
      "recipient_count_mismatch",
    );
    expect((await getDraftView(draft.id)).status).toBe("pending_approval");
    const rows = await rowsFor(draft.revision.id);
    expect(rows.reviews).toHaveLength(0);
    expect(rows.sends).toHaveLength(0);
  });
});

describe("approve racing reject", () => {
  it("exactly one decision wins, and a rejection never creates a job (10 rounds)", async () => {
    for (let round = 0; round < 10; round++) {
      fakeResend.reset();
      const draft = await pendingDraft({ count: 120 });

      const [approve, reject] = await Promise.allSettled([
        approveDraft(draft.id, approveInput(draft)),
        rejectDraft(draft.id, { revisionId: draft.revision.id, reason: "not right" }),
      ]);

      const winners = [approve, reject].filter((r) => r.status === "fulfilled");
      expect(winners, `round ${round}`).toHaveLength(1);

      const loser = [approve, reject].find((r) => r.status === "rejected");
      const reason = (loser as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(AppError);
      expect((reason as AppError).status).toBe(409);

      await runWorker(draft.id);
      const rows = await rowsFor(draft.revision.id);
      expect(rows.reviews, `round ${round}`).toHaveLength(1);

      const final = await getDraftView(draft.id);
      if (approve.status === "fulfilled") {
        expect(final.status).toBe("sent");
        expect(fakeResend.calls).toHaveLength(2);
        await expectEachRecipientEmailedOnce(draft.revision.id);
      } else {
        expect(final.status).toBe("rejected");
        expect(fakeResend.calls).toHaveLength(0);
        expect(rows.sends).toHaveLength(0);
        expect(rows.chunks).toHaveLength(0);
      }
    }
  });
});

describe("workers racing", () => {
  it("never send the same chunk twice (3 workers, 10 rounds)", async () => {
    for (let round = 0; round < 10; round++) {
      fakeResend.reset();
      fakeResend.delayMs = 20;
      const draft = await pendingDraft({ count: 1000 });
      await approveDraft(draft.id, approveInput(draft));

      const results = await Promise.allSettled([
        runWorker(draft.id),
        runWorker(draft.id),
        runWorker(draft.id),
      ]);
      expect(results.filter((r) => r.status === "rejected"), `round ${round}`).toHaveLength(0);

      const keys = fakeResend.calls.map((c) => c.key);
      expect(keys, `round ${round}`).toHaveLength(10);
      expect(new Set(keys).size, `round ${round}`).toBe(10);
      await expectEachRecipientEmailedOnce(draft.revision.id);

      const rows = await rowsFor(draft.revision.id);
      expect(rows.chunks.map((c) => c.attempts)).toEqual(Array(10).fill(1));
      expect((await getDraftView(draft.id)).status).toBe("sent");
    }
  });
});
