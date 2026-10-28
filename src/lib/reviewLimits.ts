/**
 * The longest reject reason (the review notes). Shared by the server's
 * validation and the review UI. It is generous because "Add to review" can
 * put several hints' notes in at once.
 */
export const MAX_REASON_LENGTH = 10_000;
