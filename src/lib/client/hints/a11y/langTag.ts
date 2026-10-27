/**
 * Is this a valid HTML lang value? It must be a well-formed language tag
 * (so "en_US" fails) whose primary language is a known one (so "english" and
 * "zz" fail). Both checks use the browser's built-in locale data. Case doesn't
 * matter ("EN-us" is fine). "und" (undetermined) is handled by the caller.
 */
export function isValidLangTag(value: string): boolean {
  let canonical: string;
  try {
    [canonical] = Intl.getCanonicalLocales(value.trim());
  } catch {
    return false;
  }
  if (!canonical) return false;
  const primary = canonical.split("-")[0];
  return new Intl.DisplayNames(["en"], { type: "language", fallback: "none" }).of(primary) !== undefined;
}
