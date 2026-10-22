"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import styles from "./Announcer.module.css";

const AnnounceContext = createContext<(message: string) => void>(() => {});

/** Status messages for screen readers, via one polite live region. */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const announce = useCallback((next: string) => {
    // Clear first so repeating the same message is still announced.
    setMessage("");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(next), 50);
  }, []);

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div className={styles.region} role="status" aria-live="polite" aria-atomic="true">
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}

export const useAnnounce = () => useContext(AnnounceContext);
