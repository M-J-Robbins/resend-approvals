import type { DraftStatus } from "./api";

export const STATUSES: DraftStatus[] = [
  "pending_approval",
  "approved",
  "sent",
  "failed",
  "rejected",
  "draft",
];

/** Words for every status; the badge colour only reinforces these. */
export const STATUS_LABEL: Record<DraftStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Sending",
  rejected: "Rejected",
  sent: "Sent",
  failed: "Send failed",
};

export const shortHash = (hash: string) => hash.slice(0, 8);

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const absolute = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "2 minutes ago", "yesterday", "just now". */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  if (Math.abs(seconds) < 45) return "just now";
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return relative.format(Math.round(seconds / 60), "minute");
}

export const absoluteTime = (iso: string) => absolute.format(new Date(iso));

const integer = new Intl.NumberFormat("en");

/** 4812 → "4,812". */
export const formatCount = (n: number) => integer.format(n);

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${formatCount(n)} ${n === 1 ? one : many}`;

/** Digits only, so "4,812", "4812" and "4 812" all match 4812. */
export const parseCount = (text: string): number | null => {
  const digits = text.replace(/[\s,._]/g, "");
  return /^\d+$/.test(digits) ? Number(digits) : null;
};

export function formatBytes(n: number): string {
  if (n < 1024) return plural(n, "byte");
  return `${(n / 1024).toFixed(1)} KB`;
}
