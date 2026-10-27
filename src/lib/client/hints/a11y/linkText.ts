import { examples } from "../examples";
import { severityFor, type Hint, type HintInput } from "../types";

/**
 * Rule 5 of the Email Markup Consortium's 2026 accessibility report: "Links
 * must have discernible text" (Serious). A link with no name is announced as
 * just "link", or as its URL.
 *
 * A link's name is what a screen reader announces, taken from the first of
 * these that isn't empty:
 *  1. aria-labelledby: the text of the elements it points to, in that order
 *  2. aria-label
 *  3. its content: text and the alt text of images, in document order, as a
 *     screen reader reads them (so "Read <img alt="our"> blog" is "Read our
 *     blog", never "Read blog our"). A descendant with its own aria-label
 *     contributes that label instead of its content.
 *  4. title
 *
 * Hidden content doesn't count, and neither does the alt text of a hidden
 * image. Hidden here means what can be seen without rendering: the hidden
 * attribute, aria-hidden="true", or an inline display:none or
 * visibility:hidden. Content hidden by a <style> rule isn't detected.
 * Visually hidden text (font-size:0, opacity:0, max-height:0 and the like) is
 * still read by screen readers, so it counts. Links that are hidden themselves
 * aren't checked: nobody can reach them.
 *
 * The name is shared with the "descriptive link text" check, which reads it.
 */
const SKIPPED = new Set(["script", "style", "template"]);
/** Elements that start a new line, so their text is separated from the text around it. */
const BLOCKS = new Set(["address", "blockquote", "br", "center", "div", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "ol", "p", "table", "tbody", "td", "th", "thead", "tfoot", "tr", "ul"]);

/** The first declaration of `property` in the inline style, lowercased. */
function inlineStyle(el: Element, property: string): string | undefined {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;!]+)`, "i").exec(el.getAttribute("style") ?? "");
  return match?.[1].trim().toLowerCase();
}

/** Hidden from screen readers along with all its content. */
function hidesSubtree(el: Element): boolean {
  return el.hasAttribute("hidden") || el.getAttribute("aria-hidden")?.trim() === "true" || inlineStyle(el, "display") === "none";
}

/** visibility is inherited, and a descendant can set it back to visible. */
function visibilityOf(el: Element, inherited: boolean): boolean {
  const value = inlineStyle(el, "visibility");
  if (value === "hidden" || value === "collapse") return false;
  if (value === "visible") return true;
  return inherited;
}

/** Whether a screen reader can reach the element at all. */
function isHidden(el: Element): boolean {
  let visible: boolean | undefined;
  for (let current: Element | null = el; current; current = current.parentElement) {
    if (hidesSubtree(current)) return true;
    // The nearest element that sets visibility decides it.
    const value = inlineStyle(current, "visibility");
    if (visible === undefined && value) visible = value === "visible";
  }
  return visible === false;
}

/** The text a screen reader reads for the element's content, in document order. */
function contentText(el: Element, visible: boolean): string {
  let text = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (visible) text += node.textContent ?? "";
      continue;
    }
    if (!(node instanceof Element)) continue;
    const tag = node.tagName.toLowerCase();
    if (SKIPPED.has(tag) || hidesSubtree(node)) continue;
    const nodeVisible = visibilityOf(node, visible);
    const label = node.getAttribute("aria-label")?.trim();
    let part: string;
    if (label) part = nodeVisible ? ` ${label} ` : "";
    else if (tag === "img") part = nodeVisible ? ` ${node.getAttribute("alt") ?? ""} ` : "";
    else part = contentText(node, nodeVisible);
    text += BLOCKS.has(tag) ? ` ${part} ` : part;
  }
  return text;
}

/**
 * Whitespace, including no-break and other Unicode spaces, collapsed to one
 * space and trimmed. Invisible characters that preheader padding uses (zero
 * width spaces and joiners, the combining grapheme joiner) are dropped, so a
 * name made only of them is empty.
 */
function clean(text: string): string {
  return text
    .replace(/[​-‍⁠﻿͏­]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The accessible name of a link, as a screen reader would announce it; "" if it has none. */
export function linkName(link: Element): string {
  const doc = link.ownerDocument;
  const labelledBy = (link.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .flatMap((id) => (id && doc.getElementById(id)) || []);
  // An element pointed to by aria-labelledby is read even if it is hidden itself.
  const fromLabelledBy = clean(labelledBy.map((el) => el.getAttribute("aria-label")?.trim() || contentText(el, true)).join(" "));
  if (fromLabelledBy) return fromLabelledBy;
  const fromLabel = clean(link.getAttribute("aria-label") ?? "");
  if (fromLabel) return fromLabel;
  const fromContent = clean(contentText(link, !isHidden(link)));
  if (fromContent) return fromContent;
  return clean(link.getAttribute("title") ?? "");
}

/** The links a screen reader user can reach: every <a href> that isn't hidden. */
export function reachableLinks(doc: Document): Element[] {
  return [...doc.querySelectorAll("a[href]")].filter((a) => !isHidden(a));
}

export function linkTextHints({ doc }: HintInput): Hint[] {
  const links = reachableLinks(doc);
  const unnamed = links.filter((a) => !linkName(a));
  if (unnamed.length === 0) return [];
  const list = examples(unnamed.map((a) => a.getAttribute("href")?.trim() || "(empty href)"));
  return [
    {
      id: "a11y-link-name",
      severity: severityFor("serious"),
      rating: "serious",
      title: "Links must have discernible text",
      detail:
        `${unnamed.length} of ${links.length} ${links.length === 1 ? "link has" : "links have"} no text a screen reader can announce: ${list}. ` +
        "A link's text comes from aria-labelledby, aria-label, its visible text and the alt text of images inside it, or its title.",
      reviewNote: `Give every link text a screen reader can announce (visible text, or alt text on a linked image): ${list}.`,
    },
  ];
}
