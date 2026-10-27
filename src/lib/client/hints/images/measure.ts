import { imageFormat, type ImageSize } from "./checks";

const TIMEOUT_MS = 5000;
const CONCURRENCY = 6;

/**
 * Each image's byte size and format, from a HEAD request made by the
 * reviewer's browser. It only works when the image's server allows other sites
 * to read it (CORS) and sends Content-Length; otherwise the size is null and
 * the review shows "Image sizes not available". Measuring on our server would
 * always work, but fetching agent-supplied URLs there needs protection against
 * server-side request forgery, which was left out (see the README).
 */
export async function measureImages(urls: string[]): Promise<Map<string, ImageSize>> {
  const unique = [...new Set(urls)];
  const sizes = new Map<string, ImageSize>();
  let next = 0;
  async function worker() {
    while (next < unique.length) {
      const url = unique[next++];
      sizes.set(url, await measure(url));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));
  return sizes;
}

async function measure(url: string): Promise<ImageSize> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const length = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (!response.ok || !Number.isFinite(length)) return null;
    return { bytes: length, format: imageFormat(response.headers.get("content-type"), url) };
  } catch {
    // Blocked by CORS, mixed content, a network error or the timeout.
    return null;
  }
}
