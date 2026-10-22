import type { DraftStatus } from "@/lib/client/api";
import { STATUS_LABEL } from "@/lib/client/format";
import type { Tone } from "./Notice";
import { StatusIcon } from "./StatusIcon";
import styles from "./StatusBadge.module.css";

const TONE: Record<DraftStatus, Tone | "progress"> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "progress",
  sent: "success",
  failed: "error",
  rejected: "neutral",
};

/** Text label plus a distinct icon shape; colour is never the only signal. */
export function StatusBadge({ status }: { status: DraftStatus }) {
  const tone = TONE[status];
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      <StatusIcon tone={status === "rejected" ? "error" : tone} className={styles.icon} />
      {STATUS_LABEL[status]}
    </span>
  );
}
