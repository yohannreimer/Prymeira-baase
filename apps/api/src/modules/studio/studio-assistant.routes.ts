import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { canAccessOwnerStudio } from "@prymeira/baase-shared";
import { z } from "zod";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext } from "../../http/auth-context";
import type { StudioOwnerScope } from "./studio.types";
import type { StudioAssistantService, StudioSseEvent } from "./studio-assistant.service";
import {
  studioOperationDraftSchema,
  type StudioOperationalLink,
  type StudioOperationPreview,
  type StudioOperationsBridge
} from "./studio-operations-bridge";

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
const operationConfirmSchema = z.object({
  preview_id: routeId,
  draft: studioOperationDraftSchema
}).strict();

function requireStudioScope(request: FastifyRequest): StudioOwnerScope {
  const context = readRequestContext(request);
  if (!canAccessOwnerStudio(context.role)) throw forbiddenError();
  return { workspaceId: context.workspaceId, ownerProfileId: context.profileId };
}

export async function registerStudioAssistantRoutes(
  app: FastifyInstance,
  service: StudioAssistantService,
  operationsBridge?: StudioOperationsBridge
) {
  app.post("/studio/assistant/turns", async (request, reply) => {
    const scope = requireStudioScope(request);
    emptySchema.parse(request.params);
    emptySchema.parse(request.query);
    const body = turnSchema.parse(request.body);
    try {
      service.assertAiAvailable();
    } catch (error) {
      throw assistantRouteError(error);
    }
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

  if (operationsBridge) {
    app.post("/studio/suggestions/:suggestionId/operation-preview", async (request, reply) => {
      const scope = requireStudioScope(request);
      const params = suggestionParamsSchema.parse(request.params);
      emptySchema.parse(request.query);
      const draft = studioOperationDraftSchema.parse(request.body);
      try {
        const preview = await operationsBridge.preview(scope, scope.ownerProfileId, params.suggestionId, draft);
        return reply.status(201).send({ preview: operationPreviewDto(preview) });
      } catch (error) {
        throw assistantRouteError(error);
      }
    });

    app.post("/studio/suggestions/:suggestionId/operation-confirm", async (request, reply) => {
      const scope = requireStudioScope(request);
      const params = suggestionParamsSchema.parse(request.params);
      emptySchema.parse(request.query);
      const body = operationConfirmSchema.parse(request.body);
      const idempotencyKey = readOperationIdempotencyKey(request);
      try {
        const current = await operationsBridge.getPreview(scope, body.preview_id);
        if (current.sourceSuggestionId !== params.suggestionId) throw new Error("STUDIO_OPERATION_PREVIEW_NOT_FOUND");
        const wasConfirmed = current.status === "confirmed";
        const link = await operationsBridge.confirm(
          scope,
          scope.ownerProfileId,
          body.preview_id,
          idempotencyKey,
          body.draft
        );
        return reply.status(wasConfirmed ? 200 : 201).send({ link: operationalLinkDto(link) });
      } catch (error) {
        throw assistantRouteError(error);
      }
    });
  }
}

function readOperationIdempotencyKey(request: FastifyRequest) {
  const raw = request.headers["idempotency-key"];
  if (typeof raw !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(raw)) {
    throw new ApiError(400, "STUDIO_OPERATION_IDEMPOTENCY_KEY_INVALID", "Informe uma chave de confirmação válida.");
  }
  return raw;
}

function operationPreviewDto(preview: StudioOperationPreview) {
  return {
    id: preview.id,
    source_suggestion_id: preview.sourceSuggestionId,
    source_document_id: preview.sourceDocumentId,
    resource_type: preview.resourceType,
    payload: preview.payload,
    confirmed_payload: preview.confirmedPayload,
    status: preview.status,
    expires_at: preview.expiresAt,
    idempotency_key: preview.idempotencyKey,
    result_resource_id: preview.resultResourceId,
    created_at: preview.createdAt,
    updated_at: preview.updatedAt,
    confirmed_at: preview.confirmedAt
  };
}

function operationalLinkDto(link: StudioOperationalLink) {
  return {
    id: link.id,
    preview_id: link.previewId,
    source_suggestion_id: link.sourceSuggestionId,
    source_document_id: link.sourceDocumentId,
    source_structure_id: link.sourceStructureId,
    resource_type: link.resourceType,
    resource_id: link.resourceId,
    relation_type: link.relationType,
    created_by_profile_id: link.createdByProfileId,
    created_at: link.createdAt
  };
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
  if (error.message === "AI_PROVIDER_UNAVAILABLE") {
    return new ApiError(503, "AI_PROVIDER_UNAVAILABLE", "A inteligência artificial do Estúdio está indisponível no momento.");
  }
  if (error.message === "STUDIO_OWNER_RATE_LIMITED") {
    return new ApiError(429, error.message, "Aguarde um pouco antes de iniciar outra conversa no Estúdio.");
  }
  if (error.message === "STUDIO_ASSISTANT_CONTEXT_LIMIT") {
    return new ApiError(413, error.message, "O contexto selecionado é grande demais para uma única análise.");
  }
  if (error.message === "STUDIO_EDITOR_JSON_INVALID") {
    return new ApiError(400, error.message, "O conteúdo do editor excede os limites de segurança.");
  }
  if (["STUDIO_DOCUMENT_NOT_FOUND", "STUDIO_CONVERSATION_NOT_FOUND", "STUDIO_SUGGESTION_NOT_FOUND",
    "STUDIO_OPERATION_PREVIEW_NOT_FOUND"].includes(error.message)) {
    return new ApiError(404, error.message, "Conteúdo privado do Estúdio não encontrado.");
  }
  if (["STUDIO_DOCUMENT_STALE", "STUDIO_SUGGESTION_ALREADY_DECIDED", "STUDIO_CONVERSATION_DOCUMENT_MISMATCH"].includes(error.message)) {
    return new ApiError(409, error.message, "O conteúdo mudou durante a operação. Atualize e tente novamente.");
  }
  if (["STUDIO_MESSAGE_REQUIRED", "STUDIO_MESSAGE_TOO_LONG", "STUDIO_SUGGESTION_DOCUMENT_REQUIRED",
    "STUDIO_SELECTED_TEXT_SUGGESTION_UNSUPPORTED", "STUDIO_OPERATION_PAYLOAD_INVALID",
    "STUDIO_OPERATION_IDEMPOTENCY_KEY_INVALID"].includes(error.message)) {
    return new ApiError(400, error.message, "Dados inválidos para o copiloto do Estúdio.");
  }
  if (error.message === "STUDIO_OPERATION_PREVIEW_EXPIRED") {
    return new ApiError(410, error.message, "Esta prévia expirou. Gere uma nova antes de confirmar.");
  }
  if (["STUDIO_OPERATION_SOURCE_SUGGESTION_NOT_PENDING", "STUDIO_OPERATION_PREVIEW_ALREADY_CONFIRMED",
    "STUDIO_OPERATION_CONFIRMATION_KEY_CONFLICT", "STUDIO_OPERATION_CONFIRMATION_IN_PROGRESS",
    "STUDIO_OPERATION_CONFIRMATION_RECOVERY_REQUIRED", "STUDIO_OPERATION_CONFIRMATION_FENCE_LOST",
    "STUDIO_OPERATION_RESOURCE_TYPE_CHANGED"].includes(error.message)) {
    return new ApiError(409, error.message, "A prévia mudou durante a confirmação. Atualize e tente novamente.");
  }
  if (["STUDIO_OPERATION_SOURCE_DOCUMENT_REQUIRED", "STUDIO_OPERATION_AREA_NOT_FOUND",
    "STUDIO_OPERATION_PERSON_NOT_FOUND", "STUDIO_OPERATION_PERSON_AREA_MISMATCH",
    "STUDIO_OPERATION_ROLE_NOT_FOUND", "STUDIO_OPERATION_ROLE_AREA_MISMATCH",
    "STUDIO_OPERATION_PROCESS_NOT_FOUND", "STUDIO_OPERATION_TRAINING_NOT_FOUND"].includes(error.message)) {
    return new ApiError(422, error.message, "Revise os vínculos operacionais antes de confirmar.");
  }
  if (error.message === "STUDIO_ACTOR_SCOPE_MISMATCH") return forbiddenError();
  return error;
}
