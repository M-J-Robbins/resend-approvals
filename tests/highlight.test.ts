import { describe, expect, it } from "vitest";
import { highlightHtml, type Token } from "@/lib/client/highlightHtml";

const join = (tokens: Token[]) => tokens.map((t) => t.text).join("");
const typed = (tokens: Token[], type: Token["type"]) => tokens.filter((t) => t.type === type).map((t) => t.text);

describe("highlightHtml", () => {
  it("labels tags, attributes, values, comments, doctype and entities", () => {
    const tokens = highlightHtml(
      '<!DOCTYPE html><!-- note --><p class="lede" data-x=1 hidden>Hi &amp; bye&#8199;</p>',
    );
    expect(typed(tokens, "doctype")).toEqual(["<!DOCTYPE html>"]);
    expect(typed(tokens, "comment")).toEqual(["<!-- note -->"]);
    expect(typed(tokens, "tag")).toEqual(["p", "p"]);
    expect(typed(tokens, "attribute")).toEqual(["class", "data-x", "hidden"]);
    expect(typed(tokens, "value")).toEqual(['"lede"', "1"]);
    expect(typed(tokens, "entity")).toEqual(["&amp;", "&#8199;"]);
  });

  it("treats script and style content as text", () => {
    const tokens = highlightHtml("<style>a<b{}</style><script>if (a < b) {}</script>");
    expect(typed(tokens, "tag")).toEqual(["style", "style", "script", "script"]);
    expect(typed(tokens, "text")).toEqual(["a<b{}", "if (a < b) {}"]);
  });

  it("gives back the input exactly, even when the HTML is broken", () => {
    const inputs = [
      "",
      "plain text",
      "a < b and c > d",
      '<p class="unterminated>text',
      "<!-- never closed",
      "<div <span>>x</div>",
      "<img src=x onerror='alert(1)'/>",
      "<P CLASS=Upper>Mixed</P>",
      "</>&;<",
    ];
    for (const html of inputs) expect(join(highlightHtml(html))).toBe(html);
  });
});
