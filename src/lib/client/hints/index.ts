import { documentTitleHints } from "./a11y/documentTitle";
import { headingHints } from "./a11y/heading";
import { htmlLangHints } from "./a11y/htmlLang";
import { imageAltHints } from "./a11y/imageAlt";
import { layoutTableHints } from "./a11y/layoutTables";
import { linkPurposeHints } from "./a11y/linkPurpose";
import { linkTextHints } from "./a11y/linkText";
import { wrapperDirHints, wrapperLangHints } from "./a11y/wrappers";
import { sizeHints } from "./size";
import type { Hint, HintInput } from "./types";

export { contrastHints } from "./a11y/contrast";
export type { Hint, HintInput, HintRating, HintSeverity } from "./types";

/** Every check, in the order their hints are listed. Add new checks here. */
const CHECKS: ((input: HintInput) => Hint[])[] = [
  sizeHints,
  wrapperDirHints,
  wrapperLangHints,
  layoutTableHints,
  headingHints,
  linkTextHints,
  htmlLangHints,
  imageAltHints,
  documentTitleHints,
  linkPurposeHints,
];

const ORDER = { error: 0, warning: 1, info: 2 } as const;

/** Errors first, then warnings, then info; the sort is stable, so each keeps its check order. */
export const sortHints = (hints: Hint[]) => [...hints].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

/**
 * The hints that need only the HTML. Contrast needs the email rendered, so it
 * comes separately from contrastHints, run on the hidden analysis frame.
 */
export function reviewHints({ html, subject }: { html: string; subject: string }): Hint[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return sortHints(CHECKS.flatMap((check) => check({ html, subject, doc })));
}
