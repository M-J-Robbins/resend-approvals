"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `fn` every `intervalMs` while the tab is visible. Polling stops while
 * the tab is hidden and runs immediately when it becomes visible again.
 */
export function usePolling(fn: () => unknown, intervalMs: number, enabled = true) {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const schedule = () => {
      clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible") timer = setTimeout(tick, intervalMs);
    };
    const tick = async () => {
      try {
        await latest.current();
      } finally {
        schedule();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
      else clearTimeout(timer);
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);
}
