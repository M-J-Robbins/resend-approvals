import type { ButtonHTMLAttributes, Ref } from "react";
import { Spinner } from "./Spinner";
import styles from "./Button.module.css";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "md" | "sm";
  /** Shows a spinner and disables the button while a request is in flight. */
  busy?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({
  variant = "secondary",
  size = "md",
  busy = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={[styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ")}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}
