import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { canAccessOwnerStudio } from "@prymeira/baase-shared";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext } from "../../http/auth-context";
import type { ObjectStorage } from "../../storage/object-storage";
import {
  studioAssetParamsSchema,
  studioDocumentParamsSchema,
  studioEmptyRouteSchema,
  studioLinkCaptureSchema
} from "./studio.schemas";
import {
  createStudioUploadSemaphore,
  spoolStudioAssetUpload,
  STUDIO_ASSET_MAX_FILE_BYTES,
  studioAssetReadStream,
  type StudioUploadSemaphore
} from "./studio-asset-upload";
import {
  captureStudioLinkSnapshot,
  type StudioLinkFetcher,
  type StudioLinkResolver
} from "./studio-link-fetcher";
import type { StudioAsset, StudioOwnerScope, StudioRepository } from "./studio.types";
import type { createStudioAssetCleanupProcessor } from "./studio-asset-cleanup";

export type { StudioLinkFetcher, StudioLinkResolver } from "./studio-link-fetcher";

const DOWNLOAD_LIFETIME_SECONDS = 600;
const DEFAULT_UPLOAD_PUT_TIMEOUT_MS = 120_000;

export type RegisterStudioAssetRoutesOptions = {
  repository: StudioRepository;
  objectStorage: ObjectStorage;
  resolver?: StudioLinkResolver;
  fetcher?: StudioLinkFetcher;
  uploadSemaphore?: StudioUploadSemaphore;
  cleanupProcessor?: Pick<ReturnType<typeof createStudioAssetCleanupProcessor>, "processJob">;
  now?: () => Date;
  uploadPutTimeoutMs?: number;
  uploadLeaseMs?: number;
  uploadLeaseHeartbeatMs?: number;
};

export async function registerStudioAssetRoutes(app: FastifyInstance, options: RegisterStudioAssetRoutesOptions) {
  const uploadSemaphore = options.uploadSemaphore ?? createStudioUploadSemaphore(2);

  app.post("/studio/documents/:documentId/assets", async (request, reply) => {
    const scope = requireStudioScope(request);
    const { documentId } = studioDocumentParamsSchema.parse(request.params);
    studioEmptyRouteSchema.parse(request.query);
    await requireDocument(options.repository, scope, documentId);

    if (request.isMultipart()) {
      const release = uploadSemaphore.tryAcquire();
      if (!release) {
        throw new ApiError(429, "STUDIO_ASSET_UPLOAD_BUSY", "Há muitos uploads em andamento. Tente novamente.");
      }
      try {
        const asset = await uploadFileAsset(request, options, scope, documentId);
        return reply.status(201).send({ asset });
      } finally {
        release();
      }
    }

    const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      throw new ApiError(415, "STUDIO_ASSET_CONTENT_TYPE_UNSUPPORTED", "Envie um arquivo multipart ou um link JSON.");
    }
    const input = studioLinkCaptureSchema.parse(request.body);
    const snapshot = await captureStudioLinkSnapshot(input.url, {
      resolver: options.resolver,
      fetcher: options.fetcher,
      now: options.now
    });
    try {
      const asset = await options.repository.createAsset({
        ...scope,
        documentId,
        kind: "link_snapshot",
        displayName: snapshot.title,
        objectKey: null,
        sourceUrl: input.url,
        finalUrl: snapshot.finalUrl,
        fetchedAt: snapshot.fetchedAt,
        mimeType: snapshot.mimeType,
        sizeBytes: snapshot.sizeBytes,
        extractionStatus: "ready",
        extractedText: snapshot.extractedText,
        extractionMetadata: {
          extractor: "inert_html_text",
          redirectCount: snapshot.redirectCount,
          truncated: snapshot.textTruncated,
          originalCharacterCount: snapshot.originalCharacterCount
        },
        lastErrorCode: null,
        attemptCount: 1,
        nextAttemptAt: null
      });
      return reply.status(201).send({ asset });
    } catch (error) {
      if (error instanceof Error && error.message === "STUDIO_DOCUMENT_NOT_FOUND") throw documentNotFound();
      throw persistenceFailed();
    }
  });

  app.get("/studio/assets/:assetId/download", async (request) => {
    const scope = requireStudioScope(request);
    const { assetId } = studioAssetParamsSchema.parse(request.params);
    studioEmptyRouteSchema.parse(request.query);
    if (request.body !== undefined) studioEmptyRouteSchema.parse(request.body);
    const asset = await requireAsset(options.repository, scope, assetId);
    if (!asset.objectKey) {
      throw new ApiError(400, "STUDIO_ASSET_NOT_DOWNLOADABLE", "Esta captura não possui um arquivo para download.");
    }
    try {
      const url = await options.objectStorage.createDownloadUrl(asset.objectKey, DOWNLOAD_LIFETIME_SECONDS);
      return { url, expires_in_seconds: DOWNLOAD_LIFETIME_SECONDS };
    } catch {
      throw storageUnavailable();
    }
  });

  app.delete("/studio/assets/:assetId", async (request, reply) => {
    const scope = requireStudioScope(request);
    const { assetId } = studioAssetParamsSchema.parse(request.params);
    studioEmptyRouteSchema.parse(request.query);
    if (request.body !== undefined) studioEmptyRouteSchema.parse(request.body);
    await requireAsset(options.repository, scope, assetId);
    const job = await options.repository.tombstoneAssetForCleanup(scope, assetId);
    if (!job) throw assetNotFound();
    const finalized = options.cleanupProcessor
      ? await boundedImmediateCleanup(options.cleanupProcessor.processJob(scope, job.id), 2_000)
      : false;
    if (finalized) return reply.status(204).send();
    return reply.status(202).send({ ok: true, cleanup_pending: true });
  });
}

async function boundedImmediateCleanup(operation: Promise<boolean>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.catch(() => false),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function uploadFileAsset(
  request: FastifyRequest,
  options: RegisterStudioAssetRoutesOptions,
  scope: StudioOwnerScope,
  documentId: string
) {
  const parts = request.parts({
    limits: {
      fileSize: STUDIO_ASSET_MAX_FILE_BYTES,
      files: 1,
      fields: 0,
      parts: 1,
      fieldSize: 1
    }
  });
  let firstPart: Awaited<ReturnType<typeof parts.next>>;
  try {
    firstPart = await parts.next();
  } catch (error) {
    throw multipartError(error);
  }
  const file = firstPart.value;
  if (firstPart.done || !file || file.type !== "file" || file.fieldname !== "file") {
    if (file?.type === "file") file.file.resume();
    throw new ApiError(400, "STUDIO_ASSET_FILE_REQUIRED", "Use o campo file para anexar o arquivo.");
  }
  const displayName = sanitizeFilename(file.filename);
  try {
    return await spoolStudioAssetUpload({
      file: file.file,
      declaredMimeType: file.mimetype,
      isTruncated: () => file.file.truncated
    }, async (spooled) => {
      try {
        const extraPart = await parts.next();
        if (!extraPart.done) {
          if (extraPart.value.type === "file") extraPart.value.file.resume();
          throw multipartError(undefined);
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw multipartError(error);
      }
      const key = studioAssetKey(scope, documentId, displayName);
      const kind = spooled.mimeType.startsWith("audio/")
        ? "audio" as const
        : spooled.mimeType.startsWith("image/") ? "image" as const : "file" as const;
      let intent;
      try {
        const currentTime = (options.now ?? (() => new Date()))();
        const putTimeoutMs = options.uploadPutTimeoutMs ?? DEFAULT_UPLOAD_PUT_TIMEOUT_MS;
        const uploadLeaseMs = Math.max(
          putTimeoutMs + 1,
          options.uploadLeaseMs ?? putTimeoutMs * 2
        );
        intent = await options.repository.createAssetUploadIntent({
          ...scope,
          documentId,
          objectKey: key,
          displayName,
          kind,
          mimeType: spooled.mimeType,
          sizeBytes: spooled.sizeBytes,
          uploadLeaseExpiresAt: new Date(currentTime.getTime() + uploadLeaseMs).toISOString()
        });
      } catch (error) {
        if (error instanceof Error && error.message === "STUDIO_DOCUMENT_NOT_FOUND") throw documentNotFound();
        throw persistenceFailed();
      }
      const putTimeoutMs = options.uploadPutTimeoutMs ?? DEFAULT_UPLOAD_PUT_TIMEOUT_MS;
      const uploadLeaseMs = Math.max(
        putTimeoutMs + 1,
        options.uploadLeaseMs ?? putTimeoutMs * 2
      );
      const uploadLeaseHeartbeatMs = options.uploadLeaseHeartbeatMs
        ?? Math.max(1_000, Math.floor(uploadLeaseMs / 3));
      const putController = new AbortController();
      let putTimeout: ReturnType<typeof setTimeout> | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let renewalActive = false;
      heartbeat = setInterval(() => {
        if (renewalActive) return;
        renewalActive = true;
        const currentTime = (options.now ?? (() => new Date()))();
        void options.repository.renewAssetUploadIntentLease({
          scope,
          intentId: intent.id,
          uploadToken: intent.uploadToken!,
          uploadLeaseExpiresAt: new Date(currentTime.getTime() + uploadLeaseMs).toISOString()
        }).catch((error) => {
          request.log.error({ err: error, intentId: intent.id }, "Studio upload lease renewal failed");
        }).finally(() => {
          renewalActive = false;
        });
      }, uploadLeaseHeartbeatMs);
      heartbeat.unref?.();
      const putSettlement = Promise.resolve().then(() => options.objectStorage.put({
          key,
          body: studioAssetReadStream(spooled.path),
          contentType: spooled.mimeType,
          sizeBytes: spooled.sizeBytes
        }, { signal: putController.signal }))
        .then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error })
        )
        .finally(() => {
          if (heartbeat) clearInterval(heartbeat);
          heartbeat = undefined;
        });
      const timeout = new Promise<{ timedOut: true }>((resolve) => {
        putTimeout = setTimeout(() => {
          putController.abort(new Error("STUDIO_ASSET_UPLOAD_TIMEOUT"));
          resolve({ timedOut: true });
        }, putTimeoutMs);
        putTimeout.unref?.();
      });
      const putOutcome = await Promise.race([putSettlement, timeout]);
      if (putTimeout) clearTimeout(putTimeout);
      if ("timedOut" in putOutcome) {
        void putSettlement.then(async () => {
          try {
            await transitionUploadToCleanup(options.repository, scope, intent, key, options.now);
          } catch (error) {
            request.log.error({ err: error, intentId: intent.id }, "Studio timed-out upload reconciliation failed");
          }
        });
        throw storageUnavailable({ upload_timeout: true });
      }
      if (!putOutcome.ok) {
        try {
          await transitionUploadToCleanup(options.repository, scope, intent, key, options.now);
        } catch (error) {
          request.log.error({ err: error, intentId: intent.id }, "Studio failed upload reconciliation failed");
        }
        throw storageUnavailable();
      }
      const assetInput = {
        ...scope,
        documentId,
        kind,
        displayName,
        objectKey: key,
        sourceUrl: null,
        finalUrl: null,
        fetchedAt: null,
        mimeType: spooled.mimeType,
        sizeBytes: spooled.sizeBytes,
        extractionStatus: "pending" as const,
        extractedText: null,
        extractionMetadata: {},
        lastErrorCode: null,
        attemptCount: 0,
        nextAttemptAt: null
      };
      try {
        return await options.repository.finalizeAssetUpload({
          scope,
          intentId: intent.id,
          uploadToken: intent.uploadToken!,
          asset: assetInput
        });
      } catch {
        let reconciled: StudioAsset | null;
        try {
          reconciled = await transitionUploadToCleanup(options.repository, scope, intent, key, options.now);
        } catch {
          throw persistenceFailed({ upload_intent_pending: true });
        }
        if (reconciled) return reconciled;
        throw persistenceFailed({ cleanup_pending: true });
      }
    }, {
      onCleanupError(error, path) {
        request.log.error({ err: error, path }, "Studio upload temp cleanup failed");
      }
    });
  } catch (error) {
    const candidate = error as { code?: unknown; statusCode?: unknown };
    if (candidate.code === "FST_REQ_FILE_TOO_LARGE" || candidate.statusCode === 413) throw payloadTooLarge();
    throw error;
  }
}

function transitionUploadToCleanup(
  repository: StudioRepository,
  scope: StudioOwnerScope,
  intent: { id: string; uploadToken: string | null },
  objectKey: string,
  now?: () => Date
) {
  return repository.reconcileAssetUploadFailure({
    scope,
    intentId: intent.id,
    uploadToken: intent.uploadToken!,
    objectKey,
    now: (now ?? (() => new Date()))().toISOString()
  });
}

function multipartError(error: unknown) {
  const candidate = error as { code?: unknown; statusCode?: unknown };
  if (candidate.code === "FST_REQ_FILE_TOO_LARGE" || candidate.statusCode === 413) {
    if (candidate.code === "FST_REQ_FILE_TOO_LARGE") return payloadTooLarge();
    return new ApiError(400, "STUDIO_ASSET_MULTIPART_INVALID", "O upload contém campos ou partes não permitidos.");
  }
  return new ApiError(400, "STUDIO_ASSET_MULTIPART_INVALID", "O upload multipart é inválido.");
}

function studioAssetKey(scope: StudioOwnerScope, documentId: string, fileName: string) {
  return `workspaces/${scope.workspaceId}/studio/${scope.ownerProfileId}/${documentId}/${randomUUID()}-${fileName}`;
}

function sanitizeFilename(filename: string) {
  const normalized = filename.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "");
  const safe = normalized.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 120);
  return safe || "arquivo";
}

function requireStudioScope(request: FastifyRequest): StudioOwnerScope {
  const context = readRequestContext(request);
  if (!canAccessOwnerStudio(context.role)) throw forbiddenError();
  return { workspaceId: context.workspaceId, ownerProfileId: context.profileId };
}

async function requireDocument(repository: StudioRepository, scope: StudioOwnerScope, documentId: string) {
  const document = await repository.findDocument(scope, documentId);
  if (!document) throw documentNotFound();
  return document;
}

async function requireAsset(repository: StudioRepository, scope: StudioOwnerScope, assetId: string): Promise<StudioAsset> {
  const asset = await repository.findAsset(scope, assetId);
  if (!asset) throw assetNotFound();
  return asset;
}

function payloadTooLarge() {
  return new ApiError(413, "PAYLOAD_TOO_LARGE", "O arquivo enviado é grande demais para esta operação.", {
    limit_bytes: STUDIO_ASSET_MAX_FILE_BYTES
  });
}
function documentNotFound() {
  return new ApiError(404, "STUDIO_DOCUMENT_NOT_FOUND", "Documento do Studio não encontrado.");
}
function assetNotFound() {
  return new ApiError(404, "STUDIO_ASSET_NOT_FOUND", "Captura do Studio não encontrada.");
}
function storageUnavailable(details?: Record<string, unknown>) {
  return new ApiError(
    503,
    "OBJECT_STORAGE_UNAVAILABLE",
    "Não foi possível acessar o armazenamento de arquivos. Tente novamente.",
    details
  );
}
function persistenceFailed(details?: Record<string, unknown>) {
  return new ApiError(
    503,
    "STUDIO_ASSET_PERSISTENCE_FAILED",
    "Não foi possível salvar a captura. Tente novamente.",
    details
  );
}
