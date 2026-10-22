"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DraftStatus } from "@/lib/client/api";
import { STATUSES } from "@/lib/client/format";
import { Button } from "./Button";
import { DraftDetail } from "./DraftDetail";
import { DraftList } from "./DraftList";
import styles from "./Workspace.module.css";

const DEFAULT_STATUS: DraftStatus = "pending_approval";

/** Reads ?status=: absent means the default, "all" means no filter. */
function parseStatus(raw: string | null): DraftStatus | null {
  if (raw === "all") return null;
  return STATUSES.includes(raw as DraftStatus) ? (raw as DraftStatus) : DEFAULT_STATUS;
}

export function Workspace({ onSignOut }: { onSignOut: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("draft");
  const status = parseStatus(params.get("status"));
  const [refreshKey, setRefreshKey] = useState(0);
  // A draft opened from the URL on page load keeps normal focus order;
  // one picked from the list gets focus moved to it.
  const [initialDraft] = useState(selectedId);

  const href = useCallback(
    (next: { draft?: string | null; status?: DraftStatus | null }) => {
      const q = new URLSearchParams();
      const s = next.status === undefined ? status : next.status;
      if (s !== DEFAULT_STATUS) q.set("status", s ?? "all");
      const d = next.draft === undefined ? selectedId : next.draft;
      if (d) q.set("draft", d);
      const qs = q.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, selectedId, status],
  );

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>Email approvals</h1>
        <Button size="sm" variant="ghost" onClick={onSignOut}>
          Sign out
        </Button>
      </header>
      <main className={styles.main} data-view={selectedId ? "detail" : "list"}>
        <div className={styles.listPane}>
          <DraftList
            status={status}
            selectedId={selectedId}
            hrefFor={(id) => href({ draft: id })}
            onStatusChange={(s) => router.replace(href({ status: s }), { scroll: false })}
            refreshKey={refreshKey}
          />
        </div>
        <div className={styles.detailPane}>
          {selectedId ? (
            <DraftDetail
              key={selectedId}
              id={selectedId}
              backHref={href({ draft: null })}
              onChanged={() => setRefreshKey((k) => k + 1)}
              focusOnLoad={selectedId !== initialDraft}
            />
          ) : (
            <div className={styles.placeholder}>
              <p>Select a draft to review its recipients and content.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
