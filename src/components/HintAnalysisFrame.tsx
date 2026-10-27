"use client";

import { contrastHints, type Hint } from "@/lib/client/hints";
import styles from "./HintAnalysisFrame.module.css";

/** Light mode at a typical email width; the reviewer's preview settings don't affect it. */
const WIDTH = 600;

/**
 * A hidden render of the email, used only to read computed styles for the
 * hints that need layout and colour (contrast). It is separate from the
 * preview so the preview can stay fully sandboxed, and so the result doesn't
 * change with the preview's colour scheme, forced dark or width.
 *
 * Our page reads its document, so it has allow-same-origin, but never
 * allow-scripts: with both, the email could lift its own sandbox and act as
 * the reviewer. Remote images load a second time (usually from the cache).
 *
 * Give it a key per revision: the hints are read once, when it has loaded.
 */
export function HintAnalysisFrame({ html, onHints }: { html: string; onHints: (hints: Hint[]) => void }) {
  return (
    <iframe
      className={styles.frame}
      width={WIDTH}
      sandbox="allow-same-origin"
      srcDoc={html}
      referrerPolicy="no-referrer"
      aria-hidden="true"
      tabIndex={-1}
      title="Email analysis (hidden)"
      onLoad={async (e) => {
        const doc = e.currentTarget.contentDocument;
        if (!doc || doc.URL !== "about:srcdoc") return;
        // Web fonts change text size, and so which text counts as large.
        await doc.fonts?.ready;
        onHints(contrastHints(doc));
      }}
    />
  );
}
