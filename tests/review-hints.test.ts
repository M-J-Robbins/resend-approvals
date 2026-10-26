// @vitest-environment happy-dom
// The checks read the email through DOMParser, as the review UI does in the browser.
import { describe, expect, it } from "vitest";
import { GMAIL_CLIP_BYTES, NEAR_CLIP_BYTES, gmailClipStatus } from "@/lib/client/emailSize";
import { reviewHints } from "@/lib/client/hints";

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
