const MAX_EXAMPLES = 3;
const MAX_LENGTH = 60;

/**
 * "a, b, c and 4 more": the first few values (long ones shortened), so the
 * reviewer and the agent can find them. Pass Infinity to keep values whole.
 */
export function examples(values: string[], maxLength = MAX_LENGTH): string {
  const shown = values.slice(0, MAX_EXAMPLES).map((v) => shorten(v, maxLength));
  const more = values.length > MAX_EXAMPLES ? ` and ${values.length - MAX_EXAMPLES} more` : "";
  return `${shown.join(", ")}${more}`;
}

/** The value, cut to `maxLength` characters with an ellipsis if longer. */
export const shorten = (value: string, maxLength = MAX_LENGTH) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}…` : value;
