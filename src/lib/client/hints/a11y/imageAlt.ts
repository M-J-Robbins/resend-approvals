import { examples } from "../examples";
import { severityFor, type Hint, type HintInput } from "../types";

/**
 * Rule 8 of the Email Markup Consortium's 2026 accessibility report: "Images
 * must have alternate text" (Critical). Every <img> needs an alt attribute;
 * alt="" passes, because it marks a decorative image that screen readers
 * should skip. Without alt, many screen readers read out the file name or URL.
 */
export function imageAltHints({ doc }: HintInput): Hint[] {
  const images = [...doc.querySelectorAll("img")];
  const missing = images.filter((img) => !img.hasAttribute("alt"));
  if (missing.length === 0) return [];
  const list = examples(missing.map((img) => img.getAttribute("src")?.trim() || "(no src)"));
  return [
    {
      id: "a11y-image-alt",
      severity: severityFor("critical"),
      rating: "critical",
      title: "Images must have alternate text",
      detail:
        `${missing.length} of ${images.length} ${images.length === 1 ? "image has" : "images have"} no alt attribute: ${list}. ` +
        'Screen readers may read out the file name instead. Decorative images should have alt="".',
      reviewNote: `Add an alt attribute to every image: text describing it, or alt="" if it is decorative: ${list}.`,
    },
  ];
}
