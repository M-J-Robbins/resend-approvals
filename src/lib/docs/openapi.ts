/**
 * OpenAPI description of the AGENT API only. The review endpoints are for
 * humans and deliberately not described here.
 */
export function buildOpenApi(origin: string, maxRecipients: number) {
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
  const notFound = error("No draft (or revision) with that id (code `not_found`).");
  const invalid = error(
    "Invalid body or query (code `validation_error`, with an `issues` array or a `hint`) or invalid JSON (`invalid_json`).",
  );
  const contentInvalid = error(
    "`validation_error` (bad body; `to`, `cc` and `bcc` are refused with a hint to send `recipients`), " +
      "`invalid_recipients` (lists up to 20 bad addresses with their array index in `invalid`), " +
      `\`too_many_recipients\` (more than ${maxRecipients} unique addresses), \`no_recipients\` (empty list), or \`invalid_json\`.`,
  );

  const recipients = {
    type: "array",
    minItems: 1,
    description:
      `Every address receives its own individual copy of the email (no shared To, no cc, no bcc). ` +
      `Plain addresses only, not 'Name <a@b.com>'. Stored canonicalised: trimmed, lowercased, de-duplicated and sorted, so order and case don't matter. ` +
      `At most ${maxRecipients} unique addresses. One invalid address rejects the whole request; nothing is dropped silently.`,
    items: { type: "string", format: "email", maxLength: 254 },
  };
  const subject = {
    type: "string",
    minLength: 1,
    maxLength: 998,
    description: "Single line, no line breaks. The same for every recipient.",
  };
  const html = {
    type: "string",
    minLength: 1,
    maxLength: 1_000_000,
    description:
      "The full HTML body, identical for every recipient (no merge variables). There is no separate plain-text part and no attachments.",
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Email approval service (agent API)",
      version: "2.0.0",
      description:
        "Agents prepare email drafts; a human reviews the exact recipient list and content and approves or rejects; approved emails are sent through Resend. " +
        `A draft has ONE recipients list (up to ${maxRecipients}); each recipient receives an individual copy of the same email. ` +
        "Agents can create, revise and submit drafts, read their status and send progress, and page through recipients. Agents can NOT approve, reject, send or resume a failed send: those need a human reviewer credential and the key you use here is refused on those routes. " +
        "Changing a draft creates a new revision, and a new revision needs a new approval. " +
        "Sending is asynchronous and happens in batches after approval; `sent` means accepted by Resend, not delivered. " +
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
            "Creates the draft with revision 1 in status `draft`. Nothing is sent. The response reports `revision.duplicates_removed`. Not idempotent: if a request times out, list drafts before retrying to avoid duplicates.",
          requestBody: body("CreateDraftRequest"),
          responses: {
            "201": draftOk("The new draft, including `next_actions`."),
            "400": contentInvalid,
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
          summary: "Get a draft, its review decision and its send progress",
          description:
            "Poll this to learn what happened. `status` is the summary; `review` and `send` give the detail; `next_actions` says what you can do next. Recipients are not returned inline beyond `revision.recipients_preview`; use the recipients endpoint for the full list.",
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
            "Creates a new revision. Omitted fields keep their current value; a provided `recipients` list replaces the whole list. Returns the draft to status `draft`, withdrawing any pending approval request; submit it again afterwards. Not allowed while the draft is approved (sending) or sent (409 `draft_locked`). Sending identical content (including the same recipient set in another order or case) is a no-op (409 `no_changes` if the draft was rejected or failed). Revising a partially sent draft sends the new revision to its whole list, so recipients who were already sent would get a second email.",
          parameters: [idParam],
          requestBody: body("ReviseDraftRequest"),
          responses: {
            "200": draftOk("The draft with its new current revision."),
            "400": contentInvalid,
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
      "/api/agent/drafts/{id}/recipients": {
        get: {
          operationId: "listRecipients",
          summary: "Page through a revision's recipients and their send status",
          description:
            "Recipients in canonical (sorted, lowercase) order. Before approval every `status` is null. After approval each recipient is `pending` (not yet attempted, or in flight), `sent` (accepted by Resend; `resend_email_id` is set) or `failed`. Page with `offset` and `limit` until `offset + items.length >= total`.",
          parameters: [
            idParam,
            {
              name: "offset",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 0, default: 0 },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 500, default: 50 },
            },
            {
              name: "q",
              in: "query",
              required: false,
              description: "Case-insensitive substring match on the address.",
              schema: { type: "string", maxLength: 254 },
            },
            {
              name: "status",
              in: "query",
              required: false,
              description: "Only recipients with this send status. Only allowed once the draft has been approved (400 `validation_error` before).",
              schema: { type: "string", enum: ["pending", "sent", "failed"] },
            },
            {
              name: "revision_id",
              in: "query",
              required: false,
              description: "A revision of this draft. Defaults to the current revision.",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "One page of recipients.",
              content: json(ref("RecipientPage")),
            },
            "400": invalid,
            "401": unauthorized,
            "403": forbidden,
            "404": notFound,
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
          required: ["recipients", "subject", "html"],
          properties: { recipients, subject, html },
        },
        ReviseDraftRequest: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          description: "Any subset of the draft fields. `recipients`, if given, replaces the whole list.",
          properties: { recipients, subject, html },
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
            "draft: not submitted. pending_approval: waiting for a human. approved: approved; sending in progress (see send). rejected: a human rejected it (see review.reason). sent: Resend accepted every email (accepted, not necessarily delivered). failed: sending finished with at least one failed batch, possibly after others succeeded (send.partial); a human can resume it.",
        },
        Revision: {
          type: "object",
          properties: {
            id: { type: "string" },
            number: { type: "integer" },
            recipient_count: { type: "integer", description: "Unique recipients; each gets an individual email." },
            recipients_preview: {
              type: "array",
              items: { type: "string" },
              description: "The first 10 recipients in sorted order. Use the recipients endpoint for the rest.",
            },
            duplicates_removed: {
              type: "integer",
              description: "Duplicates (after trimming and lowercasing) collapsed from the list you sent for this revision.",
            },
            subject: { type: "string" },
            html: { type: "string" },
            content_hash: {
              type: "string",
              description: "SHA-256 of the recipient set, subject and html: what a human approves.",
            },
            created_at: { type: "string", format: "date-time" },
          },
        },
        SendProgress: {
          type: ["object", "null"],
          description:
            "Sending progress of the current revision, or null if it was never approved. Recipients are sent in batches (chunks) of up to 100. `sent` counts mean accepted by Resend, not delivered.",
          properties: {
            status: { type: "string", enum: ["sending", "sent", "failed"] },
            recipients_total: { type: "integer" },
            recipients_sent: { type: "integer" },
            recipients_failed: { type: "integer" },
            recipients_pending: { type: "integer", description: "Not yet attempted, or in flight." },
            chunks_total: { type: "integer" },
            chunks_sent: { type: "integer" },
            chunks_failed: { type: "integer" },
            chunks_pending: { type: "integer" },
            partial: { type: "boolean", description: "True if some recipients were sent and some failed." },
            errors: {
              type: "array",
              description: "Failed chunks, lowest index first (at most 20).",
              items: {
                type: "object",
                properties: {
                  chunk_index: { type: "integer" },
                  first_recipient: { type: "string" },
                  last_recipient: { type: "string" },
                  recipient_count: { type: "integer" },
                  error: { type: ["string", "null"], description: "Resend's error, or why the outcome is unknown." },
                  attempts: { type: "integer" },
                  resumable: {
                    type: "boolean",
                    description: "false if the outcome is unknown and too old (23h) to retry without risking a duplicate.",
                  },
                },
              },
            },
            updated_at: { type: "string", format: "date-time" },
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
            send: ref("SendProgress"),
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
            recipient_count: { type: "integer" },
            updated_at: { type: "string", format: "date-time" },
          },
        },
        RecipientPage: {
          type: "object",
          required: ["total", "offset", "limit", "items"],
          properties: {
            revision_id: { type: "string" },
            recipient_count: { type: "integer", description: "All recipients of the revision." },
            total: { type: "integer", description: "Recipients matching `q` and `status`." },
            offset: { type: "integer" },
            limit: { type: "integer" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  email: { type: "string" },
                  status: { type: ["string", "null"], enum: ["pending", "sent", "failed", null] },
                  resend_email_id: { type: ["string", "null"] },
                },
              },
            },
            top_domains: {
              type: "array",
              description: "The 5 most common domains in the whole list.",
              items: {
                type: "object",
                properties: { domain: { type: "string" }, count: { type: "integer" } },
              },
            },
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
                  description: "Present for body/query `validation_error`s.",
                  items: {
                    type: "object",
                    properties: {
                      path: { type: "string" },
                      message: { type: "string" },
                    },
                  },
                },
                invalid_count: { type: "integer", description: "Present for `invalid_recipients`." },
                invalid: {
                  type: "array",
                  description: "Present for `invalid_recipients`: the first 20 invalid addresses.",
                  items: {
                    type: "object",
                    properties: {
                      index: { type: "integer", description: "Position in the array you sent." },
                      value: { type: "string" },
                    },
                  },
                },
                max_recipients: { type: "integer", description: "Present for `too_many_recipients`." },
                recipient_count: { type: "integer", description: "Present for `too_many_recipients`." },
              },
            },
          },
        },
      },
    },
  };
}
