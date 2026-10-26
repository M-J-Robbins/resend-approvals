/** How much text inboxes typically show after the subject. */
export const PREVIEW_TEXT_LENGTH = 150;

// Elements that start a new line when rendered, so their text doesn't run into
// the next element's ("<p>Hi</p><p>there</p>" reads "Hi there", not "Hithere").
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "br", "center", "dd", "div", "dl", "dt",
  "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
  "li", "main", "nav", "ol", "p", "pre", "section", "table", "td", "th", "tr", "ul",
]);

// Never shown as text, even though they can sit in the body.
const SKIP = new Set(["script", "style", "template", "noscript", "title", "head"]);

// Only HTML's own whitespace collapses, as in a browser. Everything else is
// kept, including the figure space (&#8199;) and combining grapheme joiner
// (&#847;) that current preheaders repeat as padding to fill the inbox
// snippet (older ones used &nbsp; and &zwnj;). The reviewer should see that.
const COLLAPSIBLE = /[ \t\n\r\f]+/g;
const EDGES = /^[ \t\n\r\f]+|[ \t\n\r\f]+$/g;

/**
 * The text an inbox shows after the subject: the first 150 characters of the
 * body's text, in document order, including image alt text and any hidden
 * preheader, with its padding characters (&#8199;&#847; and so on) kept.
 * `truncated` is true when the body has more text than that.
 *
 * DOMParser builds an inert document: scripts don't run and images don't load,
 * so agent HTML is only read as data here, and the result is shown as text.
 */
export function previewText(html: string): { text: string; truncated: boolean } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const parts: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();
    if (SKIP.has(tag)) return;
    if (tag === "img") {
      const alt = node.getAttribute("alt")?.trim();
      if (alt) parts.push(` ${alt} `);
      return;
    }
    const block = BLOCK.has(tag);
    if (block) parts.push(" ");
    node.childNodes.forEach(walk);
    if (block) parts.push(" ");
  };
  walk(doc.body);

  const all = parts.join("").replace(COLLAPSIBLE, " ").replace(EDGES, "");
  // Array.from splits by code point, so an emoji is never cut in half.
  const chars = Array.from(all);
  return {
    text: chars.slice(0, PREVIEW_TEXT_LENGTH).join("").replace(EDGES, ""),
    truncated: chars.length > PREVIEW_TEXT_LENGTH,
  };
}
