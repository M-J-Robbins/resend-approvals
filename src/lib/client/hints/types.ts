export type HintSeverity = "error" | "warning" | "info";

/**
 * Impact ratings from the Email Markup Consortium's accessibility report,
 * which follows Deque axe's levels (the report calls axe's "minor" "mild").
 */
export type HintRating = "critical" | "serious" | "moderate" | "mild";

/** One thing the reviewer may want to check before deciding. Advice only: hints never block approval. */
export interface Hint {
  /** Stable per check (and per finding, if a check can find several), so Ignore and Add to review survive a refresh. */
  id: string;
  severity: HintSeverity;
  /** Shown as a label on accessibility hints. */
  rating?: HintRating;
  title: string;
  detail: string;
  /** The line "Add to review" puts in the review notes, written for the agent that will revise the draft. */
  reviewNote: string;
}

/** What the checks look at: the revision the reviewer is deciding on. */
export interface HintInput {
  html: string;
  subject: string;
  /** The HTML parsed by DOMParser: an inert document (no scripts run, nothing loads), read as data only. */
  doc: Document;
}

/** Colour and icon for a rating: Critical and Serious are errors, Moderate a warning, Mild info. */
export function severityFor(rating: HintRating): HintSeverity {
  return rating === "critical" || rating === "serious" ? "error" : rating === "moderate" ? "warning" : "info";
}
