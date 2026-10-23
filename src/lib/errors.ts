import { ZodError } from "zod";

/**
 * Errors are written for agents: a stable `code`, a plain-English `message`,
 * and a `hint` saying what to do next.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint?: string,
    /** Extra machine-readable fields merged into the error object. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what: string, id: string) =>
  new AppError(404, "not_found", `${what} '${id}' was not found.`);

export const conflict = (code: string, message: string, hint?: string) =>
  new AppError(409, code, message, hint);

export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    return Response.json(
      { error: { code: e.code, message: e.message, hint: e.hint, ...e.details } },
      { status: e.status },
    );
  }
  if (e instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "validation_error",
          message: "The request body is invalid.",
          issues: e.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      },
      { status: 400 },
    );
  }
  console.error(e);
  return Response.json(
    { error: { code: "internal_error", message: "Unexpected server error." } },
    { status: 500 },
  );
}
