import type { FastifyInstance, FastifyRequest } from "fastify";
import { canAccessOwnerStudio } from "@prymeira/baase-shared";
import { z } from "zod";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext } from "../../http/auth-context";
import {
  createStudioCollectionSchema,
  createStudioDocumentSchema,
  patchStudioDocumentSchema,
  studioCollectionDocumentParamsSchema,
  studioCollectionParamsSchema,
  studioDocumentListQuerySchema,
  studioDocumentParamsSchema,
  studioEmptyRouteSchema,
  studioAssetIdempotencyKeySchema,
  studioSearchQuerySchema,
  createStudioStructureSchema,
  patchStudioStructureSchema,
  studioStructureParamsSchema,
  studioStructureListQuerySchema,
  studioRitualParamsSchema,
  studioRitualSessionParamsSchema,
  studioRitualSessionListQuerySchema,
  patchStudioRitualSessionSchema,
  finishStudioRitualSessionSchema
} from "./studio.schemas";
import type { StudioOwnerScope, StudioService } from "./studio.types";
import type { StudioMemoryIndex } from "./studio-memory";
import type { StudioRitualService } from "./studio-ritual.service";
import type { StudioReadiness } from "./studio-readiness";

const studioRelatedQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(12).default(6) }).strict();
const studioRelationBodySchema = z.object({
  target_document_id: z.string().trim().min(1).max(200),
  relation_type: z.enum(["related_to", "supports", "contradicts", "originated", "informs", "supersedes"]).default("related_to")
}).strict();

function requireStudioScope(request: FastifyRequest): StudioOwnerScope {
  const context = readRequestContext(request);
  if (!canAccessOwnerStudio(context.role)) throw forbiddenError();
  return { workspaceId: context.workspaceId, ownerProfileId: context.profileId };
}

function relatedExplanation(vectorScore: number, lexicalScore: number) {
  if (lexicalScore >= 0.45) return "Compartilha termos e temas centrais com este documento.";
  if (vectorScore >= 0.7) return "Explora uma ideia próxima, mesmo usando palavras diferentes.";
  return "Traz um contexto que pode ampliar este raciocínio.";
}

function studioRouteError(error: unknown) {
  if (!(error instanceof Error)) return error;

  if (error.message === "AI_PROVIDER_UNAVAILABLE") {
    return new ApiError(503, "AI_PROVIDER_UNAVAILABLE", "A inteligência artificial do Estúdio está indisponível no momento.");
  }

  if (error.message === "STUDIO_DOCUMENT_STALE") {
    return new ApiError(
      409,
      "STUDIO_DOCUMENT_CHANGED",
      "O documento mudou durante a operação. Atualize e tente novamente."
    );
  }
  if (error.message === "STUDIO_DOCUMENT_CAPTURE_KEY_ACTIVE") {
    return new ApiError(
      409,
      "STUDIO_DOCUMENT_CAPTURE_KEY_ACTIVE",
      "Já existe uma captura ativa com esta chave."
    );
  }
  if (error.message === "STUDIO_EDITOR_JSON_INVALID") {
    return new ApiError(400, "STUDIO_EDITOR_JSON_INVALID", "O conteúdo do editor excede os limites de segurança.");
  }
  if (error.message === "STUDIO_DOCUMENT_NOT_FOUND") {
    return new ApiError(404, "STUDIO_DOCUMENT_NOT_FOUND", "Documento do Studio não encontrado.");
  }
  if (error.message === "STUDIO_STRUCTURE_NOT_FOUND") {
    return new ApiError(404, "STUDIO_STRUCTURE_NOT_FOUND", "Estrutura do Studio não encontrada.");
  }
  if (error.message === "STUDIO_STRUCTURE_STALE") {
    return new ApiError(409, "STUDIO_STRUCTURE_CHANGED", "A estrutura mudou. Atualize e tente novamente.");
  }
  if (error.message === "STUDIO_STRUCTURE_ACTIVE_DUPLICATE") {
    return new ApiError(409, "STUDIO_STRUCTURE_ACTIVE_DUPLICATE", "Já existe uma estrutura ativa deste tipo para o documento.");
  }
  if (error.message === "STUDIO_RITUAL_NOT_FOUND") {
    return new ApiError(404, "STUDIO_RITUAL_NOT_FOUND", "Ritual do Studio não encontrado.");
  }
  if (error.message === "STUDIO_RITUAL_SESSION_NOT_FOUND") {
    return new ApiError(404, "STUDIO_RITUAL_SESSION_NOT_FOUND", "Sessão de ritual não encontrada.");
  }
  if (error.message === "STUDIO_RITUAL_SESSION_STALE") {
    return new ApiError(409, "STUDIO_RITUAL_SESSION_CHANGED", "A sessão mudou. Atualize e tente novamente.");
  }
  if (error.message === "STUDIO_RITUAL_SESSION_COMPLETED") {
    return new ApiError(409, "STUDIO_RITUAL_SESSION_COMPLETED", "Esta sessão já foi concluída.");
  }
  if (["STUDIO_COLLECTION_NOT_FOUND", "STUDIO_COLLECTION_MEMBERSHIP_NOT_FOUND"].includes(error.message)) {
    return new ApiError(404, "STUDIO_COLLECTION_NOT_FOUND", "Coleção do Studio não encontrada.");
  }
  if (error.message === "STUDIO_ACTOR_SCOPE_MISMATCH") return forbiddenError();
  if ([
    "STUDIO_COLLECTION_NAME_REQUIRED",
    "STUDIO_COLLECTION_NAME_TOO_LONG",
    "STUDIO_DOCUMENT_CURSOR_INVALID",
    "STUDIO_STRUCTURE_CURSOR_INVALID",
    "STUDIO_STRUCTURE_DATA_INVALID",
    "STUDIO_RITUAL_NEXT_RUN_UNAVAILABLE",
    "STUDIO_RITUAL_SESSION_CURSOR_INVALID",
    "STUDIO_RITUAL_SESSION_DATA_INVALID",
    "STUDIO_RITUAL_ANSWERS_INVALID"
  ].includes(error.message)) {
    return new ApiError(400, error.message, "Dados inválidos para esta operação do Studio.");
  }
  return error;
}

async function runStudioOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw studioRouteError(error);
  }
}

async function withRequestAbortSignal<T>(request: FastifyRequest, operation: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(new Error("STUDIO_RITUAL_REQUEST_CANCELLED"));
  };
  request.raw.once("aborted", abort);
  request.raw.socket?.once("close", abort);
  try {
    return await operation(controller.signal);
  } finally {
    request.raw.removeListener("aborted", abort);
    request.raw.socket?.removeListener("close", abort);
  }
}

function readNoRouteParams(request: FastifyRequest) {
  studioEmptyRouteSchema.parse(request.params);
}

function readNoQuery(request: FastifyRequest) {
  studioEmptyRouteSchema.parse(request.query);
}

function readNoBody(request: FastifyRequest) {
  if (request.body !== undefined) studioEmptyRouteSchema.parse(request.body);
}

function readDocumentCaptureKey(request: FastifyRequest): string | null {
  const raw = request.headers["idempotency-key"];
  if (raw === undefined) return null;
  return studioAssetIdempotencyKeySchema.parse(raw);
}

export async function registerStudioRoutes(
  app: FastifyInstance,
  service: StudioService,
  memoryIndex?: StudioMemoryIndex,
  ritualService?: StudioRitualService,
  readiness?: StudioReadiness
) {
  app.get("/studio/readiness", async (request) => {
    requireStudioScope(request);
    readNoRouteParams(request);
    readNoQuery(request);
    readNoBody(request);
    return readiness ?? {
      ai: { status: "unavailable", code: "STUDIO_READINESS_UNAVAILABLE" },
      embeddings: { status: "unavailable", code: "STUDIO_READINESS_UNAVAILABLE" },
      vector: { status: "unavailable", code: "STUDIO_READINESS_UNAVAILABLE" },
      maintenance: { status: "unavailable", code: "STUDIO_READINESS_UNAVAILABLE" }
    };
  });

  app.get("/studio/home", async (request) => {
    const scope = requireStudioScope(request);
    readNoRouteParams(request);
    readNoQuery(request);
    readNoBody(request);
    return { home: await runStudioOperation(() => service.readHome(scope)) };
  });

  app.get("/studio/documents/:documentId/related", async (request) => {
    const scope = requireStudioScope(request);
    const params = studioDocumentParamsSchema.parse(request.params);
    const query = studioRelatedQuerySchema.parse(request.query);
    readNoBody(request);
    const source = await runStudioOperation(() => service.getDocument(scope, params.documentId));
    if (!memoryIndex || !source.bodyText.trim()) return { related: [] };
    const matches = await runStudioOperation(() => memoryIndex.findRelated(scope, {
      documentId: source.id,
      query: [source.title, source.bodyText].filter(Boolean).join("\n\n").slice(0, 8_000),
      limit: query.limit
    }));
    const related = await Promise.all(matches.map(async (match) => {
      const document = await runStudioOperation(() => service.getDocument(scope, match.documentId));
      return {
        document,
        excerpt: match.excerpt,
        score: match.score,
        explanation: relatedExplanation(match.vectorScore, match.lexicalScore)
      };
    }));
    return { related };
  });

  app.post("/studio/documents/:documentId/relations", async (request) => {
    const scope = requireStudioScope(request);
    const params = studioDocumentParamsSchema.parse(request.params);
    const body = studioRelationBodySchema.parse(request.body);
    readNoQuery(request);
    return runStudioOperation(() => service.relateDocuments(
      scope,
      scope.ownerProfileId,
      params.documentId,
      body.target_document_id,
      body.relation_type
    ));
  });

  app.get("/studio/documents", async (request) => {
    const scope = requireStudioScope(request);
    readNoRouteParams(request);
    const query = studioDocumentListQuerySchema.parse(request.query);
    readNoBody(request);
    const page = await runStudioOperation(() => service.listDocuments(scope, {
      cursor: query.cursor,
      limit: query.limit,
      status: query.status,
      inboxState: query.inbox_state,
      collectionId: query.collection_id
    }));
    return { documents: page.items, nextCursor: page.nextCursor, collectionsByDocumentId: page.collectionsByDocumentId };
  });

  app.get("/studio/structures", async (request) => {
    const scope = requireStudioScope(request);
    readNoRouteParams(request);
    const query = studioStructureListQuerySchema.parse(request.query);
    readNoBody(request);
    const page = await runStudioOperation(() => service.listStructures(scope, {
      kind: query.kind, lifecycleStatus: query.lifecycle_status, documentId: query.document_id,
      cursor: query.cursor, limit: query.limit
    }));
    return { structures: page.items, nextCursor: page.nextCursor };
  });

  app.post("/studio/documents/:documentId/structures", async (request, reply) => {
    const scope = requireStudioScope(request);
    const params = studioDocumentParamsSchema.parse(request.params);
    readNoQuery(request);
    const body = createStudioStructureSchema.parse(request.body);
    const structure = await runStudioOperation(() => service.createStructure(
      scope, scope.ownerProfileId, params.documentId, body
    ));
    return reply.status(201).send({ structure });
  });

  app.patch("/studio/structures/:structureId", async (request) => {
    const scope = requireStudioScope(request);
    const params = studioStructureParamsSchema.parse(request.params);
    readNoQuery(request);
    const body = patchStudioStructureSchema.parse(request.body);
    return { structure: await runStudioOperation(() => service.updateStructure(
      scope, scope.ownerProfileId, params.structureId, body
    )) };
  });

  app.delete("/studio/structures/:structureId", async (request) => {
    const scope = requireStudioScope(request);
    const params = studioStructureParamsSchema.parse(request.params);
    readNoQuery(request);
    readNoBody(request);
    return { structure: await runStudioOperation(() => service.archiveStructure(
      scope, scope.ownerProfileId, params.structureId
    )) };
  });

  if (ritualService) {
    app.get("/studio/rituals/:ritualId/sessions", async (request) => {
      const scope = requireStudioScope(request);
      const params = studioRitualParamsSchema.parse(request.params);
      const query = studioRitualSessionListQuerySchema.parse(request.query);
      readNoBody(request);
      const page = await runStudioOperation(() => ritualService.listSessions(scope, params.ritualId, query));
      return { sessions: page.items, nextCursor: page.nextCursor };
    });

    app.post("/studio/rituals/:ritualId/sessions", async (request, reply) => {
      const scope = requireStudioScope(request);
      const params = studioRitualParamsSchema.parse(request.params);
      readNoQuery(request);
      readNoBody(request);
      const session = await runStudioOperation(() => withRequestAbortSignal(
        request,
        (signal) => ritualService.startSession(scope, params.ritualId, { signal })
      ));
      return reply.status(201).send({ session });
    });

    app.patch("/studio/ritual-sessions/:sessionId", async (request) => {
      const scope = requireStudioScope(request);
      const params = studioRitualSessionParamsSchema.parse(request.params);
      readNoQuery(request);
      const body = patchStudioRitualSessionSchema.parse(request.body);
      return { session: await runStudioOperation(() => ritualService.updateSession(scope, params.sessionId, {
        expectedRevision: body.expected_revision,
        answers: body.answers
      })) };
    });

    app.post("/studio/ritual-sessions/:sessionId/finish", async (request) => {
      const scope = requireStudioScope(request);
      const params = studioRitualSessionParamsSchema.parse(request.params);
      readNoQuery(request);
      const body = finishStudioRitualSessionSchema.parse(request.body);
      return { session: await runStudioOperation(() => withRequestAbortSignal(request, (signal) => (
        ritualService.finishSession(scope, params.sessionId, {
          expectedRevision: body.expected_revision,
          answers: body.answers,
          requestSynthesis: body.request_synthesis,
          signal
        })
      ))) };
    });
  }

  app.post("/studio/documents", async (request, reply) => {
    const scope = requireStudioScope(request);
    readNoRouteParams(request);
    readNoQuery(request);
    const body = createStudioDocumentSchema.parse(request.body);
    const captureKey = readDocumentCaptureKey(request);
    const document = await runStudioOperation(() => service.createDocument(
      scope,
      scope.ownerProfileId,
      body,
      captureKey
    ));
    return reply.status(201).send({ document });
  });

  app.get("/studio/documents/:documentId", async (request) => {
    const scope = requireStudioScope(request);
    const params = studioDocumentParamsSchema.parse(request.params);
    readNoQuery(request);
    readNoBody(request);
    return { document: await runStudioOperation(() => service.getDocument(scope, params.documentId)) };
  });

  app.patch("/studio/documents/:documentId", async (request) => {
    const scope = requireStudioScope(request);
    const params = studioDocumentParamsSchema.parse(request.params);
    readNoQuery(request);
    const body = patchStudioDocumentSchema.parse(request.body);
    const { expected_revision: revision, ...updates } = body;
    return {
      document: await runStudioOperation(() => service.updateDocument(
        scope,
        scope.ownerProfileId,
        params.documentId,
        { revision, ...updates }
      ))
    };
  });

  app.post("/studio/documents/:documentId/archive", async (request) => {
    const scope = requireStudioScope(request);
    const params = studioDocumentParamsSchema.parse(request.params);
    readNoQuery(request);
    readNoBody(request);
    return {
      document: await runStudioOperation(() => service.archiveDocument(
        scope,
        scope.ownerProfileId,
        params.documentId
      ))
    };
  });

  app.post("/studio/documents/:documentId/restore", async (request) => {
    const scope = requireStudioScope(request);
    const params = studioDocumentParamsSchema.parse(request.params);
    readNoQuery(request);
    readNoBody(request);
    return {
      document: await runStudioOperation(() => service.restoreDocument(
        scope,
        scope.ownerProfileId,
        params.documentId
      ))
    };
  });

  app.get("/studio/documents/:documentId/versions", async (request) => {
    const scope = requireStudioScope(request);
    const params = studioDocumentParamsSchema.parse(request.params);
    readNoQuery(request);
    readNoBody(request);
    return {
      versions: await runStudioOperation(() => service.listVersions(scope, params.documentId))
    };
  });

  app.get("/studio/search", async (request) => {
    const scope = requireStudioScope(request);
    readNoRouteParams(request);
    const query = studioSearchQuerySchema.parse(request.query);
    readNoBody(request);
    return {
      results: await runStudioOperation(() => service.search(scope, query.query, query.limit))
    };
  });

  app.get("/studio/collections", async (request) => {
    const scope = requireStudioScope(request);
    readNoRouteParams(request);
    readNoQuery(request);
    readNoBody(request);
    return { collections: await runStudioOperation(() => service.listCollections(scope)) };
  });

  app.post("/studio/collections", async (request, reply) => {
    const scope = requireStudioScope(request);
    readNoRouteParams(request);
    readNoQuery(request);
    const body = createStudioCollectionSchema.parse(request.body);
    const collection = await runStudioOperation(() => service.createCollection(
      scope,
      scope.ownerProfileId,
      body
    ));
    return reply.status(201).send({ collection });
  });

  app.patch("/studio/collections/:collectionId", async (request) => {
    const scope = requireStudioScope(request);
    const params = studioCollectionParamsSchema.parse(request.params);
    readNoQuery(request);
    const body = createStudioCollectionSchema.parse(request.body);
    return {
      collection: await runStudioOperation(() => service.renameCollection(
        scope,
        scope.ownerProfileId,
        params.collectionId,
        body
      ))
    };
  });

  app.delete("/studio/collections/:collectionId", async (request) => {
    const scope = requireStudioScope(request);
    const params = studioCollectionParamsSchema.parse(request.params);
    readNoQuery(request);
    readNoBody(request);
    return {
      collection: await runStudioOperation(() => service.deleteCollection(
        scope,
        scope.ownerProfileId,
        params.collectionId
      ))
    };
  });

  app.put("/studio/collections/:collectionId/documents/:documentId", async (request) => {
    const scope = requireStudioScope(request);
    const params = studioCollectionDocumentParamsSchema.parse(request.params);
    readNoQuery(request);
    readNoBody(request);
    return {
      membership: await runStudioOperation(() => service.addDocumentToCollection(
        scope,
        scope.ownerProfileId,
        params.collectionId,
        params.documentId
      ))
    };
  });

  app.delete("/studio/collections/:collectionId/documents/:documentId", async (request) => {
    const scope = requireStudioScope(request);
    const params = studioCollectionDocumentParamsSchema.parse(request.params);
    readNoQuery(request);
    readNoBody(request);
    return {
      removed: await runStudioOperation(() => service.removeDocumentFromCollection(
        scope,
        scope.ownerProfileId,
        params.collectionId,
        params.documentId
      ))
    };
  });
}
