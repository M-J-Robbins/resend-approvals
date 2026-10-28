import { describe, expect, it } from "vitest";
import { MAX_REASON_LENGTH } from "@/lib/reviewLimits";
import { rejectBody } from "@/lib/validation";

const reject = (reason: string) => rejectBody.safeParse({ revision_id: "rev_1", reason }).success;

describe("reject reason length", () => {
  it("accepts review notes built from many hints (well over the old 1,000)", () => {
    // Eleven hints added to the review came to about 1,500 characters.
    expect(reject("- note\n".repeat(250))).toBe(true);
    expect(reject("a".repeat(MAX_REASON_LENGTH))).toBe(true);
  });

  it("refuses anything longer than the limit, and an empty reason", () => {
    expect(reject("a".repeat(MAX_REASON_LENGTH + 1))).toBe(false);
    expect(reject("   ")).toBe(false);
  });
});
