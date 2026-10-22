"use client";

import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, isConflict, type DraftView } from "@/lib/client/api";
import { plural, shortHash } from "@/lib/client/format";
import { useAnnounce } from "./Announcer";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Notice } from "./Notice";
import { Recipients, recipientCount } from "./Recipients";
import styles from "./DraftActions.module.css";

type Revision = DraftView["revision"];
type Pending = "approve" | "reject" | "retry" | null;

export function DraftActions({
  view,
  stale,
  onUpdated,
  onReload,
  onPause,
}: {
  view: DraftView;
  /** A newer revision exists; the shown one can no longer be decided. */
  stale: boolean;
  onUpdated: (next: DraftView) => void;
  onReload: () => void;
  /** Pauses background refresh while a dialog is open or a request runs. */
  onPause: (paused: boolean) => void;
}) {
  const announce = useAnnounce();
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  // The exact revision the reviewer is approving, captured when the dialog opens.
  const [target, setTarget] = useState<Revision | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const approveBtn = useRef<HTMLButtonElement>(null);
  const rejectBtn = useRef<HTMLButtonElement>(null);
  const outcome = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const reasonId = useId();

  useEffect(() => {
    onPause(dialog !== null || pending !== null);
  }, [dialog, pending, onPause]);

  const decidable = view.status === "pending_approval" && !stale;

  function open(kind: "approve" | "reject") {
    setError(null);
    setTarget(view.revision);
    setReason("");
    setReasonError(null);
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

  async function approve() {
    if (!target) return;
    setPending("approve");
    try {
      // The ids/hash of the revision shown in the dialog, never refetched values.
      const next = await api.approve(view.id, target.id, target.content_hash);
      setDialog(null);
      succeeded(next);
      announce(
        next.status === "sent"
          ? `Approved and sent. Resend email id ${next.send?.resend_email_id ?? "unknown"}.`
          : next.status === "failed"
            ? `Approved, but the send failed: ${next.send?.error ?? "unknown error"}`
            : "Approved. The email is being sent.",
      );
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

  async function retry() {
    setError(null);
    setPending("retry");
    announce("Retrying the send…");
    try {
      const next = await api.retrySend(view.id);
      succeeded(next);
      announce(
        next.status === "sent"
          ? `Sent. Resend email id ${next.send?.resend_email_id ?? "unknown"}.`
          : `The send failed again: ${next.send?.error ?? "unknown error"}`,
      );
    } catch (e) {
      fail(e, "Retry failed.");
    } finally {
      setPending(null);
    }
  }

  const count = recipientCount(view.revision);

  return (
    <>
      {error && (
        <ActionError
          error={error}
          onReload={() => {
            setError(null);
            onReload();
          }}
        />
      )}

      <div ref={outcome} tabIndex={-1} className={styles.outcome}>
        <Outcome view={view} pending={pending} onRetry={retry} />
      </div>

      {view.status === "pending_approval" && (
        <section className={styles.bar} aria-labelledby="actions-heading">
          <h3 id="actions-heading" className={styles.barHeading}>
            Your decision
          </h3>
          <p className={styles.barText}>
            Approving sends this email to {plural(count, "recipient")} through Resend straight away.
          </p>
          <div className={styles.buttons}>
            <Button ref={approveBtn} variant="primary" disabled={!decidable || pending !== null} onClick={() => open("approve")}>
              Approve and send…
            </Button>
            <Button ref={rejectBtn} variant="danger" disabled={!decidable || pending !== null} onClick={() => open("reject")}>
              Reject…
            </Button>
          </div>
        </section>
      )}

      {target && (
        <Dialog
          open={dialog === "approve"}
          onClose={() => setDialog(null)}
          returnFocus={approveBtn}
          busy={pending === "approve"}
          title="Approve and send this email?"
          description={
            <p>
              This sends a real email through Resend as soon as you confirm. It can&apos;t be undone.
            </p>
          }
          footer={
            <>
              <Button autoFocus disabled={pending === "approve"} onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button variant="primary" busy={pending === "approve"} onClick={approve}>
                {pending === "approve"
                  ? "Sending…"
                  : `Approve and send to ${plural(recipientCount(target), "recipient")}`}
              </Button>
            </>
          }
        >
          <dl className={styles.summary}>
            <dt>Subject</dt>
            <dd>{target.subject}</dd>
            <dt>Revision</dt>
            <dd>
              {target.number} · <code>{shortHash(target.content_hash)}</code>
            </dd>
          </dl>
          <Recipients revision={target} idPrefix="approve" />
          {pending === "approve" && (
            <p className={styles.progress}>Sending through Resend. This can take a few seconds…</p>
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
              Be specific, for example “Wrong recipient” or “Remove the pricing section”. Up to 1000
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
  pending,
  onRetry,
}: {
  view: DraftView;
  pending: Pending;
  onRetry: () => void;
}) {
  const { send, review } = view;
  switch (view.status) {
    case "sent":
      return (
        <Notice tone="success" title="Approved and sent">
          <p>
            Resend accepted the email
            {send?.resend_email_id && (
              <>
                {" "}
                with id <code>{send.resend_email_id}</code>
              </>
            )}
            .
          </p>
        </Notice>
      );
    case "failed":
      return (
        <Notice
          tone="error"
          title="Approved, but the send failed"
          actions={
            <Button variant="primary" size="sm" busy={pending === "retry"} onClick={onRetry}>
              {pending === "retry" ? "Retrying…" : "Retry send"}
            </Button>
          }
        >
          <p>Resend’s error: {send?.error ?? "No error message was recorded."}</p>
          {send && <p>Attempts so far: {send.attempts}.</p>}
        </Notice>
      );
    case "approved":
      return (
        <Notice tone="info" title="Approved, sending now">
          <p>The email is being sent. This page updates when Resend responds.</p>
        </Notice>
      );
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
  const reloadable = error.code === "invalid_state" || error.code === "not_retryable";
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
  send_in_progress: "A send is already in progress",
  retry_unsafe: "Retrying now could send a duplicate",
  not_retryable: "This draft can't be retried",
  validation_error: "The request was invalid",
  network_error: "Couldn't reach the server",
};
