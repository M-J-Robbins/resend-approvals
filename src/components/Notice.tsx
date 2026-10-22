import type { ReactNode } from "react";
import { StatusIcon } from "./StatusIcon";
import styles from "./Notice.module.css";

export type Tone = "neutral" | "info" | "success" | "warning" | "error";

/** A callout box. The title states the outcome in words; colour only reinforces it. */
export function Notice({
  tone,
  title,
  children,
  actions,
  headingLevel = 3,
}: {
  tone: Tone;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 2 | 3 | 4;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={`${styles.notice} ${styles[tone]}`}>
      <StatusIcon tone={tone} className={styles.icon} />
      <div className={styles.body}>
        <Heading className={styles.title}>{title}</Heading>
        {children && <div className={styles.content}>{children}</div>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  );
}
