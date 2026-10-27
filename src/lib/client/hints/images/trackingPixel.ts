/**
 * Tracking pixels are left out of every image check (and never get a HEAD
 * request, which would count as another "open"). An image is a tracking pixel
 * if any of these is 1×1 or smaller: its width and height attributes, its
 * inline style's width and height, or, once rendered, the size it's shown at
 * or its file. URL patterns aren't used. The alt text rule still applies to them.
 */
const atMostOne = (width: number, height: number) => width <= 1 && height <= 1;

/** A number from an attribute or a px length; NaN if absent or not a plain number. */
const pixels = (value: string | null | undefined) => (value && /^\s*\d+(\.\d+)?\s*(px)?\s*$/i.test(value) ? Number.parseFloat(value) : Number.NaN);

/** From the markup alone, so it works on the parsed HTML as well as the rendered email. */
export function isTrackingPixelMarkup(img: HTMLImageElement): boolean {
  return (
    atMostOne(pixels(img.getAttribute("width")), pixels(img.getAttribute("height"))) ||
    atMostOne(pixels(img.style.width), pixels(img.style.height))
  );
}

/** With the rendered sizes too: `display` is null when the image isn't shown. */
export function isTrackingPixel(img: HTMLImageElement, display: { width: number; height: number } | null): boolean {
  if (isTrackingPixelMarkup(img)) return true;
  if (display && atMostOne(display.width, display.height)) return true;
  return img.naturalWidth > 0 && atMostOne(img.naturalWidth, img.naturalHeight);
}
