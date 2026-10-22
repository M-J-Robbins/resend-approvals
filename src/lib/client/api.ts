/**
 * Browser-side client for the reviewer API. The UI talks to the server only
 * through these /api/review/* calls; it never imports services or the DB.
 */
import type { DraftView, listDrafts } from "@/services/drafts";

export type { DraftView };
export type DraftStatus = DraftView["status"];
export type DraftSummary = Awaited<ReturnType<typeof listDrafts>>[number];

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
export const isConflict = (e: unknown): e is ApiError =>
  e instanceof ApiError &&
  (e.code === "revision_changed" || e.code === "content_hash_mismatch");

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

  approve: (id: string, revisionId: string, contentHash: string) =>
    request<DraftView>(`${draftPath(id)}/approve`, {
      method: "POST",
      json: { revision_id: revisionId, content_hash: contentHash },
    }),

  reject: (id: string, revisionId: string, reason: string) =>
    request<DraftView>(`${draftPath(id)}/reject`, {
      method: "POST",
      json: { revision_id: revisionId, reason },
    }),

  retrySend: (id: string) => request<DraftView>(`${draftPath(id)}/retry-send`, { method: "POST" }),
};
