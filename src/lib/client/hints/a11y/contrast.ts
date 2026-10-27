import { contrastRatio, parseColor, type Rgb, type Rgba } from "../../forceDark/color";
import { examples } from "../examples";
import { severityFor, type Hint } from "../types";

/**
 * Rule 7 of the Email Markup Consortium's 2026 accessibility report:
 * "Elements must meet minimum color contrast ratio thresholds" (Serious).
 *
 * Unlike the other checks this needs the email rendered: it reads computed
 * styles from a hidden analysis frame (see HintAnalysisFrame), in light mode
 * only for now. Dark mode and forced dark could be checked the same way later.
 *
 * Every element that directly holds visible text is checked:
 *  - Skipped as not visible: no layout box, visibility:hidden, font-size 0, or
 *    opacity 0 on it or an ancestor. aria-hidden text is still checked: it is
 *    still seen.
 *  - Text colour: the computed color, with its alpha and the opacity of its
 *    ancestors applied.
 *  - Background: the background colours of the element and its ancestors,
 *    blended until an opaque one, over the white page. A background-image on
 *    the way (a picture or gradient) means the real background can't be known,
 *    so that text is counted as not checked, as axe does. So is a colour the
 *    parser doesn't read (such as oklch()).
 *  - Threshold: 4.5:1, or 3:1 for large text (24px, or 18.66px (14pt) and bold).
 */
const NORMAL_RATIO = 4.5;
const LARGE_RATIO = 3;
const LARGE_PX = 24;
const LARGE_BOLD_PX = (14 * 4) / 3;
const PAGE: Rgb = [1, 1, 1];
const SAMPLE_LENGTH = 30;

export const requiredRatio = (fontSizePx: number, fontWeight: number) =>
  fontSizePx >= LARGE_PX || (fontWeight >= 700 && fontSizePx >= LARGE_BOLD_PX) ? LARGE_RATIO : NORMAL_RATIO;

/** `top` drawn over the opaque `bottom`. */
export const blend = ([r, g, b, a]: Rgba, bottom: Rgb): Rgb => [
  r * a + bottom[0] * (1 - a),
  g * a + bottom[1] * (1 - a),
  b * a + bottom[2] * (1 - a),
];

const hex = (rgb: Rgb) => `#${rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;

type Result = { kind: "pass" } | { kind: "fail"; ratio: number; required: number; fg: Rgb; bg: Rgb } | { kind: "unknown" };

/** The opaque colour behind `el`, or null if a background image or unreadable colour hides it. */
function backgroundBehind(el: Element, style: (el: Element) => CSSStyleDeclaration): Rgb | null {
  const layers: Rgba[] = [];
  for (let current: Element | null = el; current; current = current.parentElement) {
    const s = style(current);
    if (s.backgroundImage && s.backgroundImage !== "none") return null;
    const color = parseColor(s.backgroundColor);
    if (!color) return null;
    if (color[3] > 0) layers.push(color);
    if (color[3] >= 1) break;
  }
  // Paint from the outermost layer in.
  return layers.reduceRight<Rgb>((below, layer) => blend(layer, below), PAGE);
}

function checkElement(el: Element, style: (el: Element) => CSSStyleDeclaration): Result | null {
  const s = style(el);
  if (s.visibility === "hidden" || s.visibility === "collapse" || Number.parseFloat(s.fontSize) === 0) return null;
  if (el.getClientRects().length === 0) return null;
  let opacity = 1;
  for (let current: Element | null = el; current; current = current.parentElement) {
    opacity *= Number.parseFloat(style(current).opacity) || 0;
  }
  if (opacity === 0) return null;

  const color = parseColor(s.color);
  const bg = backgroundBehind(el, style);
  if (!color || !bg) return { kind: "unknown" };
  const fg = blend([color[0], color[1], color[2], color[3] * opacity], bg);
  const ratio = contrastRatio(fg, bg);
  const required = requiredRatio(Number.parseFloat(s.fontSize), Number.parseInt(s.fontWeight, 10) || 400);
  return ratio < required ? { kind: "fail", ratio, required, fg, bg } : { kind: "pass" };
}

/** The elements that directly hold non-whitespace text, in document order. */
function textElements(doc: Document): Element[] {
  const elements = new Set<Element>();
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !node.textContent?.trim()) continue;
    const tag = parent.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "title") continue;
    elements.add(parent);
  }
  return [...elements];
}

/** The element's own text, shortened, for the hint. */
function sample(el: Element): string {
  const own = [...el.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return own.length > SAMPLE_LENGTH ? `${own.slice(0, SAMPLE_LENGTH - 1)}…` : own;
}

/** Contrast hints for a rendered email document (the analysis frame's, read with allow-same-origin). */
export function contrastHints(doc: Document): Hint[] {
  const view = doc.defaultView;
  if (!view) return [];
  const style = (el: Element) => view.getComputedStyle(el);

  const failing: string[] = [];
  let checked = 0;
  let unknown = 0;
  for (const el of textElements(doc)) {
    const result = checkElement(el, style);
    if (!result) continue;
    if (result.kind === "unknown") {
      unknown++;
      continue;
    }
    checked++;
    if (result.kind === "fail") {
      // Rounded down, so a failing ratio never shows as the threshold (4.49 stays 4.49, not 4.5).
      const ratio = Math.floor(result.ratio * 100) / 100;
      failing.push(`"${sample(el)}" ${ratio}:1, needs ${result.required}:1 (${hex(result.fg)} on ${hex(result.bg)})`);
    }
  }

  const unknownNote =
    unknown > 0
      ? ` ${unknown} more ${unknown === 1 ? "piece" : "pieces"} of text couldn't be checked (over a background image, or in a colour format that isn't read).`
      : "";
  const hints: Hint[] = [];
  if (failing.length > 0) {
    // Kept whole: each sample is already short, and the ratio and colours must show.
    const list = examples(failing, Infinity);
    hints.push({
      id: "a11y-contrast",
      severity: severityFor("serious"),
      rating: "serious",
      title: "Elements must meet minimum color contrast ratio thresholds",
      detail:
        `${failing.length} of ${checked} pieces of text have too little contrast with their background in light mode: ${list}. ` +
        `Text needs 4.5:1, or 3:1 when large (24px, or 18.66px and bold).${unknownNote}`,
      reviewNote: `Raise the contrast between text and its background to at least 4.5:1 (3:1 for large text): ${list}.`,
    });
  } else if (unknown > 0) {
    hints.push({
      id: "a11y-contrast-unknown",
      severity: "info",
      title: "Some text contrast couldn't be checked",
      detail: `${unknown} ${unknown === 1 ? "piece" : "pieces"} of text couldn't be checked for contrast: ${unknown === 1 ? "it is" : "they are"} over a background image, or in a colour format that isn't read. Check ${unknown === 1 ? "it" : "them"} by eye in the preview.`,
      reviewNote:
        "Make sure text over background images or gradients has at least 4.5:1 contrast (3:1 for large text), for example with a solid background colour behind it.",
    });
  }
  return hints;
}
