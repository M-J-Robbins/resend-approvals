/**
 * Browser-side client for the reviewer API. The UI talks to the server only
 * through these /api/review/* calls; it never imports services or the DB.
 */
import type { DraftView, listDrafts, listRecipients, SendProgress } from "@/services/drafts";
import type { ResumeResult } from "@/services/review";

export type { DraftView, ResumeResult, SendProgress };
export type DraftStatus = DraftView["status"];
export type DraftSummary = Awaited<ReturnType<typeof listDrafts>>[number];
export type RecipientPage = Awaited<ReturnType<typeof listRecipients>>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

/** The agent changed the draft after the reviewer opened it. */
export const isConflict = (e: unknown): boolean =>
  e instanceof ApiError &&
  (e.code === "revision_changed" ||
    e.code === "content_hash_mismatch" ||
    e.code === "recipient_count_mismatch");

let onUnauthorized: (() => void) | null = null;

/** Called whenever a request comes back 401, so the app can return to sign-in. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function request<T>(
  path: string,
  opts: { method?: string; json?: unknown; signal?: AbortSignal; handle401?: boolean } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: opts.signal,
      headers: opts.json === undefined ? undefined : { "content-type": "application/json" },
      body: opts.json === undefined ? undefined : JSON.stringify(opts.json),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "network_error", "Could not reach the server.", "Check your connection and try again.");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error;
    if (res.status === 401 && opts.handle401 !== false) onUnauthorized?.();
    throw new ApiError(
      res.status,
      err?.code ?? "http_error",
      err?.message ?? `The request failed (HTTP ${res.status}).`,
      err?.hint,
      Array.isArray(err?.issues) ? err.issues : [],
    );
  }
  return data as T;
}

const draftPath = (id: string) => `/api/review/drafts/${encodeURIComponent(id)}`;

export const api = {
  /** Resolves if the session cookie is valid; rejects with a 401 ApiError if not. */
  checkSession: () =>
    request<{ authenticated: boolean }>("/api/review/session", { handle401: false }),

  signIn: (token: string) =>
    request<{ authenticated: boolean }>("/api/review/session", {
      method: "POST",
      json: { token },
      handle401: false,
    }),

  signOut: () =>
    request<{ authenticated: boolean }>("/api/review/session", { method: "DELETE", handle401: false }),

  listDrafts: (status: DraftStatus | null, signal?: AbortSignal) =>
    request<{ drafts: DraftSummary[] }>(
      `/api/review/drafts${status ? `?status=${status}` : ""}`,
      { signal },
    ).then((r) => r.drafts),

  getDraft: (id: string, signal?: AbortSignal) => request<DraftView>(draftPath(id), { signal }),

  /** Answers 202 once the send job exists; sending continues in the background. */
  approve: (id: string, revision: { id: string; content_hash: string; recipient_count: number }) =>
    request<DraftView>(`${draftPath(id)}/approve`, {
      method: "POST",
      json: {
        revision_id: revision.id,
        content_hash: revision.content_hash,
        recipient_count: revision.recipient_count,
      },
    }),

  reject: (id: string, revisionId: string, reason: string) =>
    request<DraftView>(`${draftPath(id)}/reject`, {
      method: "POST",
      json: { revision_id: revisionId, reason },
    }),

  resume: (id: string) => request<ResumeResult>(`${draftPath(id)}/resume`, { method: "POST" }),

  listRecipients: (
    id: string,
    query: { revisionId: string; offset: number; limit: number; q?: string },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({
      revision_id: query.revisionId,
      offset: String(query.offset),
      limit: String(query.limit),
    });
    if (query.q) params.set("q", query.q);
    return request<RecipientPage>(`${draftPath(id)}/recipients?${params}`, { signal });
  },
};
