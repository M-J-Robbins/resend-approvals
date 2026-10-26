"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { formatBytes } from "@/lib/client/format";
import { colorSchemeSupport } from "@/lib/client/colorSchemeSupport";
import { applyForceDark } from "@/lib/client/forceDark/apply";
import { optsOutOfGmailForcedDark } from "@/lib/client/forceDark/lightOnly";
import { highlightHtml, type TokenType } from "@/lib/client/highlightHtml";
import { FRAME_LIMITS, PixelInput, ResizableFrame, type FrameSize } from "./ResizableFrame";
import { StatusIcon } from "./StatusIcon";
import { Tooltip } from "./Tooltip";
import styles from "./EmailPreview.module.css";

const TABS = [
  { key: "preview", label: "Preview" },
  { key: "source", label: "HTML source" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/**
 * Gmail clips messages whose HTML is over about 102 KB, hiding the rest behind
 * "View entire message". Tracking added at send time (pixels, rewritten links)
 * makes the sent email bigger than the draft, so warn well before the limit.
 */
const GMAIL_CLIP_BYTES = 102 * 1024;
/** Portrait sizes in CSS pixels (height is the longer side). Landscape swaps them. */
const DEVICES = [
  { name: "iPhone Duo (Folded)", width: 466, height: 678 },
  { name: "iPhone Duo (Unfolded)", width: 626, height: 890 },
  { name: "iPhone 17 Pro Max", width: 440, height: 956 },
  { name: "Samsung Galaxy S26", width: 360, height: 780 },
  { name: "Google Pixel 10", width: 412, height: 924 },
] as const;
const START_DEVICE = DEVICES[2];
const CUSTOM = "custom";

type Orientation = "portrait" | "landscape";

/**
 * The colour scheme the email is shown in, set as `color-scheme` on the iframe:
 * the email's own @media (prefers-color-scheme) rules then follow it, with no
 * change to its HTML. Light is the default because most email clients show
 * light. "system" follows the reviewer's OS, like the rest of the review UI.
 * "android" shows the email light, then rewrites its colours the way Android's
 * forced dark mode does (see lib/client/forceDark). "gmail" is the same,
 * except that Gmail leaves an email declaring color-scheme "light only" as is.
 * Both keep color-scheme light, so the email's own dark media queries never
 * match: only the forced dark pass changes colours.
 */
const SCHEMES = [
  { key: "light", label: "Light", css: "light" },
  { key: "dark", label: "Dark", css: "dark" },
  { key: "system", label: "System", css: "light dark" },
  { key: "android", label: "Android forced dark", css: "light" },
  { key: "gmail", label: "Gmail Android dark", css: "light" },
] as const;

/** Wait for resizing to stop before re-running forced dark, which needs a reload. */
const FORCED_DARK_RESIZE_DELAY_MS = 300;
type Scheme = (typeof SCHEMES)[number]["key"];

function oriented({ width, height }: FrameSize, orientation: Orientation): FrameSize {
  return orientation === "portrait" ? { width, height } : { width: height, height: width };
}
const NEAR_CLIP_BYTES = 80 * 1024;

const SIZE_STATUS = {
  near: {
    tone: "warning",
    tip: "file size is close to 102kb Gmail clipping limit. Email tracking codes may take this over the limit",
  },
  over: {
    tone: "error",
    tip: "email code is over 102kb. This will get clipped in Gmail",
  },
} as const;

/**
 * Agent-written HTML is untrusted. It is rendered only inside an iframe with
 * an empty sandbox (no scripts, no same-origin, no popups, no navigation),
 * and otherwise only as escaped text.
 */
export function EmailPreview({ html, subject }: { html: string; subject: string }) {
  const id = useId();
  const [tab, setTab] = useState<TabKey>("preview");
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [scheme, setScheme] = useState<Scheme>("light");
  // null until checked; then whether Light and Dark can be forced in this browser.
  const [schemeSupported, setSchemeSupported] = useState<boolean | null>(null);
  useEffect(() => {
    let current = true;
    void colorSchemeSupport().then((ok) => {
      if (current) setSchemeSupported(ok);
    });
    return () => {
      current = false;
    };
  }, []);
  const [mobileSize, setMobileSize] = useState<FrameSize>(() => oriented(START_DEVICE, "portrait"));
  // The device whose size (in the current orientation) is on screen, if any.
  const device = DEVICES.find((d) => {
    const s = oriented(d, orientation);
    return s.width === mobileSize.width && s.height === mobileSize.height;
  });
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // UTF-8 bytes, which is what is sent and what Gmail measures.
  const bytes = useMemo(() => new TextEncoder().encode(html).length, [html]);
  const sizeStatus = bytes >= GMAIL_CLIP_BYTES ? SIZE_STATUS.over : bytes > NEAR_CLIP_BYTES ? SIZE_STATUS.near : null;
  const kilobytes = `${(bytes / 1024).toFixed(1)} KB`;
  const codeRef = useRef<HTMLElement>(null);
  useSourceHighlights(codeRef, html, tab === "source");

  const gmailOptOut = useMemo(() => scheme === "gmail" && optsOutOfGmailForcedDark(html), [scheme, html]);
  const forcedDark = scheme === "android" || (scheme === "gmail" && !gmailOptOut);
  const stageRef = useRef<HTMLDivElement>(null);
  const forcedDarkRun = useForcedDarkReloads(stageRef, forcedDark);
  // Which forced-dark run has finished; the frame stays hidden until then, so
  // the light email never flashes.
  const [forcedDarkDone, setForcedDarkDone] = useState<number | null>(null);

  const frame = (
    <iframe
      // A new element whenever the sandbox or a forced-dark run changes: the
      // sandbox only applies to a new document, and forced dark can't be undone.
      key={forcedDark ? `forced-dark-${forcedDarkRun}` : "plain"}
      className={styles.frame}
      style={{
        colorScheme: SCHEMES.find((s) => s.key === scheme)?.css,
        visibility: forcedDark && forcedDarkDone !== forcedDarkRun ? "hidden" : undefined,
      }}
      // Forced dark has to read the rendered email, so our page needs access
      // to its document: allow-same-origin, but never allow-scripts. With
      // both, the email could lift its own sandbox and act as the reviewer.
      sandbox={forcedDark ? "allow-same-origin" : ""}
      srcDoc={html}
      title={`Email preview: ${subject}`}
      referrerPolicy="no-referrer"
      onLoad={(e) => {
        if (!forcedDark) return;
        const doc = e.currentTarget.contentDocument;
        if (!doc || doc.URL !== "about:srcdoc") return;
        applyForceDark(doc);
        setForcedDarkDone(forcedDarkRun);
      }}
    />
  );

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
                {v === "desktop" ? "Desktop" : "Mobile"}
              </button>
            ))}
          </div>
          <label className={styles.deviceField}>
            <span>Colour scheme</span>
            <select className={styles.select} value={scheme} onChange={(e) => setScheme(e.target.value as Scheme)}>
              {SCHEMES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {schemeSupported === false && (
          <p className={styles.schemeNote}>
            <StatusIcon tone="info" />
            <span>
              This browser can&apos;t switch the preview between light and dark, so it always follows your system
              setting. To check both, change your system&apos;s appearance, or use a browser that supports it, such as
              Chrome, Firefox or Safari 27 or later.
            </span>
          </p>
        )}
        <div ref={stageRef} className={styles.stage} data-viewport={viewport}>
          {viewport === "mobile" ? (
            <>
              {/* The size controls sit in the mobile stage, with the frame they size. */}
              <div role="group" aria-label="Mobile preview size" className={styles.dimensions}>
                <label className={styles.deviceField}>
                  <span>Device</span>
                  <select
                    className={styles.select}
                    value={device?.name ?? CUSTOM}
                    onChange={(e) => {
                      const picked = DEVICES.find((d) => d.name === e.target.value);
                      if (picked) setMobileSize(oriented(picked, orientation));
                    }}
                  >
                    {/* Shown, not choosable, when the size was dragged or typed. */}
                    <option value={CUSTOM} disabled>
                      Custom size
                    </option>
                    {DEVICES.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name} ({d.width} × {d.height})
                      </option>
                    ))}
                  </select>
                </label>
                {/* One toggle: pressed means landscape. The icon turns with it (see .rotateIcon). */}
                <button
                  type="button"
                  aria-pressed={orientation === "landscape"}
                  title={orientation === "portrait" ? "Rotate to landscape" : "Rotate to portrait"}
                  className={styles.rotate}
                  onClick={() => {
                    setOrientation((o) => (o === "portrait" ? "landscape" : "portrait"));
                    // Turning the device swaps its sides, whatever the size.
                    setMobileSize((s) => ({ width: s.height, height: s.width }));
                  }}
                >
                  <RotateIcon />
                  <span className={styles.visuallyHidden}>Landscape</span>
                </button>
                <PixelInput
                  label="Width"
                  value={mobileSize.width}
                  limits={FRAME_LIMITS.width}
                  onChange={(width) => setMobileSize((s) => ({ ...s, width }))}
                />
                <span aria-hidden="true">×</span>
                <PixelInput
                  label="Height"
                  value={mobileSize.height}
                  limits={FRAME_LIMITS.height}
                  onChange={(height) => setMobileSize((s) => ({ ...s, height }))}
                />
              </div>
              <ResizableFrame size={mobileSize} onResize={setMobileSize}>
                {frame}
              </ResizableFrame>
            </>
          ) : (
            frame
          )}
        </div>
        <p className={styles.size}>
          Email size{" "}
          {sizeStatus ? (
            // The size itself is the trigger; the tooltip (also its accessible
            // description) says why it's flagged.
            <Tooltip content={sizeStatus.tip} className={`${styles.sizeStatus} ${styles[sizeStatus.tone]}`}>
              <StatusIcon tone={sizeStatus.tone} />
              <strong className={styles.sizeValue}>{kilobytes}</strong>
            </Tooltip>
          ) : (
            <strong className={styles.sizeValue}>{kilobytes}</strong>
          )}
        </p>
      </div>

      <div
        role="tabpanel"
        id={`${id}-panel-source`}
        aria-labelledby={`${id}-tab-source`}
        hidden={tab !== "source"}
        className={styles.panel}
      >
        <p className={styles.caption}>
          {formatBytes(bytes)} · exactly what will be sent
        </p>
        {/* One escaped text node; never parsed as HTML. Colour comes from CSS highlights over it. */}
        <pre className={styles.source} tabIndex={0} aria-label="HTML source">
          <code ref={codeRef}>{html}</code>
        </pre>
      </div>
    </section>
  );
}

const HIGHLIGHTED: Exclude<TokenType, "text">[] = [
  "punctuation",
  "tag",
  "attribute",
  "value",
  "comment",
  "doctype",
  "entity",
];
/** Highlight names are page-wide, so they carry a prefix. Styled by ::highlight(email-source-*). */
const highlightName = (type: TokenType) => `email-source-${type}`;

/**
 * Colours the HTML source with the CSS Custom Highlight API: a Range over the
 * single text node for each token, grouped into one named Highlight per token
 * type. No elements are added, so the source stays one escaped text node and a
 * large email doesn't create thousands of spans. Browsers without the API
 * show the source uncoloured.
 */
function useSourceHighlights(codeRef: RefObject<HTMLElement | null>, html: string, active: boolean) {
  useEffect(() => {
    const node = codeRef.current?.firstChild;
    if (!active || !(node instanceof Text) || typeof CSS === "undefined" || !("highlights" in CSS)) return;

    const ranges = new Map<TokenType, Range[]>();
    let offset = 0;
    for (const token of highlightHtml(html)) {
      const end = offset + token.text.length;
      if (token.type !== "text") {
        const range = new Range();
        range.setStart(node, offset);
        range.setEnd(node, end);
        const list = ranges.get(token.type);
        if (list) list.push(range);
        else ranges.set(token.type, [range]);
      }
      offset = end;
    }
    for (const type of HIGHLIGHTED) CSS.highlights.set(highlightName(type), new Highlight(...(ranges.get(type) ?? [])));

    return () => {
      for (const type of HIGHLIGHTED) CSS.highlights.delete(highlightName(type));
    };
  }, [codeRef, html, active]);
}

/**
 * Forced dark depends on the preview's width (an email's @media rules can
 * change its colours), and can only be applied to a fresh document. So while
 * it is on, a change in the stage's size starts a new run (a new iframe) once
 * resizing has paused. Returns the current run's number.
 */
function useForcedDarkReloads(stageRef: RefObject<HTMLElement | null>, active: boolean): number {
  const [run, setRun] = useState(0);
  useEffect(() => {
    const stage = stageRef.current;
    if (!active || !stage) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const observer = new ResizeObserver(() => {
      // The observer reports the starting size once; that isn't a change.
      if (first) {
        first = false;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => setRun((n) => n + 1), FORCED_DARK_RESIZE_DELAY_MS);
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [stageRef, active]);
  return run;
}

/** A phone on its side between two rotation arrows. Decorative; the button names itself. */
function RotateIcon() {
  return (
    <svg className={styles.rotateIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="8.25" y="3" width="7.5" height="18" rx="1.75" transform="rotate(-45 12 12)" />
      <path d="M14.08 2.22A10 10 0 0 1 21.78 9.92" />
      <path d="M22.8 7.53 21.78 9.92 19.88 8.15" />
      <path d="M9.92 21.78A10 10 0 0 1 2.22 14.08" />
      <path d="M1.2 16.47 2.22 14.08 4.12 15.85" />
    </svg>
  );
}
