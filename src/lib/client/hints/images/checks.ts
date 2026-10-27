import { formatKilobytes } from "../../emailSize";
import { examples, shorten } from "../examples";
import type { Hint } from "../types";

/**
 * Image weight and dimension hints. They need the email rendered (for each
 * image's file and displayed size) and each image's byte size, read with a
 * HEAD request where the image's server allows it (see measure.ts).
 *
 * The limits are deliberately strict, and are a first guess: with more time
 * they need more research, and could be set by the user.
 */
export const TOTAL_LIMIT_BYTES = 1.5 * 1024 * 1024;
export const IMAGE_LIMIT_BYTES = 100 * 1024;
/** Bytes per pixel of the file (bytes ÷ (width × height)). */
export const BYTES_PER_PIXEL_LIMIT = { jpeg: 0.15, png: 0.3, gif: 1, other: 0.1 } as const;
/** Oversized: the file is more than this many times the size it's shown at (2× covers retina screens). */
export const OVERSIZED_RATIO = 2;

export type ImageFormat = keyof typeof BYTES_PER_PIXEL_LIMIT | "svg";

/** One <img> as rendered in the analysis frame. Tracking pixels are already left out. */
export interface ImageFacts {
  /** The URL loaded (srcset and <picture> resolved). */
  url: string;
  /** The file's size in pixels; 0 if it didn't load. */
  natural: { width: number; height: number };
  /** The size it's shown at in CSS pixels, or null if it isn't shown. */
  display: { width: number; height: number } | null;
  /** It was requested and nothing usable came back (a 404, a dead server, not an image). */
  failed: boolean;
}

/** What a HEAD request found out, or null if it couldn't be read. */
export type ImageSize = { bytes: number; format: ImageFormat } | null;

const LABEL: Record<ImageFormat, string> = { jpeg: "JPEG", png: "PNG", gif: "GIF", svg: "SVG", other: "image" };

/** The format from a Content-Type, else from the URL's extension. */
export function imageFormat(contentType: string | null, url: string): ImageFormat {
  const type = contentType?.split(";")[0].trim().toLowerCase() ?? "";
  const extension = /\.([a-z0-9]+)$/i.exec(safePath(url))?.[1].toLowerCase() ?? "";
  if (type === "image/jpeg" || (!type.startsWith("image/") && (extension === "jpg" || extension === "jpeg"))) return "jpeg";
  if (type === "image/png" || (!type.startsWith("image/") && extension === "png")) return "png";
  if (type === "image/gif" || (!type.startsWith("image/") && extension === "gif")) return "gif";
  if (type === "image/svg+xml" || (!type.startsWith("image/") && extension === "svg")) return "svg";
  return "other";
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

const formatMegabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? formatMegabytes(bytes) : formatKilobytes(bytes));

/**
 * The URL without its scheme; if long, the host and file name with "…" between,
 * since those identify an image ("upload.example.org/…/hero.jpg").
 */
export function imageName(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return shorten(url);
  }
  const full = `${parsed.host}${parsed.pathname}${parsed.search}`;
  if (full.length <= 60) return full;
  const file = parsed.pathname.split("/").filter(Boolean).at(-1) ?? "";
  return shorten(`${parsed.host}/…/${file}`);
}
const name = imageName;
const dimensions = ({ width, height }: { width: number; height: number }) => `${Math.round(width)}×${Math.round(height)}`;

export function imageHints(images: ImageFacts[], sizes: Map<string, ImageSize>): Hint[] {
  const hints: Hint[] = [];
  const urls = [...new Set(images.map((i) => i.url))];
  const measured = urls.flatMap((url) => {
    const size = sizes.get(url);
    return size ? [{ url, ...size }] : [];
  });
  // An image that didn't load has its own hint; its size doesn't matter.
  const failedUrls = new Set(images.filter((i) => i.failed).map((i) => i.url));
  const unmeasured = urls.filter((url) => !sizes.get(url) && !failedUrls.has(url));

  // Total: each file once, however many times it's used (it downloads once).
  const total = measured.reduce((sum, i) => sum + i.bytes, 0);
  if (total > TOTAL_LIMIT_BYTES) {
    const atLeast = unmeasured.length > 0 ? "at least " : "";
    hints.push({
      id: "images-total",
      severity: "warning",
      title: `Images total ${atLeast}${formatMegabytes(total)}`,
      detail:
        `The email's images add up to ${atLeast}${formatMegabytes(total)}, over the ${formatMegabytes(TOTAL_LIMIT_BYTES)} limit` +
        `${unmeasured.length > 0 ? ` (${unmeasured.length} more couldn't be measured)` : ""}. Heavy emails load slowly, especially on mobile data.`,
      reviewNote: `Reduce the total size of the images (now ${atLeast}${formatMegabytes(total)}) to under ${formatMegabytes(TOTAL_LIMIT_BYTES)}: compress them, resize them to the size they're shown at, or use fewer.`,
    });
  }

  const large = measured.filter((i) => i.bytes > IMAGE_LIMIT_BYTES).sort((a, b) => b.bytes - a.bytes);
  if (large.length > 0) {
    const list = examples(large.map((i) => `${name(i.url)} (${formatSize(i.bytes)})`), Infinity);
    hints.push({
      id: "images-large",
      severity: "warning",
      title: `${large.length === 1 ? "An image is" : `${large.length} images are`} over ${formatKilobytes(IMAGE_LIMIT_BYTES)}`,
      detail: `${list}. Large images load slowly, especially on mobile data.`,
      reviewNote: `Compress or resize these images to under ${formatKilobytes(IMAGE_LIMIT_BYTES)} each: ${list}.`,
    });
  }

  // Bytes per pixel, per format. SVG is vector, and an image that didn't load has no pixel count.
  const naturalOf = new Map(images.filter((i) => i.natural.width > 0).map((i) => [i.url, i.natural]));
  const heavy = measured.flatMap((i) => {
    const natural = naturalOf.get(i.url);
    if (i.format === "svg" || !natural) return [];
    const perPixel = i.bytes / (natural.width * natural.height);
    const limit = BYTES_PER_PIXEL_LIMIT[i.format];
    return perPixel > limit ? [{ ...i, perPixel, limit }] : [];
  });
  if (heavy.length > 0) {
    const list = examples(
      heavy.map((i) => `${name(i.url)} (${LABEL[i.format]}, ${i.perPixel.toFixed(2)} bytes per pixel, limit ${i.limit})`),
      Infinity,
    );
    hints.push({
      id: "images-bytes-per-pixel",
      severity: "warning",
      title: `${heavy.length === 1 ? "An image is" : `${heavy.length} images are`} poorly compressed for ${heavy.length === 1 ? "its" : "their"} size`,
      detail: `${list}. A high number of bytes per pixel usually means the image could be compressed further, or saved in a better format.`,
      reviewNote: `Compress these images further, or save them in a more efficient format: ${list}.`,
    });
  }

  // Dimensions: only shown images that loaded. Each file and displayed size once.
  const shown = new Map<string, ImageFacts & { display: { width: number; height: number } }>();
  for (const i of images) {
    if (!i.display || i.natural.width === 0 || i.display.width === 0 || i.display.height === 0) continue;
    if ((sizes.get(i.url)?.format ?? imageFormat(null, i.url)) === "svg") continue;
    shown.set(`${i.url} ${dimensions(i.display)}`, { ...i, display: i.display });
  }
  const widthRatio = (i: ImageFacts & { display: { width: number } }) => i.natural.width / i.display.width;
  const heightRatio = (i: ImageFacts & { display: { height: number } }) => i.natural.height / i.display.height;

  const oversized = [...shown.values()].filter((i) => widthRatio(i) > OVERSIZED_RATIO && heightRatio(i) > OVERSIZED_RATIO);
  if (oversized.length > 0) {
    const list = examples(
      oversized.map((i) => `${name(i.url)} (${dimensions(i.natural)}, shown at ${dimensions(i.display)}, ${widthRatio(i).toFixed(1)}×)`),
      Infinity,
    );
    hints.push({
      id: "images-oversized",
      severity: "warning",
      title: `${oversized.length === 1 ? "An image is" : `${oversized.length} images are`} much larger than shown`,
      detail: `${list}. Files more than ${OVERSIZED_RATIO}× the size they're shown at (enough for retina screens) download pixels nobody sees.`,
      reviewNote: `Resize these images to at most ${OVERSIZED_RATIO}× the size they're shown at: ${list}.`,
    });
  }

  // Upscaled: allow half a pixel for rounding of the displayed size.
  const upscaled = [...shown.values()].filter(
    (i) => i.natural.width + 0.5 < i.display.width || i.natural.height + 0.5 < i.display.height,
  );
  if (upscaled.length > 0) {
    const list = examples(upscaled.map((i) => `${name(i.url)} (${dimensions(i.natural)}, shown at ${dimensions(i.display)})`), Infinity);
    hints.push({
      id: "images-upscaled",
      severity: "warning",
      title: `${upscaled.length === 1 ? "An image is" : `${upscaled.length} images are`} shown larger than ${upscaled.length === 1 ? "its" : "their"} file`,
      detail: `${list}. Stretched images look blurry; on retina screens they need to be 2× the size they're shown at to look sharp.`,
      reviewNote: `Use larger image files (ideally 2× the size they're shown at) so these don't look blurry: ${list}.`,
    });
  }

  // https only: http: images are already warned about from the HTML, and may be blocked here as mixed content.
  const failed = [...new Set(images.filter((i) => i.failed && i.url.startsWith("https:")).map((i) => i.url))];
  if (failed.length > 0) {
    const list = examples(failed.map(name), Infinity);
    hints.push({
      id: "images-failed",
      severity: "warning",
      title: `${failed.length === 1 ? "An image" : `${failed.length} images`} didn't load`,
      detail: `${list}. The request failed or didn't return an image: a wrong URL, an expired link, or a server that is down (which may be temporary).`,
      reviewNote: `These images didn't load; check their URLs: ${list}.`,
    });
  }

  if (unmeasured.length > 0) {
    hints.push({
      id: "images-sizes-unavailable",
      severity: "info",
      title: "Image sizes not available",
      detail:
        `The file size of ${unmeasured.length === 1 ? "1 image" : `${unmeasured.length} images`} couldn't be read: ${examples(unmeasured.map(name), Infinity)}. ` +
        (unmeasured.length === 1
          ? "Its server doesn't let the browser check, so it isn't included in the size checks. Its dimensions are still checked."
          : "Their servers don't let the browser check, so they aren't included in the size checks. Their dimensions are still checked."),
    });
  }

  return hints;
}
