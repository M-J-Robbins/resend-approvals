"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./Tooltip.module.css";

/** Long enough to move the pointer from the trigger onto the tooltip. */
const HIDE_DELAY_MS = 150;

/**
 * A short description shown on hover or keyboard focus, in a native popover
 * placed next to its trigger with CSS anchor positioning.
 *
 * popover="hint" doesn't close other open popovers (such as the recipients
 * list); browsers without "hint" treat it as "manual". The tooltip stays open
 * while the pointer is over it and closes on Escape, so it can be hovered
 * and dismissed (WCAG 1.4.13).
 */
export function Tooltip({
  content,
  children,
  className,
}: {
  content: string;
  /** The trigger's visible content. It is wrapped in a button so keyboard users can reach it. */
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const tipId = `${id}-tip`;
  // useId can contain characters a CSS dashed ident can't.
  const anchor = `--tip-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const tip = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  const show = () => {
    cancelHide();
    if (!tip.current?.matches(":popover-open")) tip.current?.showPopover();
  };
  const hide = () => {
    cancelHide();
    if (tip.current?.matches(":popover-open")) tip.current.hidePopover();
  };
  const hideSoon = () => {
    cancelHide();
    hideTimer.current = setTimeout(hide, HIDE_DELAY_MS);
  };

  useEffect(() => cancelHide, []);

  return (
    <>
      <button
        type="button"
        className={[styles.trigger, className].filter(Boolean).join(" ")}
        style={{ anchorName: anchor }}
        aria-describedby={tipId}
        onPointerEnter={show}
        onPointerLeave={hideSoon}
        onFocus={show}
        onBlur={hide}
        onClick={show}
        onKeyDown={(e) => {
          if (e.key === "Escape") hide();
        }}
      >
        {children}
      </button>
      <div
        ref={tip}
        id={tipId}
        popover="hint"
        role="tooltip"
        className={styles.tip}
        style={{ positionAnchor: anchor }}
        onPointerEnter={cancelHide}
        onPointerLeave={hideSoon}
      >
        {content}
      </div>
    </>
  );
}
