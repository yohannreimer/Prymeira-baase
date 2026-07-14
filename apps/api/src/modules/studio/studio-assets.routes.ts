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
  prepareStudioAssetUpload,
  STUDIO_ASSET_MAX_FILE_BYTES,
  studioAssetReadStream,
  type PreparedStudioAssetUpload,
  type StudioUploadSemaphore
} from "./studio-asset-upload";
import {
  captureStudioLinkSnapshot,
  type StudioLinkFetcher,
  type StudioLinkResolver
} from "./studio-link-fetcher";
import type { StudioAsset, StudioAssetUploadIntent, StudioOwnerScope, StudioRepository } from "./studio.types";
import type { createStudioAssetCleanupProcessor } from "./studio-asset-cleanup";

export type { StudioLinkFetcher, StudioLinkResolver } from "./studio-link-fetcher";

const DOWNLOAD_LIFETIME_SECONDS = 600;
const DEFAULT_UPLOAD_PUT_TIMEOUT_MS = 120_000;
const DEFAULT_UPLOAD_ABORT_TIMEOUT_MS = 5_000;

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
  uploadAbortTimeoutMs?: number;
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
        throw new ApiError(503, "STUDIO_ASSET_UPLOAD_BUSY", "Há muitos uploads em andamento. Tente novamente.");
      }
      const asset = await uploadFileAsset(request, options, scope, documentId, release);
      return reply.status(201).send({ asset });
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
  documentId: string,
  releaseSemaphore: () => void
) {
  let prepared: PreparedStudioAssetUpload | null = null;
  let ownershipTransferred = false;
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
    releaseSemaphore();
    throw multipartError(error);
  }
  const file = firstPart.value;
  if (firstPart.done || !file || file.type !== "file" || file.fieldname !== "file") {
    if (file?.type === "file") file.file.resume();
    releaseSemaphore();
    throw new ApiError(400, "STUDIO_ASSET_FILE_REQUIRED", "Use o campo file para anexar o arquivo.");
  }
  const displayName = sanitizeFilename(file.filename);
  try {
    prepared = await prepareStudioAssetUpload({
      file: file.file,
      declaredMimeType: file.mimetype,
      isTruncated: () => file.file.truncated
    }, {
      onCleanupError(error, path) {
        request.log.error({ err: error, path }, "Studio upload temp cleanup failed");
      }
    });
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
    const kind = prepared.mimeType.startsWith("audio/")
      ? "audio" as const
      : prepared.mimeType.startsWith("image/") ? "image" as const : "file" as const;
    const putTimeoutMs = options.uploadPutTimeoutMs ?? DEFAULT_UPLOAD_PUT_TIMEOUT_MS;
    const uploadLeaseMs = Math.max(putTimeoutMs + 1, options.uploadLeaseMs ?? putTimeoutMs * 2);
    let intent: StudioAssetUploadIntent;
    try {
      const currentTime = (options.now ?? (() => new Date()))();
      intent = await options.repository.createAssetUploadIntent({
        ...scope,
        documentId,
        objectKey: key,
        displayName,
        kind,
        mimeType: prepared.mimeType,
        sizeBytes: prepared.sizeBytes,
        uploadLeaseExpiresAt: new Date(currentTime.getTime() + uploadLeaseMs).toISOString()
      });
    } catch (error) {
      if (error instanceof Error && error.message === "STUDIO_DOCUMENT_NOT_FOUND") throw documentNotFound();
      throw persistenceFailed();
    }

    const supervised = superviseAtomicUpload({
      request,
      options,
      scope,
      documentId,
      displayName,
      key,
      kind,
      prepared,
      intent,
      putTimeoutMs,
      uploadLeaseMs
    });
    ownershipTransferred = true;
    void supervised.settled.then(async () => {
      await prepared!.cleanup();
      releaseSemaphore();
    }).catch((error) => {
      request.log.error({ err: error, intentId: intent.id }, "Studio upload ownership finalizer failed");
    });
    return await supervised.response;
  } catch (error) {
    const candidate = error as { code?: unknown; statusCode?: unknown };
    if (candidate.code === "FST_REQ_FILE_TOO_LARGE" || candidate.statusCode === 413) throw payloadTooLarge();
    throw error;
  } finally {
    if (!ownershipTransferred) {
      await prepared?.cleanup();
      releaseSemaphore();
    }
  }
}

function superviseAtomicUpload(input: AtomicUploadOwnerInput): {
  response: Promise<StudioAsset>;
  settled: Promise<void>;
} {
  const controller = new AbortController();
  let interruptResponse!: (outcome: UploadResponseInterrupt) => void;
  const responseInterrupt = new Promise<UploadResponseInterrupt>((resolve) => { interruptResponse = resolve; });
  let interrupted = false;
  const interrupt = (outcome: UploadResponseInterrupt) => {
    if (interrupted) return;
    interrupted = true;
    controller.abort(outcome.reason);
    interruptResponse(outcome);
  };
  const timeout = setTimeout(() => {
    interrupt({
      reason: new Error("STUDIO_ASSET_UPLOAD_TIMEOUT"),
      responseError: storageUnavailable({ upload_timeout: true })
    });
  }, input.putTimeoutMs);
  timeout.unref?.();

  const ownerSettlement = executeAtomicUploadOwner(input, controller, interrupt).then(
    (asset) => ({ ok: true as const, asset }),
    (error: unknown) => ({ ok: false as const, error })
  );
  const settled = ownerSettlement.then(() => {
    clearTimeout(timeout);
  });
  const response = Promise.race([
    ownerSettlement.then((outcome) => ({ owner: outcome })),
    responseInterrupt.then((outcome) => ({ interrupt: outcome }))
  ]).then((outcome) => {
    if ("interrupt" in outcome) throw outcome.interrupt.responseError;
    clearTimeout(timeout);
    if (!outcome.owner.ok) throw outcome.owner.error;
    return outcome.owner.asset;
  });
  return { response, settled };
}

async function executeAtomicUploadOwner(
  input: AtomicUploadOwnerInput,
  controller: AbortController,
  interrupt: (outcome: UploadResponseInterrupt) => void
): Promise<StudioAsset> {
  const { options, scope, intent, key, prepared, request } = input;
  let storageUploadId: string | undefined;
  try {
    const session = await options.objectStorage.beginAtomicUpload({
      key,
      contentType: prepared.mimeType,
      sizeBytes: prepared.sizeBytes
    }, { signal: controller.signal });
    storageUploadId = session.uploadId;
  } catch (error) {
    await reconcileOwnerFailure(input, undefined, "Studio atomic upload creation reconciliation failed");
    throw controller.signal.aborted
      ? uploadInterruptionError(controller.signal)
      : storageUnavailable();
  }

  let attached = false;
  let attachError: unknown;
  try {
    attached = await options.repository.attachAssetUploadSession({
      scope,
      intentId: intent.id,
      uploadToken: intent.uploadToken!,
      storageUploadId
    });
  } catch (error) {
    attachError = error;
    request.log.error({ err: error, intentId: intent.id }, "Studio atomic upload session persistence failed");
  }
  if (!attached || controller.signal.aborted) {
    if (!controller.signal.aborted) controller.abort(new Error("STUDIO_ASSET_UPLOAD_SESSION_STALE"));
    await abortOwnerSession(input, storageUploadId);
    await reconcileOwnerFailure(input, storageUploadId, "Studio stale atomic upload reconciliation failed");
    if (controller.signal.reason instanceof Error
      && controller.signal.reason.message === "STUDIO_ASSET_UPLOAD_TIMEOUT") {
      throw storageUnavailable({ upload_timeout: true });
    }
    if (attachError || !attached) throw persistenceFailed({ upload_intent_pending: true });
    throw uploadInterruptionError(controller.signal);
  }

  const uploadLeaseHeartbeatMs = options.uploadLeaseHeartbeatMs
    ?? Math.max(1_000, Math.floor(input.uploadLeaseMs / 3));
  let renewalActive = false;
  const heartbeat = setInterval(() => {
    if (renewalActive || controller.signal.aborted) return;
    renewalActive = true;
    const currentTime = (options.now ?? (() => new Date()))();
    void options.repository.renewAssetUploadIntentLease({
      scope,
      intentId: intent.id,
      uploadToken: intent.uploadToken!,
      uploadLeaseExpiresAt: new Date(currentTime.getTime() + input.uploadLeaseMs).toISOString()
    }).then((renewed) => {
      if (!renewed) {
        interrupt({
          reason: new Error("STUDIO_ASSET_UPLOAD_LEASE_LOST"),
          responseError: storageUnavailable({ upload_lease_lost: true })
        });
      }
    }, () => {
      interrupt({
        reason: new Error("STUDIO_ASSET_UPLOAD_LEASE_RENEWAL_FAILED"),
        responseError: storageUnavailable({ upload_lease_lost: true })
      });
    }).finally(() => {
      renewalActive = false;
    });
  }, uploadLeaseHeartbeatMs);
  heartbeat.unref?.();

  try {
    await options.objectStorage.completeAtomicUploadFromStream({
      key,
      uploadId: storageUploadId,
      body: studioAssetReadStream(prepared.path),
      sizeBytes: prepared.sizeBytes
    }, { signal: controller.signal });
    throwIfUploadAborted(controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) controller.abort(error);
    await abortOwnerSession(input, storageUploadId);
    await reconcileOwnerFailure(input, storageUploadId, "Studio failed atomic upload reconciliation failed");
    throw uploadInterruptionError(controller.signal);
  } finally {
    clearInterval(heartbeat);
  }

  const assetInput = {
    ...scope,
    documentId: input.documentId,
    kind: input.kind,
    displayName: input.displayName,
    objectKey: key,
    sourceUrl: null,
    finalUrl: null,
    fetchedAt: null,
    mimeType: prepared.mimeType,
    sizeBytes: prepared.sizeBytes,
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
      reconciled = await transitionUploadToCleanup(
        options.repository, scope, intent, key, storageUploadId, options.now
      );
    } catch {
      throw persistenceFailed({ upload_intent_pending: true });
    }
    if (reconciled) return reconciled;
    throw persistenceFailed({ cleanup_pending: true });
  }
}

async function abortOwnerSession(input: AtomicUploadOwnerInput, storageUploadId: string): Promise<void> {
  await boundedAtomicAbort(input.options.objectStorage, input.key, storageUploadId, input.options.uploadAbortTimeoutMs)
    .catch((error) => input.request.log.error({ err: error, intentId: input.intent.id }, "Studio atomic upload abort failed"));
}

async function reconcileOwnerFailure(
  input: AtomicUploadOwnerInput,
  storageUploadId: string | undefined,
  message: string
): Promise<void> {
  try {
    await transitionUploadToCleanup(
      input.options.repository,
      input.scope,
      input.intent,
      input.key,
      storageUploadId,
      input.options.now
    );
  } catch (error) {
    input.request.log.error({ err: error, intentId: input.intent.id }, message);
  }
}

function uploadInterruptionError(signal: AbortSignal): ApiError {
  const reason = signal.reason instanceof Error ? signal.reason.message : "";
  if (reason === "STUDIO_ASSET_UPLOAD_TIMEOUT") return storageUnavailable({ upload_timeout: true });
  if (reason === "STUDIO_ASSET_UPLOAD_LEASE_LOST" || reason === "STUDIO_ASSET_UPLOAD_LEASE_RENEWAL_FAILED") {
    return storageUnavailable({ upload_lease_lost: true });
  }
  return storageUnavailable();
}

function throwIfUploadAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("STUDIO_ASSET_UPLOAD_ABORTED");
}

type AtomicUploadOwnerInput = {
  request: FastifyRequest;
  options: RegisterStudioAssetRoutesOptions;
  scope: StudioOwnerScope;
  documentId: string;
  displayName: string;
  key: string;
  kind: "audio" | "image" | "file";
  prepared: PreparedStudioAssetUpload;
  intent: StudioAssetUploadIntent;
  putTimeoutMs: number;
  uploadLeaseMs: number;
};

type UploadResponseInterrupt = {
  reason: Error;
  responseError: ApiError;
};

function transitionUploadToCleanup(
  repository: StudioRepository,
  scope: StudioOwnerScope,
  intent: { id: string; uploadToken: string | null },
  objectKey: string,
  storageUploadId?: string,
  now?: () => Date
) {
  return repository.reconcileAssetUploadFailure({
    scope,
    intentId: intent.id,
    uploadToken: intent.uploadToken!,
    objectKey,
    storageUploadId,
    now: (now ?? (() => new Date()))().toISOString()
  });
}

async function boundedAtomicAbort(
  objectStorage: ObjectStorage,
  key: string,
  uploadId: string,
  timeoutMs = DEFAULT_UPLOAD_ABORT_TIMEOUT_MS
): Promise<void> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const abortSettlement = objectStorage.abortAtomicUpload({ key, uploadId }, { signal: controller.signal })
    .then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
  const outcome = await Promise.race([
    abortSettlement,
    new Promise<{ timedOut: true }>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort(new Error("STUDIO_ASSET_UPLOAD_ABORT_TIMEOUT"));
        resolve({ timedOut: true });
      }, timeoutMs);
      timeout.unref?.();
    })
  ]);
  if (timeout) clearTimeout(timeout);
  if ("timedOut" in outcome) {
    void abortSettlement.then(() => undefined);
    throw new Error("STUDIO_ASSET_UPLOAD_ABORT_TIMEOUT");
  }
  if (!outcome.ok) throw outcome.error;
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
