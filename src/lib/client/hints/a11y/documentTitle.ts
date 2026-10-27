import { severityFor, type Hint, type HintInput } from "../types";

/**
 * Rule 9 of the Email Markup Consortium's 2026 accessibility report:
 * "Documents must have a <title> element" (Serious). Some email clients show
 * it, and screen readers announce it when the email opens in a browser.
 *
 * The first <title> inside <head> must have text; whitespace alone (including
 * no-break spaces) doesn't count. A <title> in <body> doesn't count either.
 */
export function documentTitleHints({ doc }: HintInput): Hint[] {
  const title = doc.head?.querySelector("title");
  if (title?.textContent?.replace(/\s+/g, "")) return [];
  return [
    {
      id: "a11y-document-title",
      severity: severityFor("serious"),
      rating: "serious",
      title: "Documents must have a <title> element",
      detail: title
        ? "The <title> in <head> is empty. Give it text that says what the email is, usually the subject."
        : "There is no <title> in <head>. Add one that says what the email is, usually the subject.",
      reviewNote: "Add a <title> inside <head> with text, for example the email's subject.",
    },
  ];
}
