/** The service's default cap; a deployment can set MAX_RECIPIENTS lower. */
export const DEFAULT_MAX_RECIPIENTS = 5000;

/**
 * The recipient cap as shown in the docs. Read straight from process.env so a
 * docs request never fails on unrelated missing config;
 * the API itself enforces the value parsed in env.ts.
 */
export function docsMaxRecipients(): number {
  const n = Number(process.env.MAX_RECIPIENTS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_RECIPIENTS;
}
