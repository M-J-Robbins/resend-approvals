import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDraftView, reviseDraft, submitDraft } from "@/services/drafts";
import { approveDraft, rejectDraft } from "@/services/review";
import { fakeResend } from "./helpers/fakeResend";
import {
  approveInput,
  cleanupAll,
  expectAppError,
  newDraft,
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

describe("a change needs a new approval", () => {
  it("rejects an approval of a revision that has since been replaced", async () => {
    const draft = await pendingDraft();
    const revised = await reviseDraft(draft.id, { subject: "A different subject" });

    // Revising withdrew the pending approval request.
    expect(revised.status).toBe("draft");
    expect(revised.revision.number).toBe(2);

    // The reviewer still has the old revision open.
    await expectAppError(approveDraft(draft.id, approveInput(draft)), 409, "revision_changed");

    // Even once revision 2 is resubmitted, revision 1 stays unapprovable.
    await submitDraft(draft.id, revised.revision.id);
    await expectAppError(approveDraft(draft.id, approveInput(draft)), 409, "revision_changed");

    expect((await rowsFor(draft.revision.id)).reviews).toHaveLength(0);
    expect((await rowsFor(draft.revision.id)).sends).toHaveLength(0);

    // Approving revision 2 sends revision 2's content, not revision 1's.
    await approveDraft(draft.id, approveInput(revised));
    await runWorker(draft.id);
    expect(fakeResend.calls).toHaveLength(1);
    expect(fakeResend.calls[0]?.batch.subject).toBe("A different subject");
  });

  it("rejects an approval whose content hash does not match the revision", async () => {
    const draft = await pendingDraft();

    await expectAppError(
      approveDraft(draft.id, { ...approveInput(draft), contentHash: "0".repeat(64) }),
      409,
      "content_hash_mismatch",
    );

    expect((await getDraftView(draft.id)).status).toBe("pending_approval");
    expect((await rowsFor(draft.revision.id)).reviews).toHaveLength(0);
    expect((await rowsFor(draft.revision.id)).sends).toHaveLength(0);
  });

  it("never lets a revision and an approval both succeed (10 rounds)", async () => {
    for (let round = 0; round < 10; round++) {
      fakeResend.reset();
      const draft = await pendingDraft({ count: 150 });

      const [approval, revision] = await Promise.allSettled([
        approveDraft(draft.id, approveInput(draft)),
        reviseDraft(draft.id, { subject: `Changed in round ${round}` }),
      ]);

      const approved = approval.status === "fulfilled";
      const revised = revision.status === "fulfilled";
      expect(approved !== revised, `round ${round}: exactly one must win`).toBe(true);

      await runWorker(draft.id);
      const final = await getDraftView(draft.id);
      if (approved) {
        // Approval won: the original content went out and no new revision exists.
        expect(fakeResend.calls).toHaveLength(2);
        expect(fakeResend.calls.every((c) => c.batch.subject === draft.revision.subject)).toBe(true);
        expect(final.revisions).toHaveLength(1);
        expect(final.status).toBe("sent");
      } else {
        // Revision won: nothing was approved or sent.
        expect(fakeResend.calls).toHaveLength(0);
        expect(final.revisions).toHaveLength(2);
        expect(final.status).toBe("draft");
        expect((await rowsFor(draft.revision.id)).sends).toHaveLength(0);
      }
    }
  });
});

describe("draft state rules", () => {
  it("treats submitting twice as harmless", async () => {
    const draft = await newDraft();
    await submitDraft(draft.id, draft.revision.id);
    const again = await submitDraft(draft.id, draft.revision.id);
    expect(again.status).toBe("pending_approval");
  });

  it("refuses to submit a revision that is not the current one", async () => {
    const draft = await newDraft();
    await reviseDraft(draft.id, { subject: "Second version" });
    await expectAppError(submitDraft(draft.id, draft.revision.id), 409, "revision_changed");
  });

  it("requires a rejected draft to be revised before it can be submitted again", async () => {
    const draft = await pendingDraft();
    await rejectDraft(draft.id, { revisionId: draft.revision.id, reason: "Wrong tone" });

    const rejected = await getDraftView(draft.id);
    expect(rejected.status).toBe("rejected");
    expect(rejected.review?.reason).toBe("Wrong tone");

    await expectAppError(submitDraft(draft.id, draft.revision.id), 409, "invalid_state");
    // Identical content isn't a real change.
    await expectAppError(reviseDraft(draft.id, { subject: draft.revision.subject }), 409, "no_changes");

    const revised = await reviseDraft(draft.id, { subject: "Friendlier subject" });
    expect(revised.status).toBe("draft");
    expect((await submitDraft(draft.id, revised.revision.id)).status).toBe("pending_approval");
  });

  it("refuses to revise while sending is in progress", async () => {
    const draft = await pendingDraft({ count: 120 });
    await approveDraft(draft.id, approveInput(draft));

    // Approved, no chunk sent yet.
    await expectAppError(reviseDraft(draft.id, { subject: "Too late" }), 409, "draft_locked");
    await expectAppError(
      reviseDraft(draft.id, { recipients: ["someone-else@example.com"] }),
      409,
      "draft_locked",
    );

    // Mid-send: the worker is between chunks.
    fakeResend.delayMs = 300;
    const worker = runWorker(draft.id);
    await new Promise((r) => setTimeout(r, 150));
    await expectAppError(reviseDraft(draft.id, { subject: "Too late" }), 409, "draft_locked");
    await worker;

    expect(fakeResend.calls.every((c) => c.batch.subject === draft.revision.subject)).toBe(true);
    expect((await getDraftView(draft.id)).revisions).toHaveLength(1);
  });

  it("locks a draft once it has been sent", async () => {
    const draft = await pendingDraft();
    await approveDraft(draft.id, approveInput(draft));
    await runWorker(draft.id);

    await expectAppError(reviseDraft(draft.id, { subject: "Too late" }), 409, "draft_locked");
    expect(fakeResend.calls).toHaveLength(1);
  });
});
