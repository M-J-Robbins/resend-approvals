"use client";

import { useId, type ReactNode } from "react";
import type { Hint } from "@/lib/client/hints";
import { Button } from "./Button";
import { StatusIcon } from "./StatusIcon";
import styles from "./ReviewHints.module.css";

/** What the reviewer has done with a hint: nothing yet, ignored it, or added it to the review notes. */
export type HintDecision = "ignored" | "added";

/**
 * "Review hints (N)": a button in the decision panel that opens a popover
 * listing the hints for this revision. N counts the hints not ignored.
 * Ignored hints move to a collapsed "Ignored" section, where they can be
 * restored. Adding one puts its note in the review notes, which turns
 * Approve off (see DraftActions).
 */
export function ReviewHints({
  hints,
  decisions,
  onIgnore,
  onRestore,
  onAdd,
  onRemove,
}: {
  hints: Hint[];
  decisions: Record<string, HintDecision>;
  onIgnore: (hint: Hint) => void;
  onRestore: (hint: Hint) => void;
  onAdd: (hint: Hint) => void;
  onRemove: (hint: Hint) => void;
}) {
  const id = useId();
  const popoverId = `${id}-hints`;
  const active = hints.filter((h) => decisions[h.id] !== "ignored");
  const ignored = hints.filter((h) => decisions[h.id] === "ignored");

  return (
    <>
      <Button popoverTarget={popoverId}>Review hints ({active.length})</Button>

      {/* Native popover: the browser handles showing, Escape, light dismiss and returning focus. */}
      <div id={popoverId} popover="auto" role="dialog" aria-labelledby={`${id}-heading`} className={styles.popover}>
        <div className={styles.head}>
          <h4 id={`${id}-heading`} className={styles.heading}>
            Review hints <span className={styles.count}>({active.length})</span>
          </h4>
          <Button size="sm" variant="ghost" popoverTarget={popoverId} popoverTargetAction="hide" aria-keyshortcuts="Escape">
            Close
            <kbd className={styles.kbd} aria-hidden="true">
              Esc
            </kbd>
          </Button>
        </div>

        {active.length === 0 ? (
          <p className={styles.empty}>{hints.length === 0 ? "No hints for this revision." : "Every hint is ignored."}</p>
        ) : (
          <ul className={styles.list}>
            {active.map((hint) => (
              <HintItem key={hint.id} hint={hint}>
                {decisions[hint.id] === "added" ? (
                  <>
                    <span className={styles.added}>
                      <StatusIcon tone="success" /> Added to review
                    </span>
                    <Button size="sm" onClick={() => onRemove(hint)}>
                      Remove from review
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => onIgnore(hint)}>
                      Ignore
                    </Button>
                    <Button size="sm" onClick={() => onAdd(hint)}>
                      Add to review
                    </Button>
                  </>
                )}
              </HintItem>
            ))}
          </ul>
        )}

        {ignored.length > 0 && (
          // Collapsed by default; <details> gives keyboard and screen reader support for free.
          <details className={styles.ignored}>
            <summary className={styles.summary}>Ignored ({ignored.length})</summary>
            <ul className={styles.list}>
              {ignored.map((hint) => (
                <HintItem key={hint.id} hint={hint}>
                  <Button size="sm" variant="ghost" onClick={() => onRestore(hint)}>
                    Restore
                  </Button>
                </HintItem>
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}

const SEVERITY_LABEL = { error: "Error", warning: "Warning", info: "Note" } as const;
/** The report's own words for its ratings. */
const RATING_LABEL = { critical: "Critical", serious: "Serious", moderate: "Moderate", mild: "Mild" } as const;

function HintItem({ hint, children }: { hint: Hint; children: ReactNode }) {
  return (
    <li className={styles.item} data-severity={hint.severity}>
      <StatusIcon tone={hint.severity} className={styles.icon} />
      <div className={styles.body}>
        <p className={styles.title}>
          {/* The icon is decorative, so the severity is also said in words. */}
          <span className={styles.visuallyHidden}>{SEVERITY_LABEL[hint.severity]}: </span>
          {hint.title}
        </p>
        {hint.rating && <span className={styles.rating}>{RATING_LABEL[hint.rating]}</span>}
        <p className={styles.detail}>{hint.detail}</p>
        <div className={styles.actions}>{children}</div>
      </div>
    </li>
  );
}
