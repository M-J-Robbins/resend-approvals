import { CLIP_TIP, emailBytes, formatKilobytes, gmailClipStatus } from "../emailSize";
import type { Hint, HintInput } from "./types";

/** Gmail clipping. The same thresholds and wording as the size chip under the preview. */
export function sizeHints({ html }: HintInput): Hint[] {
  const bytes = emailBytes(html);
  const status = gmailClipStatus(bytes);
  if (!status) return [];
  const size = formatKilobytes(bytes);
  return [
    status === "over"
      ? {
          id: "size",
          severity: "error",
          title: `Over Gmail's 102 KB limit (${size})`,
          detail: CLIP_TIP.over,
          reviewNote: `The email's HTML is ${size}, over Gmail's 102 KB limit, so Gmail will clip it. Reduce the HTML size.`,
        }
      : {
          id: "size",
          severity: "warning",
          title: `Close to Gmail's 102 KB limit (${size})`,
          detail: CLIP_TIP.near,
          reviewNote: `The email's HTML is ${size}, close to Gmail's 102 KB limit; tracking added when it is sent may take it over and get it clipped. Reduce the HTML size.`,
        },
  ];
}
