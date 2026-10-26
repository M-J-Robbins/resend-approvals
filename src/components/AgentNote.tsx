import styles from "./AgentNote.module.css";

/**
 * Points AI agents that land on the review UI to the agent docs. It is on the
 * "Checking your session…" screen because that is what the static HTML holds:
 * agents fetching the page don't run JavaScript, so they never see sign-in.
 */
export function AgentNote() {
  return (
    <p className={styles.note}>
      Are you an AI agent? Read <a href="/SKILL.md">/SKILL.md</a> to use the API (or{" "}
      <a href="/llms.txt">/llms.txt</a>, <a href="/openapi.json">/openapi.json</a>).
    </p>
  );
}
