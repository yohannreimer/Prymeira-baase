import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
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
import type { StudioAsset, StudioOwnerScope, StudioRepository } from "./studio.types";

const DOWNLOAD_LIFETIME_SECONDS = 600;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_LINK_BYTES = 5 * 1024 * 1024;
const MAX_LINK_REDIRECTS = 3;
const LINK_TIMEOUT_MS = 10_000;

const supportedUploadMimeTypes = new Set([
  "text/plain",
  "text/markdown",
  "application/pdf",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "image/jpeg",
  "image/png",
  "image/webp"
]);

export type StudioLinkResolver = (hostname: string) => Promise<string[]>;

export type StudioLinkFetchResponse = {
  statusCode: number;
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  body: Readable;
  pinnedAddress?: string;
};

export type StudioLinkFetcher = (input: {
  url: URL;
  pinnedAddress: string;
  signal: AbortSignal;
}) => Promise<StudioLinkFetchResponse>;

export type RegisterStudioAssetRoutesOptions = {
  repository: StudioRepository;
  objectStorage: ObjectStorage;
  resolver?: StudioLinkResolver;
  fetcher?: StudioLinkFetcher;
  now?: () => Date;
};

export async function registerStudioAssetRoutes(
  app: FastifyInstance,
  options: RegisterStudioAssetRoutesOptions
) {
  const resolver = options.resolver ?? defaultStudioLinkResolver;
  const fetcher = options.fetcher ?? defaultStudioLinkFetcher;
  const now = options.now ?? (() => new Date());

  app.post("/studio/documents/:documentId/assets", async (request, reply) => {
    const scope = requireStudioScope(request);
    const { documentId } = studioDocumentParamsSchema.parse(request.params);
    studioEmptyRouteSchema.parse(request.query);
    await requireDocument(options.repository, scope, documentId);

    if (request.isMultipart()) {
      const asset = await uploadFileAsset(request, options, scope, documentId);
      return reply.status(201).send({ asset });
    }

    const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      throw new ApiError(415, "STUDIO_ASSET_CONTENT_TYPE_UNSUPPORTED", "Envie um arquivo multipart ou um link JSON.");
    }
    const input = studioLinkCaptureSchema.parse(request.body);
    const snapshot = await captureLinkSnapshot(input.url, { resolver, fetcher, now });
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
          redirectCount: snapshot.redirectCount
        },
        lastErrorCode: null,
        attemptCount: 1,
        nextAttemptAt: null
      });
      return reply.status(201).send({ asset });
    } catch (error) {
      if (error instanceof Error && error.message === "STUDIO_DOCUMENT_NOT_FOUND") throw documentNotFound();
      throw new ApiError(503, "STUDIO_ASSET_PERSISTENCE_FAILED", "Não foi possível salvar a captura. Tente novamente.");
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

  app.delete("/studio/assets/:assetId", async (request) => {
    const scope = requireStudioScope(request);
    const { assetId } = studioAssetParamsSchema.parse(request.params);
    studioEmptyRouteSchema.parse(request.query);
    if (request.body !== undefined) studioEmptyRouteSchema.parse(request.body);
    const asset = await requireAsset(options.repository, scope, assetId);
    try {
      if (asset.objectKey) await options.objectStorage.delete(asset.objectKey);
    } catch {
      throw storageUnavailable();
    }
    const removed = await options.repository.deleteAsset(scope, assetId);
    if (!removed) throw assetNotFound();
    return { ok: true };
  });
}

async function uploadFileAsset(
  request: FastifyRequest,
  options: RegisterStudioAssetRoutesOptions,
  scope: StudioOwnerScope,
  documentId: string
) {
  const file = await request.file();
  if (!file) {
    throw new ApiError(400, "STUDIO_ASSET_FILE_REQUIRED", "Selecione um arquivo para anexar.");
  }
  if (file.fieldname !== "file") {
    file.file.resume();
    throw new ApiError(400, "STUDIO_ASSET_FILE_REQUIRED", "Use o campo file para anexar o arquivo.");
  }
  const mimeType = file.mimetype.trim().toLowerCase();
  if (!supportedUploadMimeTypes.has(mimeType)) {
    file.file.resume();
    throw new ApiError(415, "STUDIO_ASSET_MIME_UNSUPPORTED", "Este tipo de arquivo não é aceito no Studio.");
  }
  const buffer = await file.toBuffer();
  if (Object.keys(file.fields).some((fieldName) => fieldName !== "file")) {
    throw new ApiError(400, "REQUEST_VALIDATION_ERROR", "O upload contém campos não permitidos.");
  }
  if (file.file.truncated || buffer.length > MAX_FILE_BYTES) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "O arquivo enviado é grande demais para esta operação.", {
      limit_bytes: MAX_FILE_BYTES
    });
  }
  if (buffer.length === 0) {
    throw new ApiError(400, "STUDIO_ASSET_FILE_EMPTY", "O arquivo não pode estar vazio.");
  }

  const displayName = sanitizeFilename(file.filename);
  const key = studioAssetKey(scope, documentId, displayName);
  let stored = false;
  try {
    await options.objectStorage.put({
      key,
      body: Readable.from(buffer),
      contentType: mimeType,
      sizeBytes: buffer.length
    });
    stored = true;
    return await options.repository.createAsset({
      ...scope,
      documentId,
      kind: mimeType.startsWith("audio/") ? "audio" : mimeType.startsWith("image/") ? "image" : "file",
      displayName,
      objectKey: key,
      sourceUrl: null,
      finalUrl: null,
      fetchedAt: null,
      mimeType,
      sizeBytes: buffer.length,
      extractionStatus: "pending",
      extractedText: null,
      extractionMetadata: {},
      lastErrorCode: null,
      attemptCount: 0,
      nextAttemptAt: null
    });
  } catch (error) {
    if (stored) {
      try {
        await options.objectStorage.delete(key);
      } catch {
        // Preserve the primary persistence error; the scoped key can be reconciled later.
      }
      if (error instanceof Error && error.message === "STUDIO_DOCUMENT_NOT_FOUND") throw documentNotFound();
      throw new ApiError(503, "STUDIO_ASSET_PERSISTENCE_FAILED", "Não foi possível salvar a captura. Tente novamente.");
    }
    throw storageUnavailable();
  }
}

type LinkSnapshotDependencies = {
  resolver: StudioLinkResolver;
  fetcher: StudioLinkFetcher;
  now: () => Date;
};

async function captureLinkSnapshot(sourceUrl: string, dependencies: LinkSnapshotDependencies) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("STUDIO_LINK_TIMEOUT")), LINK_TIMEOUT_MS);
  try {
    let url = new URL(sourceUrl);
    let redirectCount = 0;
    while (true) {
      const hostname = url.hostname.replace(/^\[|\]$/gu, "");
      const addresses = await abortable(dependencies.resolver(hostname), controller.signal);
      if (addresses.length === 0 || addresses.some(isForbiddenAddress)) {
        throw new ApiError(400, "STUDIO_LINK_TARGET_FORBIDDEN", "O link aponta para uma rede não permitida.");
      }
      const pinnedAddress = addresses[0]!;
      const response = await abortable(
        dependencies.fetcher({ url, pinnedAddress, signal: controller.signal }),
        controller.signal
      );
      if (isRedirect(response.statusCode)) {
        const location = readHeader(response.headers, "location");
        response.body.destroy();
        if (!location) throw linkFetchFailed();
        if (redirectCount >= MAX_LINK_REDIRECTS) {
          throw new ApiError(400, "STUDIO_LINK_REDIRECT_LIMIT", "O link redirecionou vezes demais.");
        }
        const target = new URL(location, url);
        if (target.protocol !== "http:" && target.protocol !== "https:") {
          throw new ApiError(400, "STUDIO_LINK_PROTOCOL_UNSUPPORTED", "O redirecionamento usa um protocolo não permitido.");
        }
        url = target;
        redirectCount += 1;
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.body.destroy();
        throw linkFetchFailed();
      }

      const mimeType = (readHeader(response.headers, "content-type") ?? "text/plain")
        .split(";", 1)[0]!.trim().toLowerCase();
      const contentEncoding = (readHeader(response.headers, "content-encoding") ?? "identity").toLowerCase();
      if (contentEncoding !== "identity") {
        response.body.destroy();
        throw new ApiError(415, "STUDIO_LINK_CONTENT_UNSUPPORTED", "O conteúdo deste link usa uma codificação não permitida.");
      }
      if (!new Set(["text/html", "application/xhtml+xml", "text/plain", "text/markdown"]).has(mimeType)) {
        response.body.destroy();
        throw new ApiError(415, "STUDIO_LINK_CONTENT_UNSUPPORTED", "O conteúdo deste link não pode ser capturado.");
      }
      const declaredSize = Number(readHeader(response.headers, "content-length"));
      if (Number.isFinite(declaredSize) && declaredSize > MAX_LINK_BYTES) {
        response.body.destroy();
        throw linkTooLarge();
      }
      const body = await readBoundedBody(response.body, MAX_LINK_BYTES, controller.signal);
      const decoded = body.toString("utf8");
      const extracted = mimeType === "text/html" || mimeType === "application/xhtml+xml"
        ? extractInertHtml(decoded)
        : { title: "", text: decoded.trim() };
      return {
        title: extracted.title || url.hostname,
        extractedText: extracted.text.slice(0, 500_000),
        finalUrl: url.toString(),
        fetchedAt: dependencies.now().toISOString(),
        mimeType,
        sizeBytes: body.length,
        redirectCount
      };
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      throw new ApiError(504, "STUDIO_LINK_TIMEOUT", "O link demorou demais para responder.");
    }
    throw linkFetchFailed();
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedBody(body: Readable, limit: number, signal: AbortSignal) {
  const chunks: Buffer[] = [];
  let total = 0;
  const abort = () => body.destroy(signal.reason instanceof Error ? signal.reason : new Error("STUDIO_LINK_TIMEOUT"));
  signal.addEventListener("abort", abort, { once: true });
  try {
    for await (const chunk of body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > limit) {
        body.destroy();
        throw linkTooLarge();
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, total);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function extractInertHtml(html: string) {
  const titleMatch = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title\s*>/iu.exec(html);
  const withoutActiveOrHiddenContent = html
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(script|style|noscript|template|svg)(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/giu, " ");
  const text = decodeHtmlEntities(withoutActiveOrHiddenContent.replace(/<[^>]*>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
  return {
    title: decodeHtmlEntities(titleMatch?.[1] ?? "").replace(/\s+/gu, " ").trim().slice(0, 240),
    text
  };
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

async function defaultStudioLinkResolver(hostname: string) {
  return (await lookup(hostname, { all: true, verbatim: true })).map((result) => result.address);
}

async function defaultStudioLinkFetcher(input: {
  url: URL;
  pinnedAddress: string;
  signal: AbortSignal;
}): Promise<StudioLinkFetchResponse> {
  return new Promise((resolve, reject) => {
    const family = isIP(input.pinnedAddress) as 4 | 6;
    const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, input.pinnedAddress, family);
    };
    const request = (input.url.protocol === "https:" ? httpsRequest : httpRequest)(input.url, {
      agent: false,
      family,
      signal: input.signal,
      lookup: pinnedLookup,
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain,text/markdown;q=0.9",
        "accept-encoding": "identity",
        "user-agent": "Baase-Studio-Link-Snapshot/1.0"
      }
    }, (response) => resolve({
      statusCode: response.statusCode ?? 0,
      headers: response.headers,
      body: response
    }));
    request.once("error", reject);
    request.end();
  });
}

function isForbiddenAddress(address: string) {
  const normalized = address.toLowerCase().split("%", 1)[0]!;
  if (isIP(normalized) === 4) return isForbiddenIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  const bytes = ipv6Bytes(normalized);
  if (!bytes) return true;
  if (bytes.every((byte) => byte === 0)) return true;
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return true;
  if ((bytes[0]! & 0xfe) === 0xfc) return true;
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true;
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0) return true;
  if (bytes[0] === 0xff) return true;
  const compatible = bytes.slice(0, 12).every((byte) => byte === 0);
  if (compatible && isForbiddenIpv4(bytes.slice(12).join("."))) return true;
  const mapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  return mapped && isForbiddenIpv4(bytes.slice(12).join("."));
}

function isForbiddenIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 192 && b === 0 && octets[2] === 2)
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0 && octets[2] === 113)
    || a >= 224;
}

function ipv6Bytes(address: string) {
  let source = address;
  const dotted = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/u.exec(source)?.[1];
  if (dotted) {
    const octets = dotted.split(".").map(Number);
    if (octets.length !== 4 || octets.some((value) => value < 0 || value > 255)) return null;
    source = source.slice(0, -dotted.length) + `${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    const value = Number.parseInt(group || "0", 16);
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) return null;
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

function readHeader(headers: StudioLinkFetchResponse["headers"], name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function isRedirect(statusCode: number) {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function studioAssetKey(scope: StudioOwnerScope, documentId: string, fileName: string) {
  return `workspaces/${scope.workspaceId}/studio/${scope.ownerProfileId}/${documentId}/${randomUUID()}-${sanitizeFilename(fileName)}`;
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

function documentNotFound() {
  return new ApiError(404, "STUDIO_DOCUMENT_NOT_FOUND", "Documento do Studio não encontrado.");
}

function assetNotFound() {
  return new ApiError(404, "STUDIO_ASSET_NOT_FOUND", "Captura do Studio não encontrada.");
}

function storageUnavailable() {
  return new ApiError(503, "OBJECT_STORAGE_UNAVAILABLE", "Não foi possível acessar o armazenamento de arquivos. Tente novamente.");
}

function linkFetchFailed() {
  return new ApiError(502, "STUDIO_LINK_FETCH_FAILED", "Não foi possível capturar este link.");
}

function linkTooLarge() {
  return new ApiError(413, "STUDIO_LINK_RESPONSE_TOO_LARGE", "O conteúdo deste link é grande demais para captura.", {
    limit_bytes: MAX_LINK_BYTES
  });
}
