"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type DraftStatus, type DraftSummary } from "@/lib/client/api";
import { absoluteTime, relativeTime, STATUS_LABEL, STATUSES } from "@/lib/client/format";
import { Button } from "./Button";
import { Notice } from "./Notice";
import { StatusBadge } from "./StatusBadge";
import { usePolling } from "./usePolling";
import styles from "./DraftList.module.css";

const POLL_MS = 5000;

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; drafts: DraftSummary[] };

export function DraftList({
  status,
  selectedId,
  hrefFor,
  onStatusChange,
  refreshKey,
}: {
  status: DraftStatus | null;
  selectedId: string | null;
  hrefFor: (id: string) => string;
  onStatusChange: (status: DraftStatus | null) => void;
  /** Bumped by the detail pane after an action so the list refreshes at once. */
  refreshKey: number;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(
    async (showLoading: boolean) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      if (showLoading) setState({ kind: "loading" });
      try {
        const drafts = await api.listDrafts(status, controller.signal);
        setState({ kind: "ready", drafts });
        setNow(Date.now());
      } catch (e) {
        if (controller.signal.aborted) return;
        // During background polling, keep showing the last good list.
        setState((prev) =>
          showLoading || prev.kind !== "ready"
            ? { kind: "error", message: e instanceof ApiError ? e.message : "Could not load drafts." }
            : prev,
        );
      }
    },
    [status],
  );

  useEffect(() => {
    void load(true);
    return () => inFlight.current?.abort();
  }, [load]);

  useEffect(() => {
    if (refreshKey > 0) void load(false);
  }, [refreshKey, load]);

  usePolling(() => load(false), POLL_MS);

  return (
    <section className={styles.pane} aria-labelledby="drafts-heading">
      <div className={styles.head}>
        <h2 id="drafts-heading" className={styles.heading}>
          Drafts
        </h2>
        <label className={styles.filter}>
          <span className={styles.filterLabel}>Status</span>
          <select
            className={styles.select}
            value={status ?? "all"}
            onChange={(e) => onStatusChange(e.target.value === "all" ? null : (e.target.value as DraftStatus))}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
            <option value="all">All statuses</option>
          </select>
        </label>
      </div>

      {state.kind === "loading" && <LoadingRows />}

      {state.kind === "error" && (
        <div className={styles.message}>
          <Notice
            tone="error"
            title="Couldn't load drafts"
            actions={
              <Button size="sm" onClick={() => void load(true)}>
                Try again
              </Button>
            }
          >
            <p>{state.message}</p>
          </Notice>
        </div>
      )}

      {state.kind === "ready" && state.drafts.length === 0 && <Empty status={status} />}

      {state.kind === "ready" && state.drafts.length > 0 && (
        <ul className={styles.list}>
          {state.drafts.map((d) => (
            <li key={d.id}>
              <Link
                href={hrefFor(d.id)}
                scroll={false}
                className={styles.row}
                aria-current={d.id === selectedId ? "page" : undefined}
              >
                <span className={styles.rowTop}>
                  <span className={styles.subject}>{d.subject}</span>
                  <StatusBadge status={d.status} />
                </span>
                <span className={styles.rowBottom}>
                  <span className={styles.recipient}>
                    To {d.to[0]}
                    {d.to.length > 1 && <> +{d.to.length - 1} more</>}
                  </span>
                  <time dateTime={d.updated_at} title={absoluteTime(d.updated_at)} className={styles.time}>
                    {relativeTime(d.updated_at, now)}
                  </time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LoadingRows() {
  return (
    <div className={styles.loading} aria-busy="true">
      <p className={styles.loadingText}>Loading drafts…</p>
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.skeleton} aria-hidden="true">
          <span className={styles.skeletonLine} />
          <span className={`${styles.skeletonLine} ${styles.skeletonShort}`} />
        </div>
      ))}
    </div>
  );
}

function Empty({ status }: { status: DraftStatus | null }) {
  const pending = status === "pending_approval";
  return (
    <div className={styles.message}>
      <Notice tone="neutral" title={pending ? "Nothing waiting for review" : "No drafts here"}>
        <p>
          {pending
            ? "When an agent submits a draft for approval it appears here. This list refreshes every few seconds."
            : `There are no drafts with the status “${status ? STATUS_LABEL[status] : "any"}”.`}
        </p>
      </Notice>
    </div>
  );
}
