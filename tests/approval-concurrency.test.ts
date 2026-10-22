import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { getDraftView } from "@/services/drafts";
import { approveDraft, rejectDraft } from "@/services/review";
import { fakeResend } from "./helpers/fakeResend";
import { approveInput, cleanupAll, pendingDraft, rowsFor } from "./helpers/factory";

// Replace the real Resend call. vi.mock is hoisted above the imports.
vi.mock("@/lib/resend", async () => {
  const { fakeResend } = await import("./helpers/fakeResend");
  return { sendEmail: fakeResend.send };
});

beforeEach(() => fakeResend.reset());
afterAll(cleanupAll);

describe("repeated and concurrent approval", () => {
  it("sends exactly one email when 10 approvals for the same revision race", async () => {
    const draft = await pendingDraft();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => approveDraft(draft.id, approveInput(draft))),
    );

    // Losers are told the current state rather than failing.
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);

    expect(fakeResend.calls).toHaveLength(1);
    expect(fakeResend.distinctEmails).toBe(1);

    const rows = await rowsFor(draft.revision.id);
    expect(rows.reviews).toHaveLength(1);
    expect(rows.sends).toHaveLength(1);

    const final = await getDraftView(draft.id);
    expect(final.status).toBe("sent");
    expect(final.send?.status).toBe("sent");
    expect(final.send?.resend_email_id).toBe(fakeResend.created.get(draft.revision.id)?.id);
  });

  it("does not resend when the same approval is repeated later", async () => {
    const draft = await pendingDraft();

    await approveDraft(draft.id, approveInput(draft));
    const again = await approveDraft(draft.id, approveInput(draft));

    expect(again.status).toBe("sent");
    expect(fakeResend.calls).toHaveLength(1);
    expect((await rowsFor(draft.revision.id)).sends).toHaveLength(1);
  });

  it("sends the exact recipients and content the reviewer saw", async () => {
    const draft = await pendingDraft();
    await approveDraft(draft.id, approveInput(draft));

    expect(fakeResend.calls[0]?.content).toMatchObject({
      to: draft.revision.to,
      cc: draft.revision.cc,
      bcc: draft.revision.bcc,
      subject: draft.revision.subject,
      html: draft.revision.html,
    });
  });
});

describe("approve racing reject", () => {
  it("exactly one decision wins, and a rejection never sends (10 rounds)", async () => {
    for (let round = 0; round < 10; round++) {
      fakeResend.reset();
      const draft = await pendingDraft();

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

      const rows = await rowsFor(draft.revision.id);
      expect(rows.reviews, `round ${round}`).toHaveLength(1);

      const final = await getDraftView(draft.id);
      if (approve.status === "fulfilled") {
        expect(final.status).toBe("sent");
        expect(fakeResend.calls).toHaveLength(1);
      } else {
        expect(final.status).toBe("rejected");
        expect(fakeResend.calls).toHaveLength(0);
        expect(rows.sends).toHaveLength(0);
      }
    }
  });
});
