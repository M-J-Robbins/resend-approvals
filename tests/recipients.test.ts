import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { parseCreateDraft, parseReviseDraft } from "@/lib/validation";
import { POST as createDraftRoute } from "@/app/api/agent/drafts/route";
import { getDraftView, listRecipients, reviseDraft } from "@/services/drafts";
import { approveDraft, rejectDraft } from "@/services/review";
import { fakeResend } from "./helpers/fakeResend";
import {
  addresses,
  approveInput,
  cleanupAll,
  expectAppError,
  newDraft,
  pendingDraft,
  runWorker,
} from "./helpers/factory";

vi.mock("@/lib/resend", async () => {
  const { fakeResend } = await import("./helpers/fakeResend");
  return { sendBatch: fakeResend.send };
});

beforeEach(() => fakeResend.reset());
afterAll(cleanupAll);

const page = (offset = 0, limit = 50, extra: { q?: string; status?: "pending" | "sent" | "failed" } = {}) => ({
  offset,
  limit,
  ...extra,
});

describe("creating a draft", () => {
  it("stores the canonical list and reports duplicates removed", async () => {
    const draft = await newDraft({
      recipients: ["Zed@Example.com", " amy@example.com", "AMY@example.com", "bob@example.org", "zed@example.com"],
    });
    expect(draft.revision.recipient_count).toBe(3);
    expect(draft.revision.duplicates_removed).toBe(2);
    expect(draft.revision.recipients_preview).toEqual(["amy@example.com", "bob@example.org", "zed@example.com"]);
  });

  it("returns only the first 10 recipients inline", async () => {
    const draft = await newDraft({ count: 25 });
    expect(draft.revision.recipient_count).toBe(25);
    expect(draft.revision.recipients_preview).toHaveLength(10);
    expect(draft.revision).not.toHaveProperty("recipients");
  });

  it("lists the first 20 invalid addresses with their index and drops nothing", async () => {
    const list = addresses(30);
    for (let i = 0; i < 25; i++) list.splice(i * 2, 0, `bad-${i}`);
    list.push("Name <named@example.com>");

    const err = await expectAppError(newDraft({ recipients: list }), 400, "invalid_recipients");
    const details = err.details as { invalid_count: number; invalid: { index: number; value: string }[] };
    expect(details.invalid_count).toBe(26);
    expect(details.invalid).toHaveLength(20);
    expect(details.invalid[0]).toEqual({ index: 0, value: "bad-0" });
    expect(details.invalid[1]).toEqual({ index: 2, value: "bad-1" });
    for (const { index, value } of details.invalid) expect(list[index]).toBe(value);
  });

  it("refuses an empty list", async () => {
    await expectAppError(newDraft({ recipients: [] }), 400, "no_recipients");
  });

  it("refuses more unique recipients than MAX_RECIPIENTS, counting after de-duplication", async () => {
    const max = env().MAX_RECIPIENTS;
    expect(max).toBe(5000);
    await expectAppError(newDraft({ recipients: addresses(max + 1) }), 400, "too_many_recipients");

    const atCap = addresses(max);
    const draft = await newDraft({ recipients: [...atCap, ...atCap.slice(0, 50).map((a) => a.toUpperCase())] });
    expect(draft.revision.recipient_count).toBe(max);
    expect(draft.revision.duplicates_removed).toBe(50);
  });

  it("explains that to, cc and bcc are gone", async () => {
    for (const field of ["to", "cc", "bcc"]) {
      const body = { recipients: ["a@example.com"], subject: "x", html: "<p>x</p>", [field]: ["b@example.com"] };
      let caught: unknown;
      try {
        parseCreateDraft(body);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).code).toBe("validation_error");
      expect((caught as AppError).hint).toBe(
        "cc/bcc/to are not supported: send `recipients`; each recipient receives an individual email.",
      );
      expect(() => parseReviseDraft({ [field]: ["b@example.com"] })).toThrow(AppError);
    }

    // And through the real route, as an agent sees it.
    const res = await createDraftRoute(
      new Request("http://localhost/api/agent/drafts", {
        method: "POST",
        headers: { authorization: `Bearer ${env().AGENT_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ to: ["a@example.com"], subject: "x", html: "<p>x</p>" }),
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; hint: string } };
    expect(json.error.code).toBe("validation_error");
    expect(json.error.hint).toContain("send `recipients`");
  });
});

describe("revising recipients", () => {
  it("replaces the whole list when given, and keeps it when omitted", async () => {
    const draft = await newDraft({ count: 3 });
    const kept = await reviseDraft(draft.id, { subject: "New subject" });
    expect(kept.revision.recipients_preview).toEqual(draft.revision.recipients_preview);
    expect(kept.revision.content_hash).not.toBe(draft.revision.content_hash);

    const replaced = await reviseDraft(draft.id, { recipients: ["only@example.com", "ONLY@example.com"] });
    expect(replaced.revision.recipients_preview).toEqual(["only@example.com"]);
    expect(replaced.revision.recipient_count).toBe(1);
    expect(replaced.revision.duplicates_removed).toBe(1);
    expect(replaced.revision.number).toBe(3);
  });

  it("treats the same set in another order or case as no change", async () => {
    const list = addresses(5);
    const draft = await pendingDraft({ recipients: list });
    await rejectDraft(draft.id, { revisionId: draft.revision.id, reason: "Check" });
    await expectAppError(
      reviseDraft(draft.id, { recipients: [...list].reverse().map((a) => a.toUpperCase()) }),
      409,
      "no_changes",
    );
  });

  it("validates a replacement list like a new one", async () => {
    const draft = await newDraft();
    await expectAppError(reviseDraft(draft.id, { recipients: ["nope"] }), 400, "invalid_recipients");
    await expectAppError(reviseDraft(draft.id, { recipients: [] }), 400, "no_recipients");
    expect((await getDraftView(draft.id)).revisions).toHaveLength(1);
  });
});

describe("paging through recipients", () => {
  it("pages in sorted order, searches case-insensitively and counts domains", async () => {
    const list = [...addresses(117, "pgtest"), "Person@Other.example", "x@third.example"];
    const draft = await newDraft({ recipients: list });

    const first = await listRecipients(draft.id, page(0, 50));
    expect(first.total).toBe(119);
    expect(first.items).toHaveLength(50);
    expect(first.items.every((i) => i.status === null && i.resend_email_id === null)).toBe(true);
    const all = [
      ...first.items,
      ...(await listRecipients(draft.id, page(50, 50))).items,
      ...(await listRecipients(draft.id, page(100, 50))).items,
    ].map((i) => i.email);
    expect(all).toHaveLength(119);
    expect(all).toEqual([...all].sort());
    expect(new Set(all).size).toBe(119);

    expect((await listRecipients(draft.id, page(500, 50))).items).toEqual([]);

    const search = await listRecipients(draft.id, page(0, 50, { q: "OTHER.EX" }));
    expect(search.total).toBe(1);
    expect(search.items[0].email).toBe("person@other.example");

    expect(first.top_domains).toEqual([
      { domain: "example.com", count: 117 },
      { domain: "other.example", count: 1 },
      { domain: "third.example", count: 1 },
    ]);
  });

  it("rejects a status filter before approval", async () => {
    const draft = await newDraft({ count: 3 });
    await expectAppError(listRecipients(draft.id, page(0, 50, { status: "sent" })), 400, "validation_error");
  });

  it("reports per-recipient status and the Resend id, aligned by index", async () => {
    fakeResend.queueFor(":c1:", "reject");
    const draft = await pendingDraft({ count: 150 });
    await approveDraft(draft.id, approveInput(draft));

    const before = await listRecipients(draft.id, page(0, 500));
    expect(before.items.every((i) => i.status === "pending")).toBe(true);

    await runWorker(draft.id);

    const sent = await listRecipients(draft.id, page(0, 500, { status: "sent" }));
    const failed = await listRecipients(draft.id, page(0, 500, { status: "failed" }));
    expect(sent.total).toBe(100);
    expect(failed.total).toBe(50);
    expect(failed.items.every((i) => i.resend_email_id === null)).toBe(true);
    expect((await listRecipients(draft.id, page(0, 500, { status: "pending" }))).total).toBe(0);

    const created = fakeResend.created.get(`${draft.revision.id}:c0:g1`)!;
    for (const item of sent.items) {
      expect(item.resend_email_id).toBe(created.ids[created.batch.recipients.indexOf(item.email)]);
    }
  });
});
