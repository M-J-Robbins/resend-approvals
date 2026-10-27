import { examples } from "../examples";
import { severityFor, type Hint, type HintInput } from "../types";
import { linkName, reachableLinks } from "./linkText";

/**
 * Rule 10 of the Email Markup Consortium's 2026 accessibility report: "Link
 * text should be descriptive" (Moderate). Screen reader users often list a
 * message's links on their own, out of context, so each link's text should say
 * where it goes. Judging that needs a person (or a model), so these are
 * pattern checks, advice only. WCAG level A lets the surrounding sentence
 * explain a link, which is another reason they're Moderate.
 *
 * Two hints, both on the name rule 5 computes (so an aria-label counts):
 *  - Generic: the whole name, ignoring case, punctuation and symbols, is a
 *    common phrase such as "click here" or "read more", or is at most one
 *    letter or digit ("›", "→", "1"). Partial matches don't count: "Read more
 *    about pricing" is fine. The list is English only.
 *  - Repeated: the same name goes to different places ("View" to three
 *    different products). Names already reported as generic are left out.
 * Links without a name are rule 5's, and aren't checked here.
 */
const GENERIC = new Set([
  "click",
  "click here",
  "click this",
  "click this link",
  "continue",
  "details",
  "find out more",
  "go",
  "go here",
  "here",
  "info",
  "learn more",
  "link",
  "more",
  "more info",
  "more information",
  "more details",
  "read more",
  "see more",
  "tap here",
  "this",
  "this link",
  "this page",
  "view more",
  "website",
]);

/** Lowercase letters and digits only, words separated by single spaces. */
const normalise = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export const isGenericLinkName = (name: string) => {
  const words = normalise(name);
  return words.length <= 1 || GENERIC.has(words);
};

const quoted = (name: string, count: number) => `"${name}"${count > 1 ? ` ×${count}` : ""}`;

export function linkPurposeHints({ doc }: HintInput): Hint[] {
  const named = reachableLinks(doc)
    .map((a) => ({ name: linkName(a), href: a.getAttribute("href")?.trim() ?? "" }))
    .filter((link) => link.name);
  const hints: Hint[] = [];

  // Grouped by the name as written, so the hint shows what the reader sees.
  const generic = new Map<string, number>();
  for (const { name } of named) if (isGenericLinkName(name)) generic.set(name, (generic.get(name) ?? 0) + 1);
  if (generic.size > 0) {
    const total = [...generic.values()].reduce((a, b) => a + b, 0);
    const list = examples([...generic].map(([name, count]) => quoted(name, count)));
    hints.push({
      id: "a11y-link-text-generic",
      severity: severityFor("moderate"),
      rating: "moderate",
      title: "Link text should be descriptive",
      detail: `${total} ${total === 1 ? "link says" : "links say"} nothing about where ${total === 1 ? "it goes" : "they go"}: ${list}. Screen reader users often hear links out of context, as a list.`,
      reviewNote: `Replace generic link text with text that says where the link goes (for example "Read the pricing guide" rather than "Read more"): ${list}.`,
    });
  }

  // Grouped by the normalised name, so "Read more" and "read more ›" are the same text.
  const destinations = new Map<string, { name: string; hrefs: Set<string>; count: number }>();
  for (const { name, href } of named) {
    if (isGenericLinkName(name)) continue;
    const key = normalise(name);
    const entry = destinations.get(key) ?? { name, hrefs: new Set(), count: 0 };
    entry.hrefs.add(href);
    entry.count++;
    destinations.set(key, entry);
  }
  const repeated = [...destinations.values()].filter((d) => d.hrefs.size > 1);
  if (repeated.length > 0) {
    const list = examples(repeated.map((d) => quoted(d.name, d.count)));
    hints.push({
      id: "a11y-link-text-repeated",
      severity: severityFor("moderate"),
      rating: "moderate",
      title: "Links with the same text should go to the same place",
      detail: `The same link text goes to different places: ${list}. Out of context, a screen reader user can't tell these links apart.`,
      reviewNote: `Make the text of each of these links say where it goes, so links with the same text don't lead to different places: ${list}.`,
    });
  }

  return hints;
}
