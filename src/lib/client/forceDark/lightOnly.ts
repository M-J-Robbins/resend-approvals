/**
 * Gmail on Android applies the same forced dark as Android, with one
 * exception: an email that declares <meta name="color-scheme" content="light only">
 * is left exactly as it is. No other value changes anything, not even
 * "only light" or "light".
 */
export function isLightOnly(content: string): boolean {
  return content.trim().replace(/\s+/g, " ").toLowerCase() === "light only";
}

/**
 * Whether the email's HTML opts out of Gmail's forced dark. DOMParser builds an
 * inert document (no scripts run, nothing loads), so this only reads data.
 */
export function optsOutOfGmailForcedDark(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("meta[name]")].some(
    (meta) => meta.getAttribute("name")?.trim().toLowerCase() === "color-scheme" && isLightOnly(meta.getAttribute("content") ?? ""),
  );
}
