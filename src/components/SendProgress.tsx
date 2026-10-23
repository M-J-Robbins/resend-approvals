import type { SendProgress as Progress } from "@/lib/client/api";
import { formatCount, plural } from "@/lib/client/format";
import { StatusIcon } from "./StatusIcon";
import styles from "./SendProgress.module.css";

const share = (n: number, total: number) => `${total > 0 ? (n / total) * 100 : 0}%`;

/**
 * Progress bar plus the same numbers in words. The bar is a single
 * role="progressbar" whose value text carries every count, and failures use a
 * hatched fill, so nothing depends on colour.
 */
export function SendProgress({ send }: { send: Progress }) {
  const total = send.recipients_total;
  const done = send.recipients_sent + send.recipients_failed;
  const text = `${formatCount(send.recipients_sent)} sent, ${formatCount(send.recipients_failed)} failed, ${formatCount(send.recipients_pending)} pending, of ${plural(total, "recipient")}`;

  return (
    <div className={styles.progress}>
      <div
        role="progressbar"
        aria-label="Sending progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={text}
        className={styles.track}
      >
        <span className={styles.sent} style={{ width: share(send.recipients_sent, total) }} />
        <span className={styles.failed} style={{ width: share(send.recipients_failed, total) }} />
      </div>
      <dl className={styles.counts}>
        <div className={styles.count}>
          <dt>
            <StatusIcon tone="success" /> Sent
          </dt>
          <dd>{formatCount(send.recipients_sent)}</dd>
        </div>
        <div className={styles.count}>
          <dt>
            <StatusIcon tone="error" /> Failed
          </dt>
          <dd>{formatCount(send.recipients_failed)}</dd>
        </div>
        <div className={styles.count}>
          <dt>
            <StatusIcon tone="neutral" /> Pending
          </dt>
          <dd>{formatCount(send.recipients_pending)}</dd>
        </div>
      </dl>
      <p className={styles.caption}>
        {formatCount(done)} of {plural(total, "recipient")} processed, in{" "}
        {plural(send.chunks_total, "batch", "batches")} of up to 100. “Sent” means accepted by
        Resend, not delivered.
      </p>
    </div>
  );
}

/** Failed batches with the recipients they cover and Resend's error. */
export function SendErrors({ send }: { send: Progress }) {
  if (send.errors.length === 0) return null;
  const more = send.chunks_failed - send.errors.length;
  return (
    <div className={styles.errors}>
      <h4 className={styles.errorsHeading}>
        Failed {send.chunks_failed === 1 ? "batch" : "batches"} ({formatCount(send.chunks_failed)})
      </h4>
      <ul className={styles.errorList}>
        {send.errors.map((e) => (
          <li key={e.chunk_index} className={styles.error}>
            <p className={styles.errorTitle}>
              Batch {formatCount(e.chunk_index + 1)}: {plural(e.recipient_count, "recipient")},{" "}
              <span className={styles.mono}>{e.first_recipient}</span>
              {e.recipient_count > 1 && (
                <>
                  {" "}
                  to <span className={styles.mono}>{e.last_recipient}</span>
                </>
              )}
            </p>
            <p className={styles.errorText}>{e.error ?? "No error message was recorded."}</p>
            <p className={styles.errorMeta}>
              {plural(e.attempts, "attempt")}.{" "}
              {e.resumable
                ? "Resuming retries this batch."
                : "Not resumable: the outcome is unknown and too old to retry without risking duplicates. Check the Resend dashboard."}
            </p>
          </li>
        ))}
      </ul>
      {more > 0 && <p className={styles.errorMeta}>And {plural(more, "more failed batch", "more failed batches")}.</p>}
    </div>
  );
}
