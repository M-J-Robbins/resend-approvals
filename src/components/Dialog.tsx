"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import styles from "./Dialog.module.css";

/**
 * Native modal <dialog>: the browser traps focus and handles Escape. Focus is
 * returned to `returnFocus` (the trigger) when it closes. While `busy`,
 * Escape is ignored so an in-flight request can't be orphaned.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  busy = false,
  returnFocus,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  busy?: boolean;
  returnFocus?: RefObject<HTMLElement | null>;
  /** When set, the body is a form and Enter in a field submits it. */
  onSubmit?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const body = (
    <>
      <div className={styles.body}>
        <h2 id={`${id}-title`} className={styles.title}>
          {title}
        </h2>
        {description && (
          <div id={`${id}-desc`} className={styles.description}>
            {description}
          </div>
        )}
        {children}
      </div>
      <div className={styles.footer}>{footer}</div>
    </>
  );

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-desc` : undefined}
      aria-busy={busy || undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClose={() => {
        if (open) onClose();
        returnFocus?.current?.focus();
      }}
    >
      {onSubmit ? (
        <form
          className={styles.form}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {body}
        </form>
      ) : (
        <div className={styles.form}>{body}</div>
      )}
    </dialog>
  );
}
