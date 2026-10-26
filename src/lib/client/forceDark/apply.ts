import { DARK_SURFACE, forceDarkColor, formatColor, parseColor, type Rgb } from "./color";

/** What Android uses when a page sets no background, and for all text on html/body. */
const DEFAULT_BACKGROUND = `rgb(${Math.round(DARK_SURFACE * 255)}, ${Math.round(DARK_SURFACE * 255)}, ${Math.round(DARK_SURFACE * 255)})`;
const DEFAULT_TEXT = "rgb(255, 255, 255)";

/**
 * Applies Android's forced dark mode to a rendered email document, by setting
 * !important inline colours on every element. Our page runs this on the
 * preview's document (sandboxed with allow-same-origin and without
 * allow-scripts, so the email itself never runs code).
 *
 * The pass is deliberately live and in document order, as on Android: each
 * element reads its computed colours after its ancestors were changed, so a
 * child sees its parent's new background, and a colour it inherits has
 * already been through the transform once. That knock-on effect is part of
 * the output, so don't batch the reads and writes.
 *
 * The document can't be restored afterwards; reload it to go back.
 */
export function applyForceDark(doc: Document): void {
  const view = doc.defaultView;
  if (!view) return;
  const computed = (el: Element) => view.getComputedStyle(el);

  for (const el of doc.querySelectorAll<HTMLElement>("*")) {
    const style = computed(el);
    const behind = nearestBackground(el, computed);
    const changes: [string, string][] = [];

    const text = parseColor(style.color);
    if (text && text[3] > 0) changes.push(["color", formatColor(forceDarkColor(text, "foreground", behind))]);

    const background = parseColor(style.backgroundColor);
    if (background && background[3] > 0) {
      changes.push(["background-color", formatColor(forceDarkColor(background, "background", behind))]);
    }

    const border = parseColor(style.borderColor);
    if (border && border[3] > 0) changes.push(["border-color", formatColor(forceDarkColor(border, "border", behind))]);

    for (const [property, value] of changes) el.style.setProperty(property, value, "important");
  }

  // The page itself: body's background, or else html's, goes through the
  // background rule once more (after the pass above); with neither, #121212.
  // Text on both is set to white.
  const { body, documentElement: html } = doc;
  const opaque = (css: string) => {
    const c = parseColor(css);
    return c && c[3] > 0 ? c : null;
  };
  const page = (body ? opaque(computed(body).backgroundColor) : null) ?? opaque(computed(html).backgroundColor);
  const pageBackground = page ? formatColor(forceDarkColor(page, "background", null)) : DEFAULT_BACKGROUND;
  for (const el of [body, html]) {
    el?.style.setProperty("background-color", pageBackground, "important");
    el?.style.setProperty("color", DEFAULT_TEXT, "important");
  }
}

/** The first background more than half opaque, from the element up through its ancestors, as it is right now. */
function nearestBackground(el: Element, computed: (el: Element) => CSSStyleDeclaration): Rgb | null {
  for (let current: Element | null = el; current; current = current.parentElement) {
    const c = parseColor(computed(current).backgroundColor);
    if (c && c[3] > 0.5) return [c[0], c[1], c[2]];
  }
  return null;
}
