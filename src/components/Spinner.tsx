import styles from "./Spinner.module.css";

/** Decorative: always pair it with visible text that says what is happening. */
export function Spinner() {
  return <span className={styles.spinner} aria-hidden="true" />;
}
