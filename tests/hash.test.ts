import { describe, expect, it } from "vitest";
import { chunkCountFor, chunkIdempotencyKey, chunkRange, chunkSizeFor, MAX_CHUNK_SIZE } from "@/lib/chunks";
import {
  canonicalRecipients,
  computeContentHash,
  normalizeContent,
  type EmailContent,
} from "@/lib/hash";

const base: EmailContent = {
  recipients: ["a@example.com", "b@example.com", "c@example.com"],
  subject: "Hello",
  html: "<p>Hi</p>",
};

describe("content hash", () => {
  it("is stable for identical content", () => {
    expect(computeContentHash(base)).toBe(computeContentHash({ ...base, recipients: [...base.recipients] }));
    expect(computeContentHash(base)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is identical for the same recipient set in any order, case or with duplicates", () => {
    const variants = [
      ["c@example.com", "a@example.com", "b@example.com"],
      ["B@Example.COM", "a@example.com", "C@EXAMPLE.com"],
      ["a@example.com", " b@example.com ", "c@example.com", "A@example.com", "b@example.com"],
    ];
    for (const recipients of variants) {
      expect(computeContentHash({ ...base, recipients })).toBe(computeContentHash(base));
    }
  });

  it.each([
    ["an address changes", { recipients: ["a@example.com", "b@example.com", "d@example.com"] }],
    ["an address is added", { recipients: [...base.recipients, "d@example.com"] }],
    ["an address is removed", { recipients: ["a@example.com", "b@example.com"] }],
    ["the subject changes", { subject: "Hello!" }],
    ["the html changes", { html: "<p>Hi!</p>" }],
  ])("changes when %s", (_what, change) => {
    expect(computeContentHash({ ...base, ...change })).not.toBe(computeContentHash(base));
  });

  it("does not confuse list boundaries", () => {
    const one = { ...base, recipients: ["a@example.com,b@example.com"] };
    const two = { ...base, recipients: ["a@example.com", "b@example.com"] };
    expect(computeContentHash(one)).not.toBe(computeContentHash(two));
  });
});

describe("canonical recipients", () => {
  it("trims, lowercases, de-duplicates and sorts, counting what was removed", () => {
    expect(canonicalRecipients([" B@example.com ", "a@example.com", "b@EXAMPLE.com", "A@example.com"])).toEqual({
      recipients: ["a@example.com", "b@example.com"],
      duplicatesRemoved: 2,
    });
  });

  it("sorts by code unit, independent of locale", () => {
    const { recipients } = canonicalRecipients(["z@x.io", "a.b@x.io", "a_b@x.io", "a-b@x.io", "ab@x.io"]);
    expect(recipients).toEqual(["a-b@x.io", "a.b@x.io", "a_b@x.io", "ab@x.io", "z@x.io"]);
  });

  it("normalizeContent trims the subject and leaves html untouched", () => {
    const n = normalizeContent({ ...base, subject: "  Hello  ", html: "  <p>x</p>\n" });
    expect(n.subject).toBe("Hello");
    expect(n.html).toBe("  <p>x</p>\n");
  });
});

describe("chunk boundaries", () => {
  it("are a pure function of the revision", () => {
    const content = { subject: "Hello", html: "<p>" + "x".repeat(200_000) + "</p>" };
    const sizes = Array.from({ length: 5 }, () => chunkSizeFor({ ...content }));
    expect(new Set(sizes).size).toBe(1);
  });

  it("use full batches for normal emails and shrink for large html, never below 1", () => {
    expect(chunkSizeFor({ subject: "Hi", html: "<p>Hi</p>" })).toBe(MAX_CHUNK_SIZE);
    const big = chunkSizeFor({ subject: "Hi", html: "x".repeat(1_000_000) });
    expect(big).toBeGreaterThanOrEqual(1);
    expect(big).toBeLessThan(MAX_CHUNK_SIZE);
    // Characters that JSON escapes count at their escaped size.
    expect(chunkSizeFor({ subject: "Hi", html: "\u0001".repeat(1_000_000) })).toBeLessThan(big);
    expect(chunkSizeFor({ subject: "Hi", html: "\u0001".repeat(20_000_000) })).toBe(1);
  });

  it.each([
    [1, 100],
    [250, 100],
    [5000, 100],
    [4812, 37],
  ])("cover %i recipients exactly once in chunks of %i", (count, size) => {
    const chunks = chunkCountFor(count, size);
    const seen: number[] = [];
    for (let i = 0; i < chunks; i++) {
      const { start, end } = chunkRange(i, size, count);
      expect(end - start).toBeGreaterThan(0);
      expect(end - start).toBeLessThanOrEqual(size);
      for (let j = start; j < end; j++) seen.push(j);
    }
    expect(seen).toEqual(Array.from({ length: count }, (_, i) => i));
    // Same answer every time it is asked.
    expect(chunkRange(chunks - 1, size, count)).toEqual(chunkRange(chunks - 1, size, count));
  });

  it("names a key per chunk and generation, within Resend's 256-character limit", () => {
    const key = chunkIdempotencyKey(`rev_${"0".repeat(32)}`, 4999, 12);
    expect(key).toBe(`rev_${"0".repeat(32)}:c4999:g12`);
    expect(key.length).toBeLessThanOrEqual(256);
  });
});
