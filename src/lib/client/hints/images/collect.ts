import type { ImageFacts } from "./checks";
import { isTrackingPixel } from "./trackingPixel";

/**
 * Reads every <img> in the rendered email (the analysis frame's document):
 * the URL that loaded, its file size in pixels and the size it's shown at.
 *
 * Tracking pixels are left out (see trackingPixel.ts).
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
    images.push({ url, natural: { width: img.naturalWidth, height: img.naturalHeight }, display, failed: didNotLoad(img) });
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

/**
 * Requested, finished, and no pixels. Lazy images may never be requested in
 * the off-screen frame, so they don't count. SVGs without a size of their own
 * can report 0×0 even when they loaded, so they don't count either.
 */
function didNotLoad(img: HTMLImageElement): boolean {
  if (img.loading === "lazy" || !img.complete || img.naturalWidth > 0) return false;
  return !/\.svg(\?|#|$)/i.test(img.currentSrc || img.src);
}
