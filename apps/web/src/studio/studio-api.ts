import { createBaaseHeaders, withConfiguredAuth } from "../api";
import type {
  RawStudioCollection,
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
  if (!headers.has("content-type")) headers.set("content-type", "application/json");

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

export async function getStudioHome(fetcher: StudioFetcher = fetch): Promise<StudioHome> {
  const response = await studioRequest<RawStudioHomeResponse>("/home", {}, fetcher);
  return mapStudioHome(response.home);
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
