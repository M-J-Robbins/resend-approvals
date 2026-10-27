import { severityFor, type Hint, type HintInput } from "../types";

/**
 * Rule 4 of the Email Markup Consortium's 2026 accessibility report: "Page
 * should contain a level-one heading" (Mild; short emails may not need one).
 *
 * A level-one heading is an <h1>, or any element with role="heading" and
 * aria-level="1". Hidden content counts too (screen readers can reach some of
 * it). Following how screen readers read them:
 *  - an <h1> whose role is something other than "heading" isn't a heading,
 *  - an <h1> with an aria-level other than 1 is announced at that level,
 *  - role="heading" without aria-level is level 2.
 * Role values are lowercase only, as in the other checks.
 */
function isLevelOneHeading(el: Element): boolean {
  const role = el.getAttribute("role")?.trim().split(/\s+/)[0];
  const level = el.getAttribute("aria-level")?.trim();
  if (el.tagName.toLowerCase() === "h1") return (!role || role === "heading") && (level === undefined || level === "1");
  return role === "heading" && level === "1";
}

export function headingHints({ doc }: HintInput): Hint[] {
  const candidates = doc.querySelectorAll('h1, [role~="heading"]');
  if ([...candidates].some(isLevelOneHeading)) return [];
  return [
    {
      id: "a11y-level-one-heading",
      severity: severityFor("mild"),
      rating: "mild",
      title: "Page should contain a level-one heading",
      detail:
        "There is no <h1>. A level-one heading lets screen reader users jump to the start of the content; short emails may not need one.",
      reviewNote:
        "Add a level-one heading (an <h1>, styled however the design needs) that introduces the email, so screen reader users can find the start of the content.",
    },
  ];
}
