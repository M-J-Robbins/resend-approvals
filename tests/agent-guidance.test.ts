import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { POST as createDraftRoute } from "@/app/api/agent/drafts/route";
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
