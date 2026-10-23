/**
 * The recipient cap as shown in the docs. Read straight from process.env (like
 * SANDBOX_RECIPIENT) so a docs request never fails on unrelated missing config;
 * the API itself enforces the value parsed in env.ts.
 */
export function docsMaxRecipients(): number {
  const n = Number(process.env.MAX_RECIPIENTS);
  return Number.isInteger(n) && n > 0 ? n : 5000;
}
