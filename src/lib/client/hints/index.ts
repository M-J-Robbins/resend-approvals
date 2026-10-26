import { headingHints } from "./a11y/heading";
import { layoutTableHints } from "./a11y/layoutTables";
import { wrapperDirHints, wrapperLangHints } from "./a11y/wrappers";
import { sizeHints } from "./size";
import type { Hint, HintInput } from "./types";

export type { Hint, HintInput, HintRating, HintSeverity } from "./types";

/** Every check, in the order their hints are listed. Add new checks here. */
const CHECKS: ((input: HintInput) => Hint[])[] = [
  sizeHints,
  wrapperDirHints,
  wrapperLangHints,
  layoutTableHints,
  headingHints,
];

const ORDER = { error: 0, warning: 1, info: 2 } as const;

/** All hints for a revision: errors first, then warnings, then info, each in check order. */
export function reviewHints({ html, subject }: { html: string; subject: string }): Hint[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return CHECKS.flatMap((check) => check({ html, subject, doc })).sort(
    (a, b) => ORDER[a.severity] - ORDER[b.severity],
  );
}
