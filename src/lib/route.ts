import { after } from "next/server";
import { AppError, errorResponse } from "./errors";
import { agentNextActions, type DraftView } from "@/services/drafts";
import { processSends } from "@/services/review";

/** Next.js 15+ passes route params as a promise. */
export type IdContext = { params: Promise<{ id: string }> };

/** Turns anything thrown by a handler into the standard JSON error response. */
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    return errorResponse(e);
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError(
      400,
      "invalid_json",
      "The request body must be valid JSON.",
      "Send 'Content-Type: application/json' and a JSON object as the body.",
    );
  }
}

/** Agent responses always carry next_actions. */
export function agentJson(
  view: DraftView,
  status = 200,
  headers?: HeadersInit,
): Response {
  return Response.json(
    { ...view, next_actions: agentNextActions(view) },
    { status, headers },
  );
}

/**
 * Runs the send worker after the response has gone out. It shares the
 * route's maxDuration (300s); processSends stops itself at 240s and a later
 * resume picks up whatever is left.
 */
export function sendInBackground(draftId: string): void {
  after(async () => {
    try {
      await processSends(draftId);
    } catch (e) {
      console.error(`processSends(${draftId}) failed`, e);
    }
  });
}
