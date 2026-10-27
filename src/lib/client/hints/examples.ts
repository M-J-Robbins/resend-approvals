const MAX_EXAMPLES = 3;
const MAX_LENGTH = 60;

/**
 * "a, b, c and 4 more": the first few values (long ones shortened), so the
 * reviewer and the agent can find them. Pass Infinity to keep values whole.
 */
export function examples(values: string[], maxLength = MAX_LENGTH): string {
  const shown = values.slice(0, MAX_EXAMPLES).map((v) => (v.length > maxLength ? `${v.slice(0, maxLength - 3)}…` : v));
  const more = values.length > MAX_EXAMPLES ? ` and ${values.length - MAX_EXAMPLES} more` : "";
  return `${shown.join(", ")}${more}`;
}
