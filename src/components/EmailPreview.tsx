"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { formatBytes } from "@/lib/client/format";
import styles from "./EmailPreview.module.css";

const TABS = [
  { key: "preview", label: "Preview" },
  { key: "source", label: "HTML source" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/**
 * Agent-written HTML is untrusted. It is rendered only inside an iframe with
 * an empty sandbox (no scripts, no same-origin, no popups, no navigation),
 * and otherwise only as escaped text.
 */
export function EmailPreview({ html, subject }: { html: string; subject: string }) {
  const id = useId();
  const [tab, setTab] = useState<TabKey>("preview");
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys move between tabs (automatic activation), Home/End jump.
  function onTabKeyDown(e: KeyboardEvent, index: number) {
    const last = TABS.length - 1;
    const next =
      e.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : e.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    setTab(TABS[next].key);
    tabRefs.current[next]?.focus();
  }

  return (
    <section className={styles.preview} aria-labelledby={`${id}-heading`}>
      <div className={styles.bar}>
        <h3 id={`${id}-heading`} className={styles.heading}>
          Email content
        </h3>
        <div role="tablist" aria-labelledby={`${id}-heading`} className={styles.tablist}>
          {TABS.map((t, i) => (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`${id}-panel-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              className={styles.tab}
              onClick={() => setTab(t.key)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`${id}-panel-preview`}
        aria-labelledby={`${id}-tab-preview`}
        hidden={tab !== "preview"}
        className={styles.panel}
      >
        <div className={styles.toolbar}>
          <div role="group" aria-label="Preview width" className={styles.segmented}>
            {(["desktop", "mobile"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={viewport === v}
                className={styles.segment}
                onClick={() => setViewport(v)}
              >
                {v === "desktop" ? "Desktop" : "Mobile (375px)"}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.stage} data-viewport={viewport}>
          <iframe
            className={styles.frame}
            sandbox=""
            srcDoc={html}
            title={`Email preview: ${subject}`}
            referrerPolicy="no-referrer"
          />
        </div>
      </div>

      <div
        role="tabpanel"
        id={`${id}-panel-source`}
        aria-labelledby={`${id}-tab-source`}
        hidden={tab !== "source"}
        className={styles.panel}
      >
        <p className={styles.caption}>
          {formatBytes(new TextEncoder().encode(html).length)} · exactly what will be sent
        </p>
        {/* React escapes this text; it is never parsed as HTML. */}
        <pre className={styles.source} tabIndex={0} aria-label="HTML source">
          <code>{html}</code>
        </pre>
      </div>
    </section>
  );
}
