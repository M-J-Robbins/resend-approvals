import { describe, expect, it } from "vitest";
import { parseSender } from "@/lib/env";

describe("parseSender", () => {
  it("splits a friendly name from the address", () => {
    expect(parseSender("Agent Drafts <onboarding@resend.dev>")).toEqual({
      name: "Agent Drafts",
      address: "onboarding@resend.dev",
    });
  });

  it("drops quotes around the name", () => {
    expect(parseSender('"Acme, Inc." <hello@acme.test>')).toEqual({ name: "Acme, Inc.", address: "hello@acme.test" });
  });

  it("has no name for a bare address or an empty name", () => {
    expect(parseSender("onboarding@resend.dev")).toEqual({ name: null, address: "onboarding@resend.dev" });
    expect(parseSender("<onboarding@resend.dev>")).toEqual({ name: null, address: "onboarding@resend.dev" });
  });
});
