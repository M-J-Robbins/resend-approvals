"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type DraftView } from "@/lib/client/api";
import { absoluteTime, relativeTime, shortHash } from "@/lib/client/format";
import { Button } from "./Button";
import { EmailPreview } from "./EmailPreview";
import { Notice } from "./Notice";
import { Recipients } from "./Recipients";
import { Spinner } from "./Spinner";
import { StatusBadge } from "./StatusBadge";
import { usePolling } from "./usePolling";
import styles from "./DraftDetail.module.css";

const POLL_MS = 5000;

type Load = { kind: "loading" } | { kind: "error"; error: ApiError | null } | { kind: "ready" };

export function DraftDetail({
  id,
  backHref,
  onChanged,
}: {
  id: string;
  backHref: string;
  /** Tells the list to refresh after this draft changes. */
  onChanged: () => void;
}) {
  // `view` is the revision the reviewer is looking at. Background polling only
  // refreshes it while it is still the same revision (status/send updates);
  // a newer revision is held in `newer` until the reviewer chooses to reload.
  const [view, setView] = useState<DraftView | null>(null);
  const [newer, setNewer] = useState<DraftView | null>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const viewRef = useRef<DraftView | null>(null);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const fetchDraft = useCallback(
    async (mode: "initial" | "reload" | "poll") => {
      if (mode === "initial") setLoad({ kind: "loading" });
      try {
        const latest = await api.getDraft(id);
        setNow(Date.now());
        const shown = viewRef.current;
        if (mode !== "poll" || !shown || shown.revision.id === latest.revision.id) {
          setView(latest);
          setNewer(null);
        } else {
          setNewer(latest);
        }
        setLoad({ kind: "ready" });
      } catch (e) {
        if (mode !== "poll") setLoad({ kind: "error", error: e instanceof ApiError ? e : null });
      }
    },
    [id],
  );

  useEffect(() => {
    setView(null);
    setNewer(null);
    void fetchDraft("initial");
  }, [fetchDraft]);

  usePolling(() => fetchDraft("poll"), POLL_MS, load.kind === "ready");

  const back = (
    <Link href={backHref} scroll={false} className={styles.back}>
      <span aria-hidden="true">←</span> Back to drafts
    </Link>
  );

  if (load.kind === "loading" || (load.kind === "ready" && !view)) {
    return (
      <div className={styles.detail} aria-busy="true">
        {back}
        <p className={styles.loading}>
          <Spinner /> Loading draft…
        </p>
      </div>
    );
  }

  if (load.kind === "error" || !view) {
    const notFound = load.kind === "error" && load.error?.status === 404;
    return (
      <div className={styles.detail}>
        {back}
        <Notice
          tone="error"
          headingLevel={2}
          title={notFound ? "Draft not found" : "Couldn't load this draft"}
          actions={!notFound && <Button onClick={() => void fetchDraft("initial")}>Try again</Button>}
        >
          <p>{load.kind === "error" && load.error ? load.error.message : "Something went wrong."}</p>
        </Notice>
      </div>
    );
  }

  const { revision } = view;

  return (
    <article className={styles.detail} aria-labelledby="draft-subject">
      {back}

      <header className={styles.header}>
        <div className={styles.meta}>
          <StatusBadge status={view.status} />
          <span>Revision {revision.number}</span>
          <code className={styles.hash} title={`Content hash ${revision.content_hash}`}>
            {shortHash(revision.content_hash)}
          </code>
          <span>
            Updated{" "}
            <time dateTime={view.updated_at} title={absoluteTime(view.updated_at)}>
              {relativeTime(view.updated_at, now)}
            </time>
          </span>
        </div>
        <h2 id="draft-subject" className={styles.subject}>
          {revision.subject}
        </h2>
      </header>

      {newer && (
        <Notice
          tone="warning"
          title={`The agent revised this draft (now revision ${newer.revision.number})`}
          actions={
            <Button variant="primary" size="sm" onClick={() => void fetchDraft("reload")}>
              Reload draft
            </Button>
          }
        >
          <p>
            You are looking at revision {revision.number}, which can no longer be approved or rejected.
            Reload to review the new revision.
          </p>
        </Notice>
      )}

      <ReviewOutcome view={view} />

      <Recipients revision={revision} idPrefix="draft" />

      <EmailPreview html={revision.html} subject={revision.subject} />

      <RevisionHistory view={view} now={now} />
    </article>
  );
}

function ReviewOutcome({ view }: { view: DraftView }) {
  const { review, send } = view;
  if (!review && !send) return null;
  return (
    <section className={styles.section} aria-labelledby="outcome-heading">
      <h3 id="outcome-heading" className={styles.sectionHeading}>
        Review and send
      </h3>
      <dl className={styles.facts}>
        {review && (
          <>
            <dt>Decision</dt>
            <dd>
              {review.decision === "approved" ? "Approved" : "Rejected"}{" "}
              <time dateTime={review.decided_at} className={styles.muted}>
                {absoluteTime(review.decided_at)}
              </time>
            </dd>
          </>
        )}
        {review?.reason && (
          <>
            <dt>Reason</dt>
            <dd className={styles.prewrap}>{review.reason}</dd>
          </>
        )}
        {send && (
          <>
            <dt>Send status</dt>
            <dd>{send.status === "sending" ? "Sending" : send.status === "sent" ? "Sent" : "Failed"}</dd>
            <dt>Resend email id</dt>
            <dd>
              {send.resend_email_id ? <code className={styles.code}>{send.resend_email_id}</code> : "None yet"}
            </dd>
            <dt>Attempts</dt>
            <dd>{send.attempts}</dd>
            {send.error && (
              <>
                <dt>Error</dt>
                <dd className={styles.prewrap}>{send.error}</dd>
              </>
            )}
          </>
        )}
      </dl>
    </section>
  );
}

function RevisionHistory({ view, now }: { view: DraftView; now: number }) {
  const items = [...view.revisions].reverse();
  return (
    <section className={styles.section} aria-labelledby="history-heading">
      <h3 id="history-heading" className={styles.sectionHeading}>
        Revision history
      </h3>
      <ol className={styles.history}>
        {items.map((r) => {
          const current = r.id === view.revision.id;
          return (
            <li key={r.id} className={styles.historyItem} aria-current={current ? "true" : undefined}>
              <span className={styles.historyTitle}>
                Revision {r.number}
                {current && <span className={styles.currentTag}> (current)</span>}
              </span>
              <code className={styles.hash} title={`Content hash ${r.content_hash}`}>
                {shortHash(r.content_hash)}
              </code>
              <time dateTime={r.created_at} title={absoluteTime(r.created_at)} className={styles.muted}>
                {relativeTime(r.created_at, now)}
              </time>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
