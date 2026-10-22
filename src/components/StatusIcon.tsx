import type { Tone } from "./Notice";
import styles from "./StatusIcon.module.css";

/**
 * A distinct shape per tone, so status is never carried by colour alone.
 * Decorative: the surrounding text always names the status.
 */
export function StatusIcon({ tone, className }: { tone: Tone | "progress"; className?: string }) {
  return (
    <svg
      className={[styles.icon, className].filter(Boolean).join(" ")}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[tone]}
    </svg>
  );
}

const SHAPES = {
  // Hollow circle
  neutral: <circle cx="8" cy="8" r="5.5" />,
  // Clock
  warning: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </>
  ),
  // Paper plane
  progress: <path d="M2 8 14 2l-4 12-2.5-4.5L2 8Zm5.5 1.5L14 2" />,
  // "i" in a circle
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.5V11M8 5v.01" />
    </>
  ),
  // Check in a circle
  success: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="m5.5 8.2 1.8 1.8 3.3-3.6" />
    </>
  ),
  // Exclamation in a triangle
  error: (
    <>
      <path d="M8 2 14.5 13.5h-13L8 2Z" />
      <path d="M8 6.5v3M8 11.5v.01" />
    </>
  ),
} as const;
