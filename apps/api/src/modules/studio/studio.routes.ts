import type { FastifyInstance, FastifyRequest } from "fastify";
import { canAccessOwnerStudio } from "@prymeira/baase-shared";
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
  studioSearchQuerySchema
} from "./studio.schemas";
import type { StudioOwnerScope, StudioService } from "./studio.types";

function requireStudioScope(request: FastifyRequest): StudioOwnerScope {
  const context = readRequestContext(request);
  if (!canAccessOwnerStudio(context.role)) throw forbiddenError();
  return { workspaceId: context.workspaceId, ownerProfileId: context.profileId };
}

function studioRouteError(error: unknown) {
  if (!(error instanceof Error)) return error;

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
  if (error.message === "STUDIO_DOCUMENT_NOT_FOUND") {
    return new ApiError(404, "STUDIO_DOCUMENT_NOT_FOUND", "Documento do Studio não encontrado.");
  }
  if (["STUDIO_COLLECTION_NOT_FOUND", "STUDIO_COLLECTION_MEMBERSHIP_NOT_FOUND"].includes(error.message)) {
    return new ApiError(404, "STUDIO_COLLECTION_NOT_FOUND", "Coleção do Studio não encontrada.");
  }
  if (error.message === "STUDIO_ACTOR_SCOPE_MISMATCH") return forbiddenError();
  if ([
    "STUDIO_COLLECTION_NAME_REQUIRED",
    "STUDIO_COLLECTION_NAME_TOO_LONG",
    "STUDIO_DOCUMENT_CURSOR_INVALID"
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

export async function registerStudioRoutes(app: FastifyInstance, service: StudioService) {
  app.get("/studio/home", async (request) => {
    const scope = requireStudioScope(request);
    readNoRouteParams(request);
    readNoQuery(request);
    readNoBody(request);
    return { home: await runStudioOperation(() => service.readHome(scope)) };
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
