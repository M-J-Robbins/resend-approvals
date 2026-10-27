// @vitest-environment happy-dom
// The checks read the email through DOMParser, as the review UI does in the browser.
import { describe, expect, it } from "vitest";
import { GMAIL_CLIP_BYTES, NEAR_CLIP_BYTES, gmailClipStatus } from "@/lib/client/emailSize";
import { reviewHints } from "@/lib/client/hints";
import { blend, requiredRatio } from "@/lib/client/hints/a11y/contrast";
import { linkName } from "@/lib/client/hints/a11y/linkText";

const htmlOfBytes = (bytes: number) => "a".repeat(bytes);
// Only the size hint; these emails would get other hints too (their text isn't wrapped).
const sizeHint = (html: string) => reviewHints({ html, subject: "x" }).filter((h) => h.id === "size");

describe("Gmail clipping thresholds", () => {
  it("warns over 80 KB and errors from 102 KB, as the size chip does", () => {
    expect(gmailClipStatus(NEAR_CLIP_BYTES)).toBeNull();
    expect(gmailClipStatus(NEAR_CLIP_BYTES + 1)).toBe("near");
    expect(gmailClipStatus(GMAIL_CLIP_BYTES - 1)).toBe("near");
    expect(gmailClipStatus(GMAIL_CLIP_BYTES)).toBe("over");
  });

  it("measures UTF-8 bytes, not characters", () => {
    // 41,000 three-byte characters: 41,000 characters but 123,000 bytes.
    expect(sizeHint("€".repeat(41_000)).map((h) => h.severity)).toEqual(["error"]);
  });
});

describe("review hints: email size", () => {
  it("has no hint for a small email", () => {
    expect(sizeHint("<p>Hi</p>")).toEqual([]);
  });

  it("warns when close to the limit, with a note the agent can act on", () => {
    const [hint, ...rest] = sizeHint(htmlOfBytes(85 * 1024));
    expect(rest).toEqual([]);
    expect(hint).toMatchObject({ id: "size", severity: "warning", title: "Close to Gmail's 102 KB limit (85.0 KB)" });
    expect(hint.reviewNote).toContain("85.0 KB");
    expect(hint.reviewNote).toContain("Reduce the HTML size");
  });

  it("is an error at or over the limit", () => {
    const [hint] = sizeHint(htmlOfBytes(GMAIL_CLIP_BYTES));
    expect(hint).toMatchObject({ id: "size", severity: "error", title: "Over Gmail's 102 KB limit (102.0 KB)" });
  });
});

const wrapped = (attrs: string, body = "<p>Hello</p>") => `<html lang="en" dir="ltr"><body><div ${attrs}>${body}</div></body></html>`;
// The wrapper hints only; these sample emails would get other hints too (no <h1>, for example).
const ids = (html: string) =>
  reviewHints({ html, subject: "x" })
    .map((h) => h.id)
    .filter((id) => id.startsWith("a11y-wrapper"));
const hint = (html: string, id: string) => reviewHints({ html, subject: "x" }).find((h) => h.id === id);

describe("review hints: body content wrapped in dir and lang", () => {
  it("passes a wrapper with an explicit direction and a valid language", () => {
    expect(ids(wrapped('dir="ltr" lang="en"'))).toEqual([]);
    expect(ids(wrapped('dir="RTL" lang="ar-EG"'))).toEqual([]);
  });

  it("doesn't count lang and dir on <html> or <body>", () => {
    expect(ids('<html lang="en" dir="ltr"><body lang="en" dir="ltr"><p>Hi</p></body></html>')).toEqual([
      "a11y-wrapper-dir",
      "a11y-wrapper-lang",
    ]);
  });

  it("checks every direct child of <body>, and bare text counts as unwrapped", () => {
    const html = '<body><div dir="ltr" lang="en">ok</div><table><tr><td>x</td></tr></table>Loose text</body>';
    const dir = hint(html, "a11y-wrapper-dir");
    expect(dir).toMatchObject({ severity: "error", rating: "serious" });
    expect(dir?.detail).toContain("2 of 3 items directly inside <body>");
    expect(dir?.detail).toContain("<table> and text");
  });

  it("skips <script>, <style>, comments and decorative images", () => {
    const html = '<body><style>p{}</style><!-- note --><img src="spacer.gif" alt=""><div dir="ltr" lang="en">ok</div><script>x</script></body>';
    expect(ids(html)).toEqual([]);
  });

  it("still checks images with alt text, or no alt", () => {
    expect(ids('<body><img src="logo.png" alt="Acme"><div dir="ltr" lang="en">ok</div></body>')).toEqual([
      "a11y-wrapper-dir",
      "a11y-wrapper-lang",
    ]);
  });

  it('is a mild hint, not a serious one, for dir="auto" and lang="und"', () => {
    const html = wrapped('dir="auto" lang="und"');
    expect(ids(html)).toEqual(["a11y-wrapper-dir-auto", "a11y-wrapper-lang-und"]);
    expect(hint(html, "a11y-wrapper-dir-auto")).toMatchObject({ severity: "info", rating: "mild" });
    expect(hint(html, "a11y-wrapper-lang-und")).toMatchObject({ severity: "info", rating: "mild" });
  });

  it("treats other dir values as missing", () => {
    expect(ids(wrapped('dir="left" lang="en"'))).toEqual(["a11y-wrapper-dir"]);
  });

  it("needs a valid language tag, not just any lang", () => {
    for (const bad of ["english", "en_US", "zz", ""]) {
      const found = hint(wrapped(`dir="ltr" lang="${bad}"`), "a11y-wrapper-lang");
      expect(found, bad).toBeDefined();
    }
    expect(hint(wrapped('dir="ltr" lang="en_US"'), "a11y-wrapper-lang")?.detail).toContain('lang="en_US"');
    for (const good of ["en", "EN-us", "zh-Hans-CN", "haw"]) expect(ids(wrapped(`dir="ltr" lang="${good}"`)), good).toEqual([]);
  });

  it("lists serious hints before mild ones", () => {
    const html = '<body><div dir="auto" lang="und">a</div><p>b</p></body>';
    expect(ids(html)).toEqual(["a11y-wrapper-dir", "a11y-wrapper-lang", "a11y-wrapper-dir-auto", "a11y-wrapper-lang-und"]);
  });

  it("has nothing to say about an empty body", () => {
    expect(ids("<html><body>   </body></html>")).toEqual([]);
  });
});

describe("review hints: layout tables need role presentation or none", () => {
  const wrap = (tables: string) => `<html lang="en"><body><div dir="ltr" lang="en">${tables}</div></body></html>`;
  const tableHint = (tables: string) => hint(wrap(tables), "a11y-layout-tables");
  const grid = (attrs = "") => `<table ${attrs}><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>`;

  it("flags a layout table without a role", () => {
    const found = tableHint("<table><tr><td>Logo</td><td>Menu</td></tr></table>");
    expect(found).toMatchObject({ severity: "error", rating: "serious" });
    expect(found?.detail).toContain("1 of 1 layout table has no role");
  });

  it('passes layout tables with role="presentation" or "none", in lowercase only', () => {
    expect(tableHint('<table role="presentation"><tr><td>a</td></tr></table>')).toBeUndefined();
    expect(tableHint('<table role="none"><tr><td>a</td></tr></table>')).toBeUndefined();
    // ARIA role values are lowercase.
    expect(tableHint('<table role="NONE"><tr><td>a</td></tr></table>')).toBeDefined();
    expect(tableHint('<table role="Presentation"><tr><td>a</td></tr></table>')).toBeDefined();
  });

  it("treats a table as data if it has more than one row and more than one column", () => {
    expect(tableHint(grid())).toBeUndefined();
    // One row of several cells, or several rows of one cell: layout.
    expect(tableHint("<table><tr><td>a</td><td>b</td><td>c</td></tr></table>")).toBeDefined();
    expect(tableHint("<table><tr><td>a</td></tr><tr><td>b</td></tr></table>")).toBeDefined();
  });

  it('treats role="table", a scope attribute, <thead>, <tfoot> or <caption> as data', () => {
    expect(tableHint('<table><tr><th scope="col">Name</th></tr></table>')).toBeUndefined();
    expect(tableHint("<table><thead><tr><td>a</td></tr></thead></table>")).toBeUndefined();
    expect(tableHint("<table><tfoot><tr><td>a</td></tr></tfoot></table>")).toBeUndefined();
    expect(tableHint("<table><caption>Prices</caption><tr><td>a</td></tr></table>")).toBeUndefined();
    expect(tableHint('<table role="table"><tr><td>a</td></tr></table>')).toBeUndefined();
    expect(tableHint('<table role="Table"><tr><td>a</td></tr></table>')).toBeDefined();
    // A <th> alone doesn't make it data.
    expect(tableHint("<table><tr><th>a</th></tr></table>")).toBeDefined();
  });

  it("only counts a table's own rows and cells, never a nested table's", () => {
    // A one-cell layout table around a data grid: the outer one is layout.
    const found = tableHint(`<table><tr><td>${grid()}</td></tr></table>`);
    expect(found?.detail).toContain("1 of 1 layout table has no role");
    // A scope or <thead> inside a nested table doesn't make the outer one data.
    expect(tableHint(`<table><tr><td><table role="presentation"><tr><th scope="col">x</th></tr></table></td></tr></table>`)).toBeDefined();
    expect(tableHint(`<table role="presentation"><tr><td><table><thead><tr><td>x</td></tr></thead></table></td></tr></table>`)).toBeUndefined();
  });

  it("counts nested layout tables, and says how many are nested", () => {
    const found = tableHint(`<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>`);
    expect(found?.detail).toContain("2 of 2 layout tables have no role");
    expect(found?.detail).toContain("1 of them nested inside another table");
  });

  it("has no hint when every layout table has a role, or there are no tables", () => {
    expect(tableHint(`<table role="presentation"><tr><td><table role="none"><tr><td>x</td></tr></table></td></tr></table>`)).toBeUndefined();
    expect(tableHint("<p>No tables</p>")).toBeUndefined();
  });
});

describe("review hints: level-one heading", () => {
  const headingHint = (body: string) => hint(`<html lang="en"><body><div dir="ltr" lang="en">${body}</div></body></html>`, "a11y-level-one-heading");

  it("is a mild hint when there is no level-one heading", () => {
    expect(headingHint("<h2>Only a subheading</h2><p>Text</p>")).toMatchObject({ severity: "info", rating: "mild" });
  });

  it("passes an <h1>, or role=heading with aria-level=1", () => {
    expect(headingHint("<h1>Welcome</h1>")).toBeUndefined();
    expect(headingHint('<div role="heading" aria-level="1">Welcome</div>')).toBeUndefined();
    expect(headingHint('<span role="heading" aria-level=" 1 ">Welcome</span>')).toBeUndefined();
  });

  it("counts hidden headings", () => {
    expect(headingHint('<h1 style="display:none">Welcome</h1>')).toBeUndefined();
    expect(headingHint('<div hidden role="heading" aria-level="1">Welcome</div>')).toBeUndefined();
  });

  it("doesn't count headings that aren't announced as level one", () => {
    expect(headingHint('<div role="heading">Defaults to level 2</div>')).toBeDefined();
    expect(headingHint('<div role="heading" aria-level="2">Level 2</div>')).toBeDefined();
    expect(headingHint('<h1 aria-level="2">Announced as level 2</h1>')).toBeDefined();
    expect(headingHint('<h1 role="presentation">Not a heading</h1>')).toBeDefined();
    // Role values are lowercase only.
    expect(headingHint('<div role="Heading" aria-level="1">x</div>')).toBeDefined();
  });

  it('accepts an <h1> with an explicit role="heading" aria-level="1"', () => {
    expect(headingHint('<h1 role="heading" aria-level="1">Welcome</h1>')).toBeUndefined();
  });
});

describe("review hints: links have discernible text", () => {
  const linkHint = (body: string) => hint(`<html lang="en"><body><div dir="ltr" lang="en"><h1>Hi</h1>${body}</div></body></html>`, "a11y-link-name");
  const nameOf = (body: string) => {
    const doc = new DOMParser().parseFromString(`<body>${body}</body>`, "text/html");
    return linkName(doc.querySelector("a")!);
  };

  it("is a serious hint naming the links without text", () => {
    const found = linkHint('<a href="https://a.test/1"></a><a href="https://a.test/2">Shop</a><a href="https://a.test/3"><img src="x.png"></a>');
    expect(found).toMatchObject({ severity: "error", rating: "serious" });
    expect(found?.detail).toContain("2 of 3 links");
    expect(found?.reviewNote).toContain("https://a.test/1, https://a.test/3");
  });

  it("passes links with text, alt text, aria-label, aria-labelledby or title", () => {
    expect(linkHint('<a href="#">Shop</a>')).toBeUndefined();
    expect(linkHint('<a href="#"><img src="x.png" alt="Shop"></a>')).toBeUndefined();
    expect(linkHint('<a href="#" aria-label="Shop"><img src="x.png" alt=""></a>')).toBeUndefined();
    expect(linkHint('<span id="l" hidden>Shop</span><a href="#" aria-labelledby="l"></a>')).toBeUndefined();
    expect(linkHint('<a href="#" title="Shop"></a>')).toBeUndefined();
  });

  it("reads text and alt text in document order, as a screen reader does", () => {
    expect(nameOf('<a href="#">Read <img src="x" alt="our"> blog</a>')).toBe("Read our blog");
    expect(nameOf('<a href="#"><img alt="Logo"><span>Home</span><img alt="arrow"></a>')).toBe("Logo Home arrow");
    expect(nameOf('<a href="#"><div>Line one</div><div>line two</div></a>')).toBe("Line one line two");
    expect(nameOf('<a href="#">Sh<b>op</b></a>')).toBe("Shop");
  });

  it("uses a descendant's aria-label in place of its content", () => {
    expect(nameOf('<a href="#">Go <span aria-label="to the shop">→</span></a>')).toBe("Go to the shop");
  });

  it("doesn't count hidden text or the alt text of hidden images", () => {
    expect(linkHint('<a href="#"><span style="display: none">Shop</span></a>')).toBeDefined();
    expect(linkHint('<a href="#"><span aria-hidden="true">Shop</span></a>')).toBeDefined();
    expect(linkHint('<a href="#"><span hidden>Shop</span></a>')).toBeDefined();
    expect(linkHint('<a href="#"><img alt="Shop" style="DISPLAY:NONE"></a>')).toBeDefined();
    expect(linkHint('<a href="#"><span style="visibility:hidden"><img alt="Shop"></span></a>')).toBeDefined();
    expect(nameOf('<a href="#">Shop <span style="display:none">secret</span>now</a>')).toBe("Shop now");
  });

  it("counts visible text inside a visibility:hidden parent, and visually hidden text", () => {
    expect(nameOf('<a href="#"><span style="visibility:hidden"><b style="visibility:visible">Shop</b></span></a>')).toBe("Shop");
    expect(nameOf('<a href="#"><span style="font-size:0;opacity:0">Shop</span></a>')).toBe("Shop");
  });

  it("treats whitespace and invisible padding characters as no text", () => {
    expect(linkHint('<a href="#">&nbsp; &#8203;&#847;</a>')).toBeDefined();
  });

  it("skips links nobody can reach, and anchors without href", () => {
    expect(linkHint('<div style="display:none"><a href="#"></a></div>')).toBeUndefined();
    expect(linkHint('<a name="top"></a>')).toBeUndefined();
  });
});

describe("review hints: <html> has a lang attribute", () => {
  const langIds = (html: string) =>
    reviewHints({ html, subject: "x" })
      .map((h) => h.id)
      .filter((id) => id.startsWith("a11y-html-lang"));
  const page = (htmlAttrs: string) => `<html ${htmlAttrs}><body><div dir="ltr" lang="en"><h1>Hi</h1></div></body></html>`;

  it("passes a valid language tag, in any case", () => {
    expect(langIds(page('lang="en"'))).toEqual([]);
    expect(langIds(page('lang=" EN-gb "'))).toEqual([]);
  });

  it("is a serious hint when lang is missing, empty or not a valid tag", () => {
    expect(langIds(page(""))).toEqual(["a11y-html-lang"]);
    expect(langIds(page('lang=""'))).toEqual(["a11y-html-lang"]);
    expect(langIds('<div dir="ltr" lang="en"><h1>No html tag</h1></div>')).toEqual(["a11y-html-lang"]);
    const invalid = hint(page('lang="english"'), "a11y-html-lang");
    expect(invalid).toMatchObject({ severity: "error", rating: "serious" });
    expect(invalid?.detail).toContain('lang="english"');
  });

  it("doesn't count lang on <body> or the wrapper", () => {
    expect(langIds('<html><body lang="en"><div dir="ltr" lang="en"><h1>Hi</h1></div></body></html>')).toEqual(["a11y-html-lang"]);
  });

  it('is a mild hint for lang="und"', () => {
    expect(langIds(page('lang="UND"'))).toEqual(["a11y-html-lang-und"]);
    expect(hint(page('lang="und"'), "a11y-html-lang-und")).toMatchObject({ severity: "info", rating: "mild" });
  });
});

describe("review hints: images have alt text", () => {
  const altHint = (body: string) => hint(`<html lang="en"><body><div dir="ltr" lang="en"><h1>Hi</h1>${body}</div></body></html>`, "a11y-image-alt");

  it("passes images with alt text, and decorative images with an empty alt", () => {
    expect(altHint('<img src="a.png" alt="Logo"><img src="b.png" alt=""><img src="c.png" alt>')).toBeUndefined();
  });

  it("is a critical hint listing the images without an alt attribute", () => {
    const found = altHint('<img src="a.png"><img src="b.png" alt="B"><img src="c.png" ALT><img src="d.png" title="D">');
    expect(found).toMatchObject({ severity: "error", rating: "critical" });
    expect(found?.detail).toContain("2 of 4 images");
    expect(found?.reviewNote).toContain("a.png, d.png");
  });

  it("shortens long sources and counts the rest", () => {
    const found = altHint(`<img src="data:image/png;base64,${"A".repeat(200)}"><img src="2"><img src="3"><img src="4">`);
    expect(found?.detail).toContain(`data:image/png;base64,${"A".repeat(35)}…, 2, 3 and 1 more`);
  });
});

describe("review hints: document has a <title>", () => {
  const titleHint = (head: string, body = "") =>
    hint(`<html lang="en"><head>${head}</head><body><div dir="ltr" lang="en"><h1>Hi</h1>${body}</div></body></html>`, "a11y-document-title");

  it("passes a <title> in <head> with text", () => {
    expect(titleHint("<title>Your order</title>")).toBeUndefined();
    expect(titleHint("<meta charset='utf-8'><title> x </title>")).toBeUndefined();
  });

  it("is a serious hint when there is no <title>", () => {
    expect(titleHint("")).toMatchObject({ severity: "error", rating: "serious" });
    expect(titleHint("")?.detail).toContain("no <title>");
  });

  it("doesn't count an empty or whitespace-only <title>", () => {
    expect(titleHint("<title></title>")?.detail).toContain("is empty");
    expect(titleHint("<title> &nbsp;\n </title>")?.detail).toContain("is empty");
  });

  it("doesn't count a <title> in <body>", () => {
    expect(titleHint("", "<title>In the body</title>")).toBeDefined();
  });
});

describe("review hints: link text is descriptive", () => {
  const purposeHint = (body: string, id: string) =>
    hint(`<html lang="en"><head><title>T</title></head><body><div dir="ltr" lang="en"><h1>Hi</h1>${body}</div></body></html>`, id);
  const generic = (body: string) => purposeHint(body, "a11y-link-text-generic");
  const repeated = (body: string) => purposeHint(body, "a11y-link-text-repeated");

  it("flags common generic phrases, ignoring case, punctuation and arrows", () => {
    const found = generic('<a href="/a">Click here</a><a href="/b">READ MORE ›</a><a href="/c">Learn more…</a><a href="/d">Click here</a>');
    expect(found).toMatchObject({ severity: "warning", rating: "moderate" });
    expect(found?.detail).toContain("4 links say nothing");
    expect(found?.detail).toContain('"Click here" ×2, "READ MORE ›", "Learn more…"');
  });

  it("flags names that are only symbols or a single character", () => {
    expect(generic('<a href="/a">→</a>')?.detail).toContain('"→"');
    expect(generic('<a href="/a">»</a><a href="/b">1</a>')?.detail).toContain("2 links");
  });

  it("only matches the whole name, so descriptive text containing a phrase passes", () => {
    expect(generic('<a href="/a">Read more about pricing</a><a href="/b">Click here to reset your password</a>')).toBeUndefined();
  });

  it("uses the accessible name, so an aria-label or alt text counts", () => {
    expect(generic('<a href="/a" aria-label="Read more about pricing">Read more</a>')).toBeUndefined();
    expect(generic('<a href="/a"><img src="x" alt="here"></a>')).toBeDefined();
  });

  it("leaves links without a name to the discernible-text hint", () => {
    expect(generic('<a href="/a"></a>')).toBeUndefined();
  });

  it("flags the same text going to different places", () => {
    const found = repeated('<a href="/1">View product</a><a href="/2">view product!</a><a href="/3">Shop</a>');
    expect(found).toMatchObject({ severity: "warning", rating: "moderate" });
    expect(found?.detail).toContain('"View product" ×2');
  });

  it("passes the same text going to the same place, and leaves generic names to the other hint", () => {
    expect(repeated('<a href="/1">Shop</a><a href="/1">Shop</a>')).toBeUndefined();
    expect(repeated('<a href="/1">Read more</a><a href="/2">Read more</a>')).toBeUndefined();
  });
});

// The contrast check itself reads a rendered document (computed styles and
// layout), which happy-dom doesn't provide; it was verified in Chrome. These
// cover its maths.
describe("review hints: colour contrast maths", () => {
  it("uses 3:1 for large text (24px, or 18.66px and bold) and 4.5:1 otherwise", () => {
    expect(requiredRatio(24, 400)).toBe(3);
    expect(requiredRatio(23.9, 400)).toBe(4.5);
    expect(requiredRatio(18.67, 700)).toBe(3);
    expect(requiredRatio(18.67, 600)).toBe(4.5);
    expect(requiredRatio(18.6, 700)).toBe(4.5);
  });

  it("blends a translucent colour over the one below it", () => {
    expect(blend([0, 0, 0, 0.5], [1, 1, 1])).toEqual([0.5, 0.5, 0.5]);
    expect(blend([1, 0, 0, 1], [0, 0, 1])).toEqual([1, 0, 0]);
  });
});
