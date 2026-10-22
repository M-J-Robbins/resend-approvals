import { describe, expect, it } from "vitest";
import { computeContentHash, normalizeContent, type EmailContent } from "@/lib/hash";

const base: EmailContent = {
  to: ["a@example.com"],
  cc: [],
  bcc: [],
  subject: "Hello",
  html: "<p>Hi</p>",
};

describe("content hash", () => {
  it("is stable for identical content", () => {
    expect(computeContentHash(base)).toBe(computeContentHash({ ...base, to: [...base.to] }));
    expect(computeContentHash(base)).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["to", { to: ["b@example.com"] }],
    ["cc", { cc: ["b@example.com"] }],
    ["bcc", { bcc: ["b@example.com"] }],
    ["subject", { subject: "Hello!" }],
    ["html", { html: "<p>Hi!</p>" }],
  ])("changes when %s changes", (_field, change) => {
    expect(computeContentHash({ ...base, ...change })).not.toBe(computeContentHash(base));
  });

  it("does not confuse a recipient moved between fields", () => {
    const inTo = { ...base, to: ["a@example.com"], cc: [] };
    const inCc = { ...base, to: [], cc: ["a@example.com"] };
    expect(computeContentHash(inTo)).not.toBe(computeContentHash(inCc));
  });
});

describe("normalizeContent", () => {
  it("trims and de-duplicates recipients case-insensitively, keeping the first spelling", () => {
    const n = normalizeContent({
      ...base,
      to: [" A@example.com ", "a@example.com", "b@example.com"],
      subject: "  Hello  ",
    });
    expect(n.to).toEqual(["A@example.com", "b@example.com"]);
    expect(n.subject).toBe("Hello");
  });

  it("leaves html untouched", () => {
    expect(normalizeContent({ ...base, html: "  <p>x</p>\n" }).html).toBe("  <p>x</p>\n");
  });
});
