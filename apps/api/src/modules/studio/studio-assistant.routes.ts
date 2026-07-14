import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { canAccessOwnerStudio } from "@prymeira/baase-shared";
import { z } from "zod";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext } from "../../http/auth-context";
import type { StudioOwnerScope } from "./studio.types";
import type { StudioAssistantService, StudioSseEvent } from "./studio-assistant.service";

const routeId = z.string().trim().min(1).max(200);
const contextSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable().default(null),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable().default(null),
  resource_types: z.array(z.enum([
    "dashboard", "task", "routine", "process", "training", "announcement", "people"
  ])).max(7).default([]),
  person_ids: z.array(routeId).max(10).default([])
}).strict();
const turnSchema = z.object({
  conversation_id: routeId.nullable().optional().default(null),
  document_id: routeId.nullable().optional().default(null),
  message: z.string().trim().min(1).max(20_000),
  allow_external_research: z.boolean().optional().default(false),
  request_text_suggestion: z.boolean().optional().default(false),
  selected_text_context: z.string().trim().min(1).max(4_000).nullable().optional().default(null),
  operational_context: contextSchema.nullable().optional().default(null)
}).strict();
const suggestionParamsSchema = z.object({ suggestionId: routeId }).strict();
const emptySchema = z.object({}).strict();
const suggestionProposalSchema = z.object({
  document_id: routeId,
  expected_revision: z.number().int().min(1),
  title: z.string().max(500).nullable(),
  body_json: z.record(z.string(), z.unknown()),
  body_text: z.string().max(200_000)
}).strict();
const acceptSuggestionSchema = z.object({ proposal: suggestionProposalSchema.optional() }).strict();

function requireStudioScope(request: FastifyRequest): StudioOwnerScope {
  const context = readRequestContext(request);
  if (!canAccessOwnerStudio(context.role)) throw forbiddenError();
  return { workspaceId: context.workspaceId, ownerProfileId: context.profileId };
}

export async function registerStudioAssistantRoutes(app: FastifyInstance, service: StudioAssistantService) {
  app.post("/studio/assistant/turns", async (request, reply) => {
    const scope = requireStudioScope(request);
    emptySchema.parse(request.params);
    emptySchema.parse(request.query);
    const body = turnSchema.parse(request.body);
    const controller = new AbortController();
    const abort = () => {
      if (!controller.signal.aborted) controller.abort(new Error("STUDIO_ASSISTANT_CANCELLED"));
    };
    const onResponseClose = () => { if (!reply.raw.writableEnded) abort(); };
    request.raw.once("aborted", abort);
    reply.raw.once("close", onResponseClose);
    try {
      const events = await service.streamTurn(scope, {
        conversationId: body.conversation_id,
        documentId: body.document_id,
        message: body.message,
        allowExternalResearch: body.allow_external_research,
        requestTextSuggestion: body.request_text_suggestion,
        selectedTextContext: body.selected_text_context,
        context: body.operational_context ? {
          from: body.operational_context.from,
          to: body.operational_context.to,
          resourceTypes: body.operational_context.resource_types,
          personIds: body.operational_context.person_ids
        } : null,
        signal: controller.signal
      });
      reply.headers({
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      return reply.send(Readable.from(withCleanup(formatSseStream(events, controller.signal), cleanup)));
    } catch (error) {
      cleanup();
      throw assistantRouteError(error);
    }

    function cleanup() {
      request.raw.removeListener("aborted", abort);
      reply.raw.removeListener("close", onResponseClose);
    }
  });

  app.post("/studio/suggestions/:suggestionId/accept", async (request) => {
    const scope = requireStudioScope(request);
    const params = suggestionParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    const body = acceptSuggestionSchema.parse(request.body ?? {});
    try {
      return await service.acceptSuggestion(scope, params.suggestionId, body.proposal);
    } catch (error) {
      throw assistantRouteError(error);
    }
  });

  app.post("/studio/suggestions/:suggestionId/dismiss", async (request) => {
    const scope = requireStudioScope(request);
    const params = suggestionParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    if (request.body !== undefined) emptySchema.parse(request.body);
    try {
      return await service.dismissSuggestion(scope, params.suggestionId);
    } catch (error) {
      throw assistantRouteError(error);
    }
  });
}

async function* withCleanup<T>(iterable: AsyncIterable<T>, cleanup: () => void) {
  try {
    yield* iterable;
  } finally {
    cleanup();
  }
}

async function* formatSseStream(events: AsyncIterable<StudioSseEvent>, signal: AbortSignal) {
  const iterator = events[Symbol.asyncIterator]();
  let next = iterator.next();
  try {
    while (!signal.aborted) {
      const result = await raceHeartbeat(next, 15_000);
      if (result.type === "heartbeat") {
        yield ": heartbeat\n\n";
        continue;
      }
      if (result.value.done) return;
      yield encodeSse(result.value.value);
      next = iterator.next();
    }
  } catch (error) {
    if (!signal.aborted) {
      yield encodeSse({ event: "error", data: { code: publicStreamErrorCode(error), retryable: true } });
    }
  } finally {
    if (iterator.return) await iterator.return().catch(() => undefined);
  }
}

function raceHeartbeat<T>(promise: Promise<IteratorResult<T>>, timeoutMs: number) {
  return new Promise<{ type: "value"; value: IteratorResult<T> } | { type: "heartbeat" }>((resolve, reject) => {
    const timer = setTimeout(() => resolve({ type: "heartbeat" }), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => { clearTimeout(timer); resolve({ type: "value", value }); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

function encodeSse(event: StudioSseEvent) {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

function publicStreamErrorCode(error: unknown) {
  if (error instanceof Error && error.message === "AI_OUTPUT_VALIDATION_FAILED") return "STUDIO_SUGGESTION_INVALID";
  return "STUDIO_ASSISTANT_FAILED";
}

function assistantRouteError(error: unknown) {
  if (!(error instanceof Error)) return error;
  if (["STUDIO_DOCUMENT_NOT_FOUND", "STUDIO_CONVERSATION_NOT_FOUND", "STUDIO_SUGGESTION_NOT_FOUND"].includes(error.message)) {
    return new ApiError(404, error.message, "Conteúdo privado do Estúdio não encontrado.");
  }
  if (["STUDIO_DOCUMENT_STALE", "STUDIO_SUGGESTION_ALREADY_DECIDED", "STUDIO_CONVERSATION_DOCUMENT_MISMATCH"].includes(error.message)) {
    return new ApiError(409, error.message, "O conteúdo mudou durante a operação. Atualize e tente novamente.");
  }
  if (["STUDIO_MESSAGE_REQUIRED", "STUDIO_MESSAGE_TOO_LONG", "STUDIO_SUGGESTION_DOCUMENT_REQUIRED",
    "STUDIO_SELECTED_TEXT_SUGGESTION_UNSUPPORTED"].includes(error.message)) {
    return new ApiError(400, error.message, "Dados inválidos para o copiloto do Estúdio.");
  }
  if (error.message === "STUDIO_ACTOR_SCOPE_MISMATCH") return forbiddenError();
  return error;
}
