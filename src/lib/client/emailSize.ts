/**
 * Gmail clips messages whose HTML is over about 102 KB, hiding the rest behind
 * "View entire message". Tracking added at send time (pixels, rewritten links)
 * makes the sent email bigger than the draft, so warn well before the limit.
 * Shared by the size chip under the preview and the size review hint, so the
 * two always agree.
 */
export const GMAIL_CLIP_BYTES = 102 * 1024;
export const NEAR_CLIP_BYTES = 80 * 1024;

/** UTF-8 bytes: what is sent, and what Gmail measures. */
export function emailBytes(html: string): number {
  return new TextEncoder().encode(html).length;
}

/** One decimal place, with 1 KB = 1,024 bytes, as everywhere in the review UI. */
export function formatKilobytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export type ClipStatus = "near" | "over";

export function gmailClipStatus(bytes: number): ClipStatus | null {
  if (bytes >= GMAIL_CLIP_BYTES) return "over";
  if (bytes > NEAR_CLIP_BYTES) return "near";
  return null;
}

/** The size chip's tooltip, in the user's wording. */
export const CLIP_TIP: Record<ClipStatus, string> = {
  near: "file size is close to 102kb Gmail clipping limit. Email tracking codes may take this over the limit",
  over: "email code is over 102kb. This will get clipped in Gmail",
};
