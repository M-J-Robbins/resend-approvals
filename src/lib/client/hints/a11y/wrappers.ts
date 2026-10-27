import { severityFor, type Hint, type HintInput } from "../types";
import { isValidLangTag } from "./langTag";

/**
 * Rules 1 and 2 of the Email Markup Consortium's 2026 accessibility report:
 * "Content inside the body should be wrapped in a dir attribute" and "… a lang
 * attribute" (both Serious). Many email clients strip the attributes on <html>
 * and <body>, so every direct child of <body> has to carry them itself; those
 * on <html> and <body> don't count.
 *
 * Skipped: <script>, <style>, images with alt="" (decorative), comments and
 * whitespace. Text sitting directly in <body> can't carry an attribute, so it
 * counts as unwrapped.
 */
type Child = { label: string; attr: (name: string) => string | null };

function bodyContent(doc: Document): Child[] {
  const children: Child[] = [];
  for (const node of doc.body?.childNodes ?? []) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent?.trim()) children.push({ label: "text", attr: () => null });
      continue;
    }
    if (!(node instanceof Element)) continue;
    const tag = node.tagName.toLowerCase();
    if (tag === "script" || tag === "style") continue;
    if (tag === "img" && node.getAttribute("alt") === "") continue;
    children.push({ label: `<${tag}>`, attr: (name) => node.getAttribute(name) });
  }
  return children;
}

/** "<table>, <div> and text", with repeats counted: "<div> ×2". */
function describe(children: Child[]): string {
  const counts = new Map<string, number>();
  for (const c of children) counts.set(c.label, (counts.get(c.label) ?? 0) + 1);
  const parts = [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
}

const ofTotal = (failing: Child[], total: number) =>
  `${failing.length} of ${total} ${total === 1 ? "item" : "items"} directly inside <body>`;

export function wrapperDirHints({ doc }: HintInput): Hint[] {
  const children = bodyContent(doc);
  const dir = (c: Child) => c.attr("dir")?.trim().toLowerCase();
  const missing = children.filter((c) => dir(c) !== "ltr" && dir(c) !== "rtl" && dir(c) !== "auto");
  const auto = children.filter((c) => dir(c) === "auto");
  const hints: Hint[] = [];
  if (missing.length > 0) {
    hints.push({
      id: "a11y-wrapper-dir",
      severity: severityFor("serious"),
      rating: "serious",
      title: "Content inside the body should be wrapped in a dir attribute",
      detail: `${ofTotal(missing, children.length)} ${missing.length === 1 ? "has" : "have"} no dir of ltr or rtl: ${describe(missing)}. Email clients often strip dir from <html> and <body>, so the content needs its own wrapper.`,
      reviewNote:
        'Wrap all the content inside <body> in an element with a dir attribute, for example <div dir="ltr">, so screen readers and clients that strip <html> and <body> attributes read it in the right direction.',
    });
  }
  if (auto.length > 0) {
    hints.push({
      id: "a11y-wrapper-dir-auto",
      severity: severityFor("mild"),
      rating: "mild",
      title: "Explicitly defining a direction is preferred",
      detail: `${ofTotal(auto, children.length)} ${auto.length === 1 ? "uses" : "use"} dir="auto": ${describe(auto)}. Setting ltr or rtl is preferred when the direction is known.`,
      reviewNote: 'Replace dir="auto" on the content wrapper with the actual direction, dir="ltr" or dir="rtl".',
    });
  }
  return hints;
}

export function wrapperLangHints({ doc }: HintInput): Hint[] {
  const children = bodyContent(doc);
  const lang = (c: Child) => c.attr("lang")?.trim() ?? "";
  const isUnd = (c: Child) => lang(c).toLowerCase() === "und";
  const missing = children.filter((c) => !isUnd(c) && !isValidLangTag(lang(c)));
  const undetermined = children.filter(isUnd);
  const hints: Hint[] = [];
  if (missing.length > 0) {
    const invalid = missing.filter((c) => lang(c) !== "").map((c) => `lang="${lang(c)}"`);
    hints.push({
      id: "a11y-wrapper-lang",
      severity: severityFor("serious"),
      rating: "serious",
      title: "Content inside the body should be wrapped in a lang attribute",
      detail: `${ofTotal(missing, children.length)} ${missing.length === 1 ? "has" : "have"} no valid lang: ${describe(missing)}.${invalid.length ? ` Not valid language tags: ${[...new Set(invalid)].join(", ")}.` : ""} Email clients often strip lang from <html> and <body>, so the content needs its own wrapper.`,
      reviewNote:
        'Wrap all the content inside <body> in an element with a valid lang attribute, for example <div lang="en">, so screen readers pronounce it in the right language.',
    });
  }
  if (undetermined.length > 0) {
    hints.push({
      id: "a11y-wrapper-lang-und",
      severity: severityFor("mild"),
      rating: "mild",
      title: "Explicitly defining a language is preferred",
      detail: `${ofTotal(undetermined, children.length)} ${undetermined.length === 1 ? "uses" : "use"} lang="und" (undetermined): ${describe(undetermined)}. Setting the actual language is preferred when it is known.`,
      reviewNote: 'Replace lang="und" on the content wrapper with the email\'s actual language, for example lang="en".',
    });
  }
  return hints;
}
