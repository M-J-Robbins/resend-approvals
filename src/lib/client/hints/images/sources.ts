import { examples } from "../examples";
import type { Hint, HintInput } from "../types";
import { isTrackingPixelMarkup } from "./trackingPixel";

/**
 * Image sources that work in the preview but won't for recipients, judged
 * from the HTML alone (the analysis frame reports images that fail to load):
 *  - Broken for everyone (error): a relative path (the preview resolves it
 *    against this site; an inbox has no site to resolve it against), cid:
 *    (an attachment, which isn't sent), file: (the sender's own disk), or no
 *    src at all.
 *  - May not load (warning): http: (some clients block or warn about it) and
 *    protocol-relative "//" URLs (which depend on the client).
 * Every <img> src and srcset is read, and <picture> <source> srcsets. data:
 * images are left alone, and so are tracking pixels.
 */
type Problem = "relative" | "cid" | "file" | "missing" | "http" | "protocol-relative";

const BROKEN: Problem[] = ["relative", "cid", "file", "missing"];
const REASON: Record<Problem, string> = {
  relative: "relative path",
  cid: "cid: attachment",
  file: "file: path",
  missing: "no src",
  http: "http:",
  "protocol-relative": "no protocol",
};

export function sourceProblem(url: string | null): Problem | null {
  const value = url?.trim() ?? "";
  if (value === "") return "missing";
  if (value.startsWith("//")) return "protocol-relative";
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1].toLowerCase();
  if (!scheme) return "relative";
  if (scheme === "cid") return "cid";
  if (scheme === "file") return "file";
  if (scheme === "http") return "http";
  return null;
}

/** The URLs in a srcset ("a.jpg 1x, b.jpg 2x"). Commas inside URLs are rare in email, so a plain split. */
const srcsetUrls = (srcset: string) =>
  srcset
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);

export function imageSourceHints({ doc }: HintInput): Hint[] {
  const found: { url: string; problem: Problem }[] = [];
  const add = (url: string | null) => {
    const problem = sourceProblem(url);
    if (problem) found.push({ url: url?.trim() || "(empty)", problem });
  };
  for (const img of doc.querySelectorAll("img")) {
    if (isTrackingPixelMarkup(img)) continue;
    // In document order: a <picture>'s sources come before its <img>.
    const picture = img.parentElement?.tagName.toLowerCase() === "picture" ? img.parentElement : null;
    for (const source of picture?.querySelectorAll(":scope > source[srcset]") ?? []) {
      srcsetUrls(source.getAttribute("srcset") ?? "").forEach(add);
    }
    const srcset = img.getAttribute("srcset");
    // An image with only a srcset is fine; its src is the fallback.
    if (img.hasAttribute("src") || !srcset) add(img.getAttribute("src"));
    if (srcset) srcsetUrls(srcset).forEach(add);
  }

  const describe = (items: typeof found) => {
    const unique = [...new Map(items.map((i) => [i.url, i])).values()];
    return { count: unique.length, list: examples(unique.map((i) => `${i.url} (${REASON[i.problem]})`), Infinity) };
  };
  const hints: Hint[] = [];
  const broken = describe(found.filter((i) => BROKEN.includes(i.problem)));
  if (broken.count > 0) {
    hints.push({
      id: "images-broken-source",
      severity: "error",
      title: `${broken.count === 1 ? "An image" : `${broken.count} images`} won't load for recipients`,
      detail: `${broken.list}. These sources can only work in the preview, if at all: once sent, there is no site, attachment or disk to load them from.`,
      reviewNote: `Use full https:// URLs for these images, hosted somewhere public: ${broken.list}.`,
    });
  }
  const insecure = describe(found.filter((i) => !BROKEN.includes(i.problem)));
  if (insecure.count > 0) {
    hints.push({
      id: "images-insecure-source",
      severity: "warning",
      title: `${insecure.count === 1 ? "An image" : `${insecure.count} images`} may not load in every email client`,
      detail: `${insecure.list}. Some email clients block or warn about images that aren't loaded over https://.`,
      reviewNote: `Load these images over https://: ${insecure.list}.`,
    });
  }
  return hints;
}
