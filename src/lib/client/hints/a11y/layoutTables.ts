import { severityFor, type Hint, type HintInput } from "../types";

/**
 * Rule 3 of the Email Markup Consortium's 2026 accessibility report: "Tables
 * used for formatting should have the role attribute set to presentation or
 * none" (Serious). Without it, screen readers announce layout tables as data
 * tables ("table, 3 rows, 2 columns…").
 *
 * A table is a data table if it says so with role="table", or if any of these
 * hold for its own rows and cells:
 *  - a cell has a scope attribute
 *  - it has more than one row AND more than one column (the most cells in any
 *    one row; colspan isn't counted)
 *  - it has a <thead>, <tfoot> or <caption>
 * Otherwise it is a layout table, and needs role="presentation" or "none".
 *
 * Emails nest tables inside tables, so every lookup starts from the table with
 * direct-child selectors (:scope > …): a nested table's rows and cells never
 * count towards the table around it.
 */
const OWN_ROWS = ":scope > tr, :scope > tbody > tr, :scope > thead > tr, :scope > tfoot > tr";
const OWN_CELLS = ":scope > td, :scope > th";
const OWN_STRUCTURE = ":scope > thead, :scope > tfoot, :scope > caption";

/**
 * The first token of role is the one that applies. ARIA role values are
 * lowercase, so "Table" or "NONE" don't count as the role.
 */
const role = (table: Element) => table.getAttribute("role")?.trim().split(/\s+/)[0];

export function isDataTable(table: Element): boolean {
  if (role(table) === "table") return true;
  if (table.querySelector(OWN_STRUCTURE)) return true;
  const rows = [...table.querySelectorAll(OWN_ROWS)];
  const cellsPerRow = rows.map((row) => [...row.querySelectorAll(OWN_CELLS)]);
  if (cellsPerRow.some((cells) => cells.some((cell) => cell.hasAttribute("scope")))) return true;
  const columns = Math.max(0, ...cellsPerRow.map((cells) => cells.length));
  return rows.length > 1 && columns > 1;
}

function isPresentational(table: Element): boolean {
  return role(table) === "presentation" || role(table) === "none";
}

export function layoutTableHints({ doc }: HintInput): Hint[] {
  const tables = [...doc.querySelectorAll("table")];
  const layout = tables.filter((t) => !isDataTable(t));
  const missing = layout.filter((t) => !isPresentational(t));
  if (missing.length === 0) return [];
  const nested = missing.filter((t) => t.parentElement?.closest("table")).length;
  return [
    {
      id: "a11y-layout-tables",
      severity: severityFor("serious"),
      rating: "serious",
      title: "Tables used for formatting should have the role attribute set to presentation or none",
      detail:
        `${missing.length} of ${layout.length} layout ${layout.length === 1 ? "table has" : "tables have"} no role="presentation" or role="none"` +
        `${nested > 0 ? ` (${nested} of them nested inside another table)` : ""}. ` +
        'A table counts as layout unless it has role="table", a scope attribute, more than one row and column, or a <thead>, <tfoot> or <caption>.',
      reviewNote:
        'Add role="presentation" to every table used for layout, so screen readers don\'t announce them as data tables.',
    },
  ];
}
