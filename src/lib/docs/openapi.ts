/**
 * OpenAPI description of the AGENT API only. The review endpoints are for
 * humans and deliberately not described here.
 */
export function buildOpenApi(origin: string) {
  const idParam = {
    name: "id",
    in: "path",
    required: true,
    description: "Draft id, for example drf_0a1b2c3d...",
    schema: { type: "string" },
  };
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const json = (schema: object) => ({ "application/json": { schema } });
  const draftOk = (description: string) => ({
    description,
    content: json(ref("Draft")),
  });
  const error = (description: string) => ({
    description,
    content: json(ref("Error")),
  });
  const body = (name: string) => ({ required: true, content: json(ref(name)) });

  const unauthorized = error(
    "Missing or invalid agent API key (code `unauthorized`).",
  );
  const forbidden = error(
    "A reviewer credential was used on an agent endpoint (code `wrong_credential_type`).",
  );
  const notFound = error("No draft with that id (code `not_found`).");
  const invalid = error(
    "Invalid body or query (code `validation_error`, with an `issues` array) or invalid JSON (`invalid_json`).",
  );

  const recipients = (description: string, minItems = 0) => ({
    type: "array",
    description,
    minItems,
    maxItems: 50,
    items: { type: "string", format: "email" },
  });
  const contentProps = {
    to: recipients("Primary recipients. Plain addresses only, not 'Name <a@b.com>'.", 1),
    cc: recipients("Optional cc recipients."),
    bcc: recipients("Optional bcc recipients."),
    subject: {
      type: "string",
      minLength: 1,
      maxLength: 998,
      description: "Single line, no line breaks.",
    },
    html: {
      type: "string",
      minLength: 1,
      description:
        "The full HTML body. There is no separate plain-text part and no attachments.",
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Email approval service (agent API)",
      version: "1.0.0",
      description:
        "Agents prepare email drafts; a human reviews the exact recipients and content and approves or rejects; approved emails are sent through Resend. " +
        "Agents can create, revise and submit drafts and read their status. Agents can NOT approve, reject, retry or send: those need a human reviewer credential and the key you use here is refused on those routes. " +
        "Changing a draft creates a new revision, and a new revision needs a new approval. " +
        "Start with " +
        origin +
        "/SKILL.md for the workflow and examples.",
    },
    servers: [{ url: origin }],
    security: [{ agentKey: [] }],
    paths: {
      "/api/agent/drafts": {
        post: {
          operationId: "createDraft",
          summary: "Create a draft",
          description:
            "Creates the draft with revision 1 in status `draft`. Nothing is sent. Not idempotent: if a request times out, list drafts before retrying to avoid duplicates.",
          requestBody: body("CreateDraftRequest"),
          responses: {
            "201": draftOk("The new draft, including `next_actions`."),
            "400": invalid,
            "401": unauthorized,
            "403": forbidden,
          },
        },
        get: {
          operationId: "listDrafts",
          summary: "List drafts",
          description: "Most recently updated first (up to 50).",
          parameters: [
            {
              name: "status",
              in: "query",
              required: false,
              description: "Only drafts in this status.",
              schema: ref("DraftStatus"),
            },
          ],
          responses: {
            "200": {
              description: "Draft summaries.",
              content: json({
                type: "object",
                required: ["drafts"],
                properties: {
                  drafts: { type: "array", items: ref("DraftSummary") },
                },
              }),
            },
            "400": invalid,
            "401": unauthorized,
            "403": forbidden,
          },
        },
      },
      "/api/agent/drafts/{id}": {
        get: {
          operationId: "getDraft",
          summary: "Get a draft, its review decision and its send status",
          description:
            "Poll this to learn what happened. `status` is the summary; `review` and `send` give the detail; `next_actions` says what you can do next.",
          parameters: [idParam],
          responses: {
            "200": draftOk("The draft."),
            "401": unauthorized,
            "403": forbidden,
            "404": notFound,
          },
        },
        put: {
          operationId: "reviseDraft",
          summary: "Revise a draft",
          description:
            "Creates a new revision. Omitted fields keep their current value. Returns the draft to status `draft`, withdrawing any pending approval request; submit it again afterwards. Not allowed once the draft is approved or sent (409 `draft_locked`). Sending identical content is a no-op (409 `no_changes` if the draft was rejected or failed).",
          parameters: [idParam],
          requestBody: body("ReviseDraftRequest"),
          responses: {
            "200": draftOk("The draft with its new current revision."),
            "400": invalid,
            "401": unauthorized,
            "403": forbidden,
            "404": notFound,
            "409": error("`draft_locked` or `no_changes`."),
          },
        },
      },
      "/api/agent/drafts/{id}/submit": {
        post: {
          operationId: "submitDraft",
          summary: "Submit the current revision for human approval",
          description:
            "Moves the draft to `pending_approval`. You must pass the id of the current revision, so you can't submit something other than what you last read. Submitting twice is harmless.",
          parameters: [idParam],
          requestBody: body("SubmitRequest"),
          responses: {
            "200": draftOk("The draft, now `pending_approval`."),
            "400": invalid,
            "401": unauthorized,
            "403": forbidden,
            "404": notFound,
            "409": error(
              "`revision_changed` (GET the draft and use its current revision id) or `invalid_state` (e.g. a rejected draft must be revised first).",
            ),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        agentKey: {
          type: "http",
          scheme: "bearer",
          description: "The agent API key you were given.",
        },
      },
      schemas: {
        CreateDraftRequest: {
          type: "object",
          additionalProperties: false,
          required: ["to", "subject", "html"],
          properties: contentProps,
        },
        ReviseDraftRequest: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          description: "Any subset of the draft fields.",
          properties: contentProps,
        },
        SubmitRequest: {
          type: "object",
          additionalProperties: false,
          required: ["revision_id"],
          properties: {
            revision_id: {
              type: "string",
              description: "`revision.id` from the latest GET of the draft.",
            },
          },
        },
        DraftStatus: {
          type: "string",
          enum: [
            "draft",
            "pending_approval",
            "approved",
            "rejected",
            "sent",
            "failed",
          ],
          description:
            "draft: not submitted. pending_approval: waiting for a human. approved: approved, send in progress. rejected: a human rejected it (see review.reason). sent: delivered to Resend. failed: approved but the send failed (see send.error); a human can retry.",
        },
        Revision: {
          type: "object",
          properties: {
            id: { type: "string" },
            number: { type: "integer" },
            ...contentProps,
            content_hash: {
              type: "string",
              description: "SHA-256 of the content a human approves.",
            },
            created_at: { type: "string", format: "date-time" },
          },
        },
        Draft: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: ref("DraftStatus"),
            revision: {
              ...ref("Revision"),
              description: "The current revision.",
            },
            review: {
              type: ["object", "null"],
              description:
                "The human decision on the current revision, or null if none yet.",
              properties: {
                decision: { type: "string", enum: ["approved", "rejected"] },
                reason: { type: ["string", "null"] },
                decided_at: { type: "string", format: "date-time" },
              },
            },
            send: {
              type: ["object", "null"],
              description:
                "Send state of the current revision, or null if it was never approved.",
              properties: {
                status: { type: "string", enum: ["sending", "sent", "failed"] },
                resend_email_id: { type: ["string", "null"] },
                error: { type: ["string", "null"] },
                attempts: { type: "integer" },
                updated_at: { type: "string", format: "date-time" },
              },
            },
            revisions: {
              type: "array",
              description: "History of all revisions, oldest first.",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  number: { type: "integer" },
                  content_hash: { type: "string" },
                  created_at: { type: "string", format: "date-time" },
                },
              },
            },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
            next_actions: { type: "array", items: ref("NextAction") },
          },
        },
        DraftSummary: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: ref("DraftStatus"),
            revision_number: { type: "integer" },
            subject: { type: "string" },
            to: { type: "array", items: { type: "string" } },
            updated_at: { type: "string", format: "date-time" },
          },
        },
        NextAction: {
          type: "object",
          required: ["action", "description"],
          properties: {
            action: { type: "string" },
            description: { type: "string" },
            method: { type: "string" },
            path: { type: "string" },
            body: { type: "object", additionalProperties: { type: "string" } },
          },
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                hint: { type: "string", description: "What to do next." },
                issues: {
                  type: "array",
                  description: "Present for `validation_error`.",
                  items: {
                    type: "object",
                    properties: {
                      path: { type: "string" },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
