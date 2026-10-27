import { severityFor, type Hint, type HintInput } from "../types";
import { isValidLangTag } from "./langTag";

/**
 * Rule 6 of the Email Markup Consortium's 2026 accessibility report: "<html>
 * element must have a lang attribute" (Serious). It must also be a valid
 * language tag, checked as for the body wrappers. lang="und" (undetermined)
 * passes the rule but gets a Mild hint, as on the wrappers.
 *
 * An email with no <html> tag fails too: the parser adds an <html> without lang.
 */
export function htmlLangHints({ doc }: HintInput): Hint[] {
  const lang = doc.documentElement.getAttribute("lang")?.trim() ?? "";
  if (lang.toLowerCase() === "und") {
    return [
      {
        id: "a11y-html-lang-und",
        severity: severityFor("mild"),
        rating: "mild",
        title: "Explicitly defining a language is preferred",
        detail: 'The <html> element has lang="und" (undetermined). Setting the actual language is preferred when it is known.',
        reviewNote: 'Replace lang="und" on <html> with the email\'s actual language, for example <html lang="en">.',
      },
    ];
  }
  if (isValidLangTag(lang)) return [];
  return [
    {
      id: "a11y-html-lang",
      severity: severityFor("serious"),
      rating: "serious",
      title: "<html> element must have a lang attribute",
      detail:
        (lang ? `The <html> element has lang="${lang}", which isn't a valid language tag.` : "The <html> element has no lang attribute.") +
        " Screen readers use it to pick the voice and pronunciation.",
      reviewNote: 'Add a valid lang attribute to the <html> element with the email\'s language, for example <html lang="en">.',
    },
  ];
}
