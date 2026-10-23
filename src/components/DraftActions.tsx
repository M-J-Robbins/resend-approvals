"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError, isConflict, type DraftView } from "@/lib/client/api";
import { formatCount, parseCount, plural, relativeTime, shortHash } from "@/lib/client/format";
import { useAnnounce } from "./Announcer";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Notice } from "./Notice";
import { SendErrors, SendProgress } from "./SendProgress";
import styles from "./DraftActions.module.css";

type Revision = DraftView["revision"];
type Pending = "approve" | "reject" | "resume" | null;

/** Above this many recipients the reviewer types the count to confirm. */
const TYPE_TO_CONFIRM_ABOVE = 100;
/** An approved draft with no recorded progress for this long may have lost its worker. */
const STALLED_AFTER_MS = 2 * 60 * 1000;

export function DraftActions({
  view,
  stale,
  now,
  onUpdated,
  onReload,
  onPause,
  barSlot,
}: {
  view: DraftView;
  /** A newer revision exists; the shown one can no longer be decided. */
  stale: boolean;
  /** Time of the last refresh, for "no progress since". */
  now: number;
  onUpdated: (next: DraftView) => void;
  onReload: () => void;
  /** Pauses background refresh while a dialog is open or a request runs. */
  onPause: (paused: boolean) => void;
  /**
   * Where the decision bar goes: the end of the draft, so it can stick to the
   * bottom of the pane and still come last in reading and focus order.
   */
  barSlot: HTMLElement | null;
}) {
  const announce = useAnnounce();
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  // The exact revision the reviewer is approving, captured when the dialog opens.
  const [target, setTarget] = useState<Revision | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [typedCount, setTypedCount] = useState("");
  const [resumeNote, setResumeNote] = useState<string | null>(null);

  const approveBtn = useRef<HTMLButtonElement>(null);
  const rejectBtn = useRef<HTMLButtonElement>(null);
  const outcome = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const reasonId = useId();
  const countId = useId();

  useEffect(() => {
    onPause(dialog !== null || pending !== null);
  }, [dialog, pending, onPause]);

  // Say when a job that was running on screen finishes.
  const lastStatus = useRef(view.status);
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = view.status;
    if (was !== "approved" || !view.send) return;
    if (view.status === "sent") {
      announce(`Sending finished. All ${plural(view.send.recipients_total, "recipient")} were accepted by Resend.`);
    } else if (view.status === "failed") {
      announce(
        `Sending finished with failures: ${formatCount(view.send.recipients_sent)} sent, ${formatCount(view.send.recipients_failed)} failed.`,
      );
    }
  }, [view.status, view.send, announce]);

  const decidable = view.status === "pending_approval" && !stale;

  function open(kind: "approve" | "reject") {
    setError(null);
    setTarget(view.revision);
    setReason("");
    setReasonError(null);
    setTypedCount("");
    setDialog(kind);
  }

  function fail(e: unknown, fallback: string) {
    const err = e instanceof ApiError ? e : new ApiError(0, "unknown", fallback);
    if (err.status === 401) return; // the app is already returning to sign-in
    setError(err);
    announce(
      isConflict(err)
        ? "Not applied: the agent changed this draft while you were reviewing it. Reload to see the new revision."
        : `${err.message}${err.hint ? ` ${err.hint}` : ""}`,
    );
  }

  function succeeded(next: DraftView) {
    onUpdated(next);
    // The buttons are gone now; move focus to the result so it isn't lost.
    requestAnimationFrame(() => outcome.current?.focus());
  }

  const needsTypedCount = (target?.recipient_count ?? 0) > TYPE_TO_CONFIRM_ABOVE;
  const countConfirmed = !needsTypedCount || parseCount(typedCount) === target?.recipient_count;

  async function approve() {
    if (!target || !countConfirmed) return;
    setPending("approve");
    try {
      // The id, hash and count of the revision shown in the dialog, never refetched values.
      const next = await api.approve(view.id, target);
      setDialog(null);
      setResumeNote(null);
      succeeded(next);
      announce(`Approved. Sending to ${plural(target.recipient_count, "recipient")} has started.`);
    } catch (e) {
      setDialog(null);
      fail(e, "Approval failed.");
    } finally {
      setPending(null);
    }
  }

  async function reject() {
    if (!target) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonError("Enter a reason so the agent knows what to change.");
      reasonRef.current?.focus();
      return;
    }
    setPending("reject");
    try {
      const next = await api.reject(view.id, target.id, trimmed);
      setDialog(null);
      succeeded(next);
      announce("Draft rejected. The agent can see your reason.");
    } catch (e) {
      // Field errors stay in the dialog; anything else closes it.
      if (e instanceof ApiError && e.code === "validation_error") {
        setReasonError(e.issues[0]?.message ?? e.message);
        reasonRef.current?.focus();
      } else {
        setDialog(null);
        fail(e, "Rejection failed.");
      }
    } finally {
      setPending(null);
    }
  }

  async function resume() {
    setError(null);
    setPending("resume");
    announce("Resuming sending…");
    try {
      const next = await api.resume(view.id);
      const { chunks_reset, skipped_unsafe, hint } = next.resume;
      const note =
        `${chunks_reset > 0 ? `Retrying ${plural(chunks_reset, "failed batch", "failed batches")}.` : "Restarted the sending worker."}` +
        (skipped_unsafe > 0
          ? ` ${plural(skipped_unsafe, "batch", "batches")} could not be retried safely. ${hint ?? ""}`
          : "");
      setResumeNote(note);
      succeeded(next);
      announce(note);
    } catch (e) {
      fail(e, "Resume failed.");
    } finally {
      setPending(null);
    }
  }

  const count = view.revision.recipient_count;

  const errorNotice = error && (
    <ActionError
      error={error}
      onReload={() => {
        setError(null);
        onReload();
      }}
    />
  );

  const outcomeNotice = (
    <div ref={outcome} tabIndex={-1} className={styles.outcome}>
      <Outcome view={view} now={now} pending={pending} note={resumeNote} onResume={resume} />
    </div>
  );

  // Same shape as the outcome notices: icon, heading, text, then the buttons.
  const decisionBar = view.status === "pending_approval" && (
    <Notice
      tone="warning"
      title="Your decision"
      actions={
        <>
          <Button ref={approveBtn} variant="primary" disabled={!decidable || pending !== null} onClick={() => open("approve")}>
            Approve and send…
          </Button>
          {/* Secondary, not danger: red text on a tinted notice is under 4.5:1 in light
              mode. The Reject dialog's confirm button keeps the danger style. */}
          <Button ref={rejectBtn} variant="secondary" disabled={!decidable || pending !== null} onClick={() => open("reject")}>
            Reject…
          </Button>
        </>
      }
    >
      <p>
        This draft is waiting for your review. Approving sends{" "}
        {count === 1
          ? "this email to 1 recipient"
          : `an individual copy of this email to each of ${formatCount(count)} recipients`}{" "}
        through Resend straight away.
      </p>
    </Notice>
  );

  return (
    <>
      {/* Every status (the decision, or the outcome) and any error from acting on
          it live in the panel pinned to the bottom of the pane. */}
      {barSlot &&
        createPortal(
          // Focusable so its contents can be scrolled with the keyboard when it overflows.
          <div className={styles.panel} role="region" aria-label="Decision" tabIndex={0}>
            {/* Same width and side padding as the draft, so the two line up. */}
            <div className={styles.panelInner}>
              {errorNotice}
              {view.status === "pending_approval" ? decisionBar : outcomeNotice}
            </div>
          </div>,
          barSlot,
        )}

      {target && (
        <Dialog
          open={dialog === "approve"}
          onClose={() => setDialog(null)}
          returnFocus={approveBtn}
          busy={pending === "approve"}
          onSubmit={approve}
          title="Approve and send this email?"
          description={
            <p>This sends as soon as you confirm. It can&apos;t be undone.</p>
          }
          footer={
            <>
              <Button autoFocus={!needsTypedCount} disabled={pending === "approve"} onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                busy={pending === "approve"}
                disabled={!countConfirmed}
                aria-describedby={needsTypedCount ? `${countId}-help` : undefined}
              >
                {pending === "approve"
                  ? "Approving…"
                  : `Approve and send to ${plural(target.recipient_count, "recipient")}`}
              </Button>
            </>
          }
        >
          <dl className={styles.summary}>
            <dt>Subject</dt>
            <dd>{target.subject}</dd>
            <dt>Recipients</dt>
            <dd>{plural(target.recipient_count, "individual email")}</dd>
            <dt>Revision</dt>
            <dd>
              {target.number} · <code>{shortHash(target.content_hash)}</code>
            </dd>
          </dl>
          {needsTypedCount && (
            <div className={styles.field}>
              <label htmlFor={countId} className={styles.label}>
                Type the number of recipients, {formatCount(target.recipient_count)}, to confirm
              </label>
              <input
                id={countId}
                className={styles.input}
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                value={typedCount}
                disabled={pending === "approve"}
                onChange={(e) => setTypedCount(e.target.value)}
                aria-describedby={`${countId}-help`}
              />
              <p id={`${countId}-help`} className={styles.help}>
                {countConfirmed
                  ? "Count confirmed."
                  : `The approve button is enabled once you type ${formatCount(target.recipient_count)}.`}
              </p>
            </div>
          )}
        </Dialog>
      )}

      {target && (
        <Dialog
          open={dialog === "reject"}
          onClose={() => setDialog(null)}
          returnFocus={rejectBtn}
          busy={pending === "reject"}
          onSubmit={reject}
          title="Reject this draft?"
          description={
            <p>
              Nothing is sent. The agent sees your reason and can revise revision {target.number} and
              resubmit it.
            </p>
          }
          footer={
            <>
              <Button disabled={pending === "reject"} onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" busy={pending === "reject"}>
                {pending === "reject" ? "Rejecting…" : "Reject draft"}
              </Button>
            </>
          }
        >
          <div className={styles.field}>
            <label htmlFor={reasonId} className={styles.label}>
              Reason <span className={styles.required}>(required)</span>
            </label>
            <textarea
              ref={reasonRef}
              id={reasonId}
              className={styles.textarea}
              rows={4}
              maxLength={1000}
              required
              autoFocus
              value={reason}
              disabled={pending === "reject"}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError) setReasonError(null);
              }}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={`${reasonId}-help${reasonError ? ` ${reasonId}-error` : ""}`}
            />
            <p id={`${reasonId}-help`} className={styles.help}>
              Be specific, for example “Wrong recipients” or “Remove the pricing section”. Up to 1000
              characters.
            </p>
            {reasonError && (
              <p id={`${reasonId}-error`} className={styles.fieldError}>
                {reasonError}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

/** The current state of the decision and send, stated in words. */
function Outcome({
  view,
  now,
  pending,
  note,
  onResume,
}: {
  view: DraftView;
  now: number;
  pending: Pending;
  note: string | null;
  onResume: () => void;
}) {
  const { send, review } = view;
  const resumeButton = (label: string) => (
    <Button variant="primary" size="sm" busy={pending === "resume"} onClick={onResume}>
      {pending === "resume" ? "Resuming…" : label}
    </Button>
  );

  switch (view.status) {
    case "sent":
      return (
        <Notice tone="success" title={`Sent to all ${plural(view.revision.recipient_count, "recipient")}`}>
          <p>Resend accepted every email. Delivery to inboxes isn&apos;t tracked here.</p>
          {send && <SendProgress send={send} />}
        </Notice>
      );
    case "failed": {
      const anyResumable = send?.errors.some((e) => e.resumable) ?? false;
      return (
        <Notice
          tone="error"
          title={
            send?.partial
              ? `Partly sent: ${formatCount(send.recipients_sent)} of ${plural(send.recipients_total, "recipient")}`
              : "Sending failed"
          }
          actions={anyResumable && resumeButton("Resume sending")}
        >
          <p>
            {send?.partial
              ? "Some batches were accepted by Resend and some failed. Resuming retries only the failed batches; recipients who were already sent are never emailed again."
              : "No email was accepted. Resuming retries the failed batches."}
          </p>
          {note && <p>{note}</p>}
          {send && <SendProgress send={send} />}
          {send && <SendErrors send={send} />}
        </Notice>
      );
    }
    case "approved": {
      const idleMs = send ? now - new Date(send.updated_at).getTime() : 0;
      const stalled = idleMs > STALLED_AFTER_MS;
      return (
        <Notice
          tone={stalled ? "warning" : "info"}
          title={stalled ? "Sending seems to have stopped" : "Approved, sending now"}
          actions={stalled && resumeButton("Resume sending")}
        >
          <p>
            {stalled && send
              ? `No progress has been recorded since ${relativeTime(send.updated_at, now)}. The sending worker may have stopped. Resuming is safe: batches that were already accepted are not sent again.`
              : "Emails are sent in batches in the background. This page updates every 2 seconds."}
          </p>
          {note && <p>{note}</p>}
          {send && <SendProgress send={send} />}
          {send && <SendErrors send={send} />}
        </Notice>
      );
    }
    case "rejected":
      return (
        <Notice tone="neutral" title="Rejected">
          {review?.reason && <p>Reason: {review.reason}</p>}
          <p>The agent can revise the draft and submit it again.</p>
        </Notice>
      );
    case "draft":
      return (
        <Notice tone="neutral" title="Not submitted for approval">
          <p>The agent is still working on this draft. It appears in the pending list once submitted.</p>
        </Notice>
      );
    default:
      return null;
  }
}

function ActionError({ error, onReload }: { error: ApiError; onReload: () => void }) {
  if (isConflict(error)) {
    return (
      <Notice
        tone="warning"
        title="The agent changed this draft while you were reviewing it"
        actions={
          <Button variant="primary" size="sm" onClick={onReload}>
            Reload draft
          </Button>
        }
      >
        <p>Your decision was not applied and nothing was sent. Reload to review the latest revision.</p>
      </Notice>
    );
  }
  const reloadable = error.code === "invalid_state" || error.code === "not_resumable";
  return (
    <Notice
      tone="error"
      title={TITLES[error.code] ?? "That didn't work"}
      actions={
        reloadable && (
          <Button size="sm" onClick={onReload}>
            Reload draft
          </Button>
        )
      }
    >
      <p>{error.message}</p>
      {error.hint && <p>{error.hint}</p>}
      {error.issues.length > 0 && (
        <ul>
          {error.issues.map((i, n) => (
            <li key={n}>
              {i.path ? `${i.path}: ` : ""}
              {i.message}
            </li>
          ))}
        </ul>
      )}
    </Notice>
  );
}

const TITLES: Record<string, string> = {
  invalid_state: "This draft is no longer waiting for approval",
  retry_unsafe: "Resuming now could send duplicates",
  not_resumable: "This draft can't be resumed",
  validation_error: "The request was invalid",
  network_error: "Couldn't reach the server",
};
