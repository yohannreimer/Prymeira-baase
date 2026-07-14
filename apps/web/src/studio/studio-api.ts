import { createBaaseHeaders, withConfiguredAuth } from "../api";
import type {
  RawStudioCollection,
  RawStudioAsset,
  RawStudioAssetResponse,
  RawStudioCollectionsResponse,
  RawStudioDocument,
  RawStudioDocumentPageResponse,
  RawStudioDocumentResponse,
  RawStudioDocumentVersion,
  RawStudioHome,
  RawStudioHomeResponse,
  RawStudioNextRitual,
  RawStudioSearchResponse,
  RawStudioSearchResult,
  RawStudioVersionsResponse,
  StudioCollection,
  StudioAsset,
  StudioCaptureMode,
  StudioDocument,
  StudioDocumentPage,
  StudioDocumentStatus,
  StudioDocumentVersion,
  StudioHome,
  StudioNextRitual,
  StudioSearchResult
} from "./studio.types";

export type StudioFetcher = (url: string, init?: RequestInit) => Promise<Response>;

type StudioApiErrorPayload = {
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
};

export class StudioApiError extends Error {
  readonly name = "StudioApiError";
  readonly statusCode: number;

  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.statusCode = status;
  }
}

function parseJson(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function studioRequest<T>(
  path: string,
  init: RequestInit = {},
  fetcher: StudioFetcher = fetch
): Promise<T> {
  const headers = new Headers(createBaaseHeaders("dono"));
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const multipartBody = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (multipartBody) headers.delete("content-type");
  else if (!headers.has("content-type")) headers.set("content-type", "application/json");

  const response = await fetcher(`/api/studio${path}`, await withConfiguredAuth({
    ...init,
    headers
  }));
  const payload = parseJson(await response.text());

  if (!response.ok) {
    const errorPayload = asRecord(payload) as StudioApiErrorPayload;
    const code = typeof errorPayload.error?.code === "string" ? errorPayload.error.code : "STUDIO_API_ERROR";
    const message = typeof errorPayload.error?.message === "string"
      ? errorPayload.error.message
      : "Não foi possível concluir a operação no Estúdio.";
    throw new StudioApiError(response.status, code, message, asRecord(errorPayload.error?.details));
  }

  return payload as T;
}

export function mapStudioAsset(raw: RawStudioAsset): StudioAsset {
  return {
    id: raw.id,
    workspaceId: required(raw.workspace_id, raw.workspaceId, "workspace_id"),
    ownerProfileId: required(raw.owner_profile_id, raw.ownerProfileId, "owner_profile_id"),
    documentId: required(raw.document_id, raw.documentId, "document_id"),
    kind: raw.kind,
    displayName: required(raw.display_name, raw.displayName, "display_name"),
    sourceUrl: raw.source_url !== undefined ? raw.source_url : raw.sourceUrl ?? null,
    finalUrl: raw.final_url !== undefined ? raw.final_url : raw.finalUrl ?? null,
    mimeType: raw.mime_type !== undefined ? raw.mime_type : raw.mimeType ?? null,
    sizeBytes: required(raw.size_bytes, raw.sizeBytes, "size_bytes"),
    extractionStatus: required(raw.extraction_status, raw.extractionStatus, "extraction_status"),
    extractedText: raw.extracted_text !== undefined ? raw.extracted_text : raw.extractedText ?? null,
    lastErrorCode: raw.last_error_code !== undefined ? raw.last_error_code : raw.lastErrorCode ?? null,
    createdAt: required(raw.created_at, raw.createdAt, "created_at"),
    updatedAt: required(raw.updated_at, raw.updatedAt, "updated_at")
  };
}

function required<T>(snakeValue: T | undefined, camelValue: T | undefined, field: string): T {
  const value = snakeValue ?? camelValue;
  if (value === undefined) throw new Error(`STUDIO_WIRE_FIELD_MISSING:${field}`);
  return value;
}

export function mapStudioDocument(raw: RawStudioDocument): StudioDocument {
  return {
    id: raw.id,
    workspaceId: required(raw.workspace_id, raw.workspaceId, "workspace_id"),
    ownerProfileId: required(raw.owner_profile_id, raw.ownerProfileId, "owner_profile_id"),
    title: raw.title,
    bodyJson: required(raw.body_json, raw.bodyJson, "body_json"),
    bodyText: required(raw.body_text, raw.bodyText, "body_text"),
    revision: raw.revision,
    captureMode: required(raw.capture_mode, raw.captureMode, "capture_mode"),
    inboxState: required(raw.inbox_state, raw.inboxState, "inbox_state"),
    isFocused: required(raw.is_focused, raw.isFocused, "is_focused"),
    status: raw.status,
    createdAt: required(raw.created_at, raw.createdAt, "created_at"),
    updatedAt: required(raw.updated_at, raw.updatedAt, "updated_at"),
    archivedAt: raw.archived_at !== undefined ? raw.archived_at : raw.archivedAt ?? null
  };
}

export function mapStudioDocumentVersion(raw: RawStudioDocumentVersion): StudioDocumentVersion {
  return {
    id: raw.id,
    workspaceId: required(raw.workspace_id, raw.workspaceId, "workspace_id"),
    ownerProfileId: required(raw.owner_profile_id, raw.ownerProfileId, "owner_profile_id"),
    documentId: required(raw.document_id, raw.documentId, "document_id"),
    versionNumber: required(raw.version_number, raw.versionNumber, "version_number"),
    bodyJson: required(raw.body_json, raw.bodyJson, "body_json"),
    bodyText: required(raw.body_text, raw.bodyText, "body_text"),
    origin: raw.origin,
    actorProfileId: required(raw.actor_profile_id, raw.actorProfileId, "actor_profile_id"),
    aiRunId: raw.ai_run_id !== undefined ? raw.ai_run_id : raw.aiRunId ?? null,
    createdAt: required(raw.created_at, raw.createdAt, "created_at")
  };
}

export function mapStudioCollection(raw: RawStudioCollection): StudioCollection {
  return {
    id: raw.id,
    workspaceId: required(raw.workspace_id, raw.workspaceId, "workspace_id"),
    ownerProfileId: required(raw.owner_profile_id, raw.ownerProfileId, "owner_profile_id"),
    name: raw.name,
    createdAt: required(raw.created_at, raw.createdAt, "created_at"),
    updatedAt: required(raw.updated_at, raw.updatedAt, "updated_at")
  };
}

export function mapStudioSearchResult(raw: RawStudioSearchResult): StudioSearchResult {
  return {
    documentId: required(raw.document_id, raw.documentId, "document_id"),
    title: raw.title,
    excerpt: raw.excerpt,
    updatedAt: required(raw.updated_at, raw.updatedAt, "updated_at"),
    collections: raw.collections.map((collection) => ({ id: collection.id, name: collection.name }))
  };
}

function mapStudioNextRitual(raw: RawStudioNextRitual): StudioNextRitual {
  return {
    id: raw.id,
    title: raw.title,
    scheduledFor: required(raw.scheduled_for, raw.scheduledFor, "scheduled_for")
  };
}

export function mapStudioHome(raw: RawStudioHome): StudioHome {
  const recentDocuments = raw.recent_documents ?? raw.recentDocuments ?? [];
  const focusedDocuments = raw.focused_documents ?? raw.focusedDocuments ?? [];
  const nextRituals = raw.next_rituals ?? raw.nextRituals ?? [];
  return {
    recentDocuments: recentDocuments.map(mapStudioDocument),
    focusedDocuments: focusedDocuments.map(mapStudioDocument),
    pendingReviewCount: raw.pending_review_count ?? raw.pendingReviewCount ?? 0,
    nextRituals: nextRituals.map(mapStudioNextRitual)
  };
}

export async function getStudioHome(fetcher: StudioFetcher = fetch, signal?: AbortSignal): Promise<StudioHome> {
  const response = await studioRequest<RawStudioHomeResponse>("/home", { signal }, fetcher);
  return mapStudioHome(response.home);
}

export type CreateStudioDocumentInput = {
  title: string | null;
  body_json: Record<string, unknown>;
  body_text: string;
  capture_mode: StudioCaptureMode;
};

export async function createStudioDocument(
  input: CreateStudioDocumentInput,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioDocument> {
  const response = await studioRequest<RawStudioDocumentResponse>("/documents", {
    method: "POST",
    body: JSON.stringify(input),
    signal
  }, fetcher);
  return mapStudioDocument(response.document);
}

export async function attachStudioFile(
  documentId: string,
  file: Blob,
  filename: string,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioAsset> {
  const form = new FormData();
  form.append("file", file, filename);
  const response = await studioRequest<RawStudioAssetResponse>(
    `/documents/${encodeURIComponent(documentId)}/assets`,
    { method: "POST", body: form, signal },
    fetcher
  );
  return mapStudioAsset(response.asset);
}

export async function attachStudioLink(
  documentId: string,
  url: string,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioAsset> {
  const response = await studioRequest<RawStudioAssetResponse>(
    `/documents/${encodeURIComponent(documentId)}/assets`,
    { method: "POST", body: JSON.stringify({ url }), signal },
    fetcher
  );
  return mapStudioAsset(response.asset);
}

export async function getStudioDocument(documentId: string, fetcher: StudioFetcher = fetch): Promise<StudioDocument> {
  const response = await studioRequest<RawStudioDocumentResponse>(`/documents/${encodeURIComponent(documentId)}`, {}, fetcher);
  return mapStudioDocument(response.document);
}

export async function listStudioDocuments(
  query: { status?: StudioDocumentStatus; limit?: number; cursor?: string } = {},
  fetcher: StudioFetcher = fetch
): Promise<StudioDocumentPage> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  const suffix = params.size ? `?${params.toString()}` : "";
  const response = await studioRequest<RawStudioDocumentPageResponse>(`/documents${suffix}`, {}, fetcher);
  return {
    items: response.documents.map(mapStudioDocument),
    nextCursor: response.next_cursor !== undefined ? response.next_cursor : response.nextCursor ?? null
  };
}

export async function listStudioCollections(fetcher: StudioFetcher = fetch): Promise<StudioCollection[]> {
  const response = await studioRequest<RawStudioCollectionsResponse>("/collections", {}, fetcher);
  return response.collections.map(mapStudioCollection);
}

export async function searchStudioDocuments(query: string, limit = 20, fetcher: StudioFetcher = fetch): Promise<StudioSearchResult[]> {
  const params = new URLSearchParams({ query, limit: String(limit) });
  const response = await studioRequest<RawStudioSearchResponse>(`/search?${params.toString()}`, {}, fetcher);
  return response.results.map(mapStudioSearchResult);
}

export async function listStudioDocumentVersions(documentId: string, fetcher: StudioFetcher = fetch): Promise<StudioDocumentVersion[]> {
  const response = await studioRequest<RawStudioVersionsResponse>(`/documents/${encodeURIComponent(documentId)}/versions`, {}, fetcher);
  return response.versions.map(mapStudioDocumentVersion);
}
