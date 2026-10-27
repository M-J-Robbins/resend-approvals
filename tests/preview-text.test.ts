// @vitest-environment happy-dom
// previewText reads the email through DOMParser, as the review UI does in the browser.
import { describe, expect, it } from "vitest";
import { PREVIEW_TEXT_LENGTH, previewText } from "@/lib/client/previewText";

const text = (html: string) => previewText(html).text;

describe("preview text", () => {
  it("reads the body's text in document order, with blocks separated", () => {
    expect(text("<p>Hi</p><p>there</p>")).toBe("Hi there");
    expect(text("<div>Sh<b>op</b> now</div>")).toBe("Shop now");
    expect(text("<table><tr><td>One</td><td>Two</td></tr></table>")).toBe("One Two");
  });

  it("includes image alt text where the image is", () => {
    expect(text('<p>Before <img src="x.png" alt="Logo"> after</p>')).toBe("Before Logo after");
    expect(text('<img src="x.png" alt=""><p>Text</p>')).toBe("Text");
  });

  it("includes hidden preheaders, which inboxes show", () => {
    expect(text('<div style="display:none">Sale ends Friday</div><h1>Hello</h1>')).toBe("Sale ends Friday Hello");
  });

  it("skips the head, styles and scripts", () => {
    expect(text("<html><head><title>T</title><style>p{}</style></head><body><script>x()</script><p>Hi</p></body></html>")).toBe("Hi");
  });

  it("keeps preheader padding characters, and collapses only HTML whitespace", () => {
    const padding = " ͏ ".repeat(3);
    expect(text(`<div>Short preheader${"&#8199;&#847; ".repeat(3)}</div><p>Body</p>`)).toBe(`Short preheader${padding}Body`);
    expect(text("<p>a&nbsp;&nbsp;b \n\t c</p>")).toBe("a  b c");
  });

  it("stops at 150 characters and says when there is more", () => {
    const long = previewText(`<p>${"a".repeat(PREVIEW_TEXT_LENGTH + 10)}</p>`);
    expect(Array.from(long.text)).toHaveLength(PREVIEW_TEXT_LENGTH);
    expect(long.truncated).toBe(true);
    expect(previewText(`<p>${"a".repeat(PREVIEW_TEXT_LENGTH)}</p>`).truncated).toBe(false);
  });

  it("counts by character, so an emoji is never cut in half", () => {
    const { text: cut } = previewText(`<p>${"a".repeat(PREVIEW_TEXT_LENGTH - 1)}😀😀</p>`);
    expect(cut.endsWith("a😀")).toBe(true);
  });
});
