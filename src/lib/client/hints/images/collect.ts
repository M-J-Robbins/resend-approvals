import type { ImageFacts } from "./checks";

/**
 * Reads every <img> in the rendered email (the analysis frame's document):
 * the URL that loaded, its file size in pixels and the size it's shown at.
 *
 * Tracking pixels are left out of every image check, and never get a HEAD
 * request (which would count as another "open"). An image is a tracking pixel
 * if any of these is 1×1 or smaller: its width and height attributes, its
 * inline style's width and height, the size it's shown at, or its file. URL
 * patterns aren't used. The alt text rule still applies to them.
 *
 * Only http(s) images on another server are measured: data: and cid: images,
 * and relative URLs (which the preview resolves against this site), are skipped.
 */
export function collectImages(doc: Document): ImageFacts[] {
  const view = doc.defaultView;
  if (!view) return [];
  const images: ImageFacts[] = [];
  for (const img of doc.querySelectorAll("img")) {
    const url = img.currentSrc || img.src;
    if (!isRemote(url)) continue;
    const display = shownSize(img, view);
    if (isTrackingPixel(img, display)) continue;
    images.push({ url, natural: { width: img.naturalWidth, height: img.naturalHeight }, display });
  }
  return images;
}

function isRemote(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.origin !== window.location.origin;
  } catch {
    return false;
  }
}

/** The size it's shown at, or null if it has no box or is invisible. */
function shownSize(img: HTMLImageElement, view: Window): ImageFacts["display"] {
  if (img.getClientRects().length === 0) return null;
  const style = view.getComputedStyle(img);
  if (style.visibility === "hidden" || style.visibility === "collapse") return null;
  const rect = img.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

const atMostOne = (width: number, height: number) => width <= 1 && height <= 1;

/** A number from an attribute or a px length; NaN if absent or not a plain number. */
const pixels = (value: string | null | undefined) => (value && /^\s*\d+(\.\d+)?\s*(px)?\s*$/i.test(value) ? Number.parseFloat(value) : Number.NaN);

function isTrackingPixel(img: HTMLImageElement, display: ImageFacts["display"]): boolean {
  if (atMostOne(pixels(img.getAttribute("width")), pixels(img.getAttribute("height")))) return true;
  if (atMostOne(pixels(img.style.width), pixels(img.style.height))) return true;
  if (display && atMostOne(display.width, display.height)) return true;
  return img.naturalWidth > 0 && atMostOne(img.naturalWidth, img.naturalHeight);
}
