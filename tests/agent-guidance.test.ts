import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { POST as createDraftRoute, GET as listDraftsRoute } from "@/app/api/agent/drafts/route";
import { GET as getDraftRoute, PUT as reviseDraftRoute } from "@/app/api/agent/drafts/[id]/route";
import { POST as submitRoute } from "@/app/api/agent/drafts/[id]/submit/route";
import { cleanupAll, newDraft, pendingDraft } from "./helpers/factory";

afterAll(cleanupAll);

// What an agent sees when it gets a request slightly wrong: every
// validation_error must say what a valid request looks like.

type ErrorJson = { error: { code: string; message: string; hint?: string; issues?: { path: string }[] } };

function agentRequest(path: string, init: { method: string; body?: string }) {
  return new Request(`https://approvals.test${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env().AGENT_API_KEY}`, "content-type": "application/json" },
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("agent guidance", () => {
  it("names revision_id when submit has no body", async () => {
    for (const body of [undefined, "", "{}"]) {
      const res = await submitRoute(agentRequest("/api/agent/drafts/drf_x/submit", { method: "POST", body }), ctx("drf_x"));
      expect(res.status).toBe(400);
      const json = (await res.json()) as ErrorJson;
      expect(json.error.code).toBe("validation_error");
      expect(json.error.issues?.map((i) => i.path)).toEqual(["revision_id"]);
      expect(json.error.hint).toContain('{"revision_id"');
    }
  });

  it("lists the allowed fields when a create or revise uses an unknown one", async () => {
    const create = await createDraftRoute(
      agentRequest("/api/agent/drafts", {
        method: "POST",
        body: JSON.stringify({ recipients: ["delivered@resend.dev"], subject: "x", body: "<p>x</p>" }),
      }),
    );
    expect(create.status).toBe(400);
    const createJson = (await create.json()) as ErrorJson;
    expect(createJson.error.code).toBe("validation_error");
    expect(createJson.error.hint).toContain("`html`");

    const revise = await reviseDraftRoute(
      agentRequest("/api/agent/drafts/drf_x", { method: "PUT", body: JSON.stringify({ body: "<p>x</p>" }) }),
      ctx("drf_x"),
    );
    expect(revise.status).toBe(400);
    const reviseJson = (await revise.json()) as ErrorJson;
    expect(reviseJson.error.hint).toContain("`html`");
    expect(reviseJson.error.hint).toContain("replace the current value in full");
  });

  it("names the problem in the message, for agents that read only message", async () => {
    const res = await reviseDraftRoute(
      agentRequest("/api/agent/drafts/drf_x", {
        method: "PUT",
        body: JSON.stringify({ add_recipients: ["delivered@resend.dev"] }),
      }),
      ctx("drf_x"),
    );
    const json = (await res.json()) as ErrorJson;
    expect(json.error.message).toContain("add_recipients");
    expect(json.error.hint).toContain("send the current list plus the new address");
  });

  it("still refuses a body that isn't JSON", async () => {
    const res = await submitRoute(
      agentRequest("/api/agent/drafts/drf_x/submit", { method: "POST", body: "revision_id=rev_1" }),
      ctx("drf_x"),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorJson).error.code).toBe("invalid_json");
  });

  it("gives every draft response a review_url that opens the draft", async () => {
    const draft = await newDraft();
    const res = await getDraftRoute(agentRequest(`/api/agent/drafts/${draft.id}`, { method: "GET" }), ctx(draft.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { review_url: string };
    expect(json.review_url).toBe(`https://approvals.test/?draft=${draft.id}`);
  });

  it("lists drafts with a review_url each", async () => {
    const draft = await newDraft();
    const res = await listDraftsRoute(agentRequest("/api/agent/drafts?status=draft", { method: "GET" }));
    const json = (await res.json()) as { drafts: { id: string; review_url: string }[] };
    expect(json.drafts.find((d) => d.id === draft.id)?.review_url).toBe(`https://approvals.test/?draft=${draft.id}`);
  });

  it("warns when a revise drops recipients, as sending only the new address does", async () => {
    const draft = await newDraft({ recipients: ["delivered+ada@resend.dev", "delivered+grace@resend.dev", "delivered+linus@resend.dev"] });
    const revise = (recipients: string[]) =>
      reviseDraftRoute(
        agentRequest(`/api/agent/drafts/${draft.id}`, { method: "PUT", body: JSON.stringify({ recipients }) }),
        ctx(draft.id),
      );
    type Revised = {
      recipients_change: { previous_count: number; count: number; added: number; removed: number; warning?: string } | null;
      next_actions: { action: string; description: string }[];
    };

    const dropped = (await (await revise(["delivered+margaret@resend.dev"])).json()) as Revised;
    expect(dropped.recipients_change).toMatchObject({ previous_count: 3, count: 1, added: 1, removed: 3 });
    expect(dropped.recipients_change?.warning).toContain("removed 3 of the previous 3 recipients");
    const submit = dropped.next_actions.find((a) => a.action === "submit");
    expect(submit?.description).toContain(dropped.recipients_change?.warning);

    const all = ["delivered+ada@resend.dev", "delivered+grace@resend.dev", "delivered+linus@resend.dev", "delivered+margaret@resend.dev"];
    const added = (await (await revise(all)).json()) as Revised;
    expect(added.recipients_change).toEqual({ previous_count: 1, count: 4, added: 3, removed: 0 });
    expect(added.next_actions.find((a) => a.action === "submit")?.description).not.toContain("First check");

    // Same content again: no new revision, so nothing to compare.
    const unchanged = (await (await revise(all)).json()) as Revised;
    expect(unchanged.recipients_change).toBeNull();
  });

  it("tells the agent to submit again after revising a pending draft", async () => {
    const draft = await pendingDraft();
    const res = await reviseDraftRoute(
      agentRequest(`/api/agent/drafts/${draft.id}`, { method: "PUT", body: JSON.stringify({ subject: "Changed" }) }),
      ctx(draft.id),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; next_actions: { action: string; body?: { revision_id: string } }[] };
    expect(json.status).toBe("draft");
    expect(json.next_actions[0].action).toBe("submit");
  });
});
