"use client";

import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { api, ApiError, type DraftView, type RecipientPage } from "@/lib/client/api";
import { formatCount, plural } from "@/lib/client/format";
import { useAnnounce } from "./Announcer";
import { Button } from "./Button";
import { Notice } from "./Notice";
import { Spinner } from "./Spinner";
import { StatusIcon } from "./StatusIcon";
import styles from "./Recipients.module.css";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

type Revision = DraftView["revision"];
type Item = RecipientPage["items"][number];

const ITEM_STATUS: Record<NonNullable<Item["status"]>, { label: string; tone: "success" | "error" | "neutral" }> = {
  sent: { label: "Sent", tone: "success" },
  failed: { label: "Failed", tone: "error" },
  pending: { label: "Pending", tone: "neutral" },
};

/**
 * The full recipient list of one revision, paged from the recipients
 * endpoint. Pinned to `revision.id`, so it never shows a newer revision's
 * list under an older revision's content.
 */
export function Recipients({
  draftId,
  revision,
  refreshKey,
}: {
  draftId: string;
  revision: Pick<Revision, "id" | "recipient_count" | "duplicates_removed">;
  /** Changes when send progress changes, so per-recipient status refreshes. */
  refreshKey?: string;
}) {
  const announce = useAnnounce();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<RecipientPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const rangeRef = useRef<HTMLParagraphElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Mirrors the native popover's state, so statuses only refresh while it is visible.
  const [open, setOpen] = useState(false);
  const popoverId = `${searchId}-popover`;
  const hasPage = useRef(false);
  const userAction = useRef(false);

  // Debounce typing; a new search starts at the first page.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query.trim());
      setOffset(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(
    async (background: boolean) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      if (!background) setLoading(true);
      try {
        const next = await api.listRecipients(
          draftId,
          { revisionId: revision.id, offset, limit: PAGE_SIZE, q: search || undefined },
          controller.signal,
        );
        setPage(next);
        hasPage.current = true;
        setError(null);
        if (userAction.current) {
          userAction.current = false;
          announce(describeRange(next, search));
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        if (!background) setError(e instanceof ApiError ? e.message : "Could not load recipients.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [draftId, revision.id, offset, search, announce],
  );

  // Nothing is fetched until the reviewer opens the list. Reopening (or a
  // new page or search) keeps the last page on screen while it refreshes.
  useEffect(() => {
    if (!open) return;
    void load(hasPage.current);
    return () => inFlight.current?.abort();
  }, [load, open]);

  // Only a progress change triggers this background refresh, not a change to
  // `load` or `open` (the effect above handles those).
  const refreshInBackground = useEffectEvent(() => {
    if (open) void load(true);
  });
  useEffect(() => {
    // A background load sets state only once the request settles, which the rule can't see.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (refreshKey) refreshInBackground();
  }, [refreshKey]);

  function go(nextOffset: number) {
    userAction.current = true;
    setOffset(nextOffset);
  }

  // If the button just pressed became disabled (first/last page), keep focus nearby.
  useEffect(() => {
    if (!page) return;
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement && active.disabled) rangeRef.current?.focus();
  }, [page]);

  const total = page?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.floor(offset / PAGE_SIZE) + 1;
  const showStatus = page?.items.some((i) => i.status !== null) ?? false;

  return (
    <section className={styles.recipients} aria-labelledby={`${searchId}-heading`}>
      <h3 id={`${searchId}-heading`} className={styles.heading}>
        Recipients <span className={styles.count}>({formatCount(revision.recipient_count)})</span>
      </h3>

      <dl className={styles.facts}>
        <div>
          <dt>Unique recipients</dt>
          <dd>{formatCount(revision.recipient_count)}</dd>
        </div>
        <div>
          <dt>Duplicates removed</dt>
          <dd>{formatCount(revision.duplicates_removed)}</dd>
        </div>
      </dl>

      <Button popoverTarget={popoverId} className={styles.open}>
        {revision.recipient_count === 1
          ? "View recipient"
          : `View all ${formatCount(revision.recipient_count)} recipients`}
      </Button>

      {/* Native popover: the browser handles showing, Escape, light dismiss and returning focus. */}
      <div
        id={popoverId}
        popover="auto"
        role="dialog"
        aria-labelledby={`${popoverId}-heading`}
        className={styles.popover}
        onToggle={(e) => {
          const isOpen = e.newState === "open";
          setOpen(isOpen);
          if (isOpen) searchRef.current?.focus();
        }}
      >
        <div className={styles.popoverHead}>
          <h4 id={`${popoverId}-heading`} className={styles.popoverHeading}>
            Recipients <span className={styles.count}>({formatCount(revision.recipient_count)})</span>
          </h4>
          <Button
            size="sm"
            variant="ghost"
            popoverTarget={popoverId}
            popoverTargetAction="hide"
            aria-keyshortcuts="Escape"
          >
            Close
            {/* Visual hint only; aria-keyshortcuts tells assistive tech. */}
            <kbd className={styles.kbd} aria-hidden="true">
              Esc
            </kbd>
          </Button>
        </div>

          <div className={styles.searchRow}>
            <label htmlFor={searchId} className={styles.searchLabel}>
              Search recipients
            </label>
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              className={styles.search}
              value={query}
              maxLength={254}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${searchId}-range`}
              onChange={(e) => {
                userAction.current = true;
                setQuery(e.target.value);
              }}
            />
          </div>

          {error ? (
            <Notice
              tone="error"
              headingLevel={4}
              title="Couldn't load recipients"
              actions={
                <Button size="sm" onClick={() => void load(false)}>
                  Try again
                </Button>
              }
            >
              <p>{error}</p>
            </Notice>
          ) : (
            <>
              <p id={`${searchId}-range`} ref={rangeRef} tabIndex={-1} className={styles.range}>
                {loading && <Spinner />}
                {page ? describeRange(page, search) : "Loading recipients…"}
              </p>

              {page && page.items.length > 0 && (
                <ol
                  className={styles.list}
                  start={page.offset + 1}
                  aria-busy={loading || undefined}
                  aria-label={`Recipients ${formatCount(page.offset + 1)} to ${formatCount(page.offset + page.items.length)}`}
                >
                  {page.items.map((item) => (
                    <li key={item.email} className={styles.item}>
                      <span className={styles.address}>{item.email}</span>
                      {showStatus && item.status && (
                        <span className={styles.itemStatus}>
                          <StatusIcon tone={ITEM_STATUS[item.status].tone} />
                          {ITEM_STATUS[item.status].label}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}

              {pages > 1 && (
                <nav className={styles.pager} aria-label="Recipient pages">
                  <Button size="sm" disabled={current <= 1 || loading} onClick={() => go(offset - PAGE_SIZE)}>
                    <span aria-hidden="true">←</span> Previous
                  </Button>
                  <span className={styles.pageOf}>
                    Page {formatCount(current)} of {formatCount(pages)}
                  </span>
                  <Button size="sm" disabled={current >= pages || loading} onClick={() => go(offset + PAGE_SIZE)}>
                    Next <span aria-hidden="true">→</span>
                  </Button>
                </nav>
              )}
            </>
          )}
      </div>
    </section>
  );
}

function describeRange(page: RecipientPage, search: string): string {
  if (page.total === 0) return search ? `No recipients match “${search}”.` : "No recipients.";
  const from = formatCount(page.offset + 1);
  const to = formatCount(page.offset + page.items.length);
  const of = search
    ? `${plural(page.total, "match", "matches")} for “${search}”`
    : formatCount(page.total);
  return page.items.length === 0 ? `Past the end of ${of}.` : `Showing ${from}–${to} of ${of}.`;
}
