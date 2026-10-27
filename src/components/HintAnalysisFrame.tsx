"use client";

import { collectImages, contrastHints, imageHints, measureImages, type Hint } from "@/lib/client/hints";
import styles from "./HintAnalysisFrame.module.css";

/** Light mode at a typical email width; the reviewer's preview settings don't affect it. */
const WIDTH = 600;

/**
 * A hidden render of the email, used only to read computed styles for the
 * hints that need layout and colour (contrast, image sizes). It is separate from the
 * preview so the preview can stay fully sandboxed, and so the result doesn't
 * change with the preview's colour scheme, forced dark or width.
 *
 * Our page reads its document, so it has allow-same-origin, but never
 * allow-scripts: with both, the email could lift its own sandbox and act as
 * the reviewer. Remote images load a second time (usually from the cache).
 *
 * Give it a key per revision: the hints are read once, when it has loaded.
 * Contrast is reported straight away; the image hints follow once every
 * image's HEAD request has finished, and onHints is called again with both.
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
        const contrast = contrastHints(doc);
        onHints(contrast);
        const images = collectImages(doc);
        if (images.length === 0) return;
        // No HEAD for images that didn't load: they have nothing to measure.
        const sizes = await measureImages(images.filter((i) => !i.failed).map((i) => i.url));
        onHints([...contrast, ...imageHints(images, sizes)]);
      }}
    />
  );
}
