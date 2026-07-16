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
  RawStudioStructure,
  RawStudioStructureResponse,
  RawStudioStructuresResponse,
  RawStudioRitualSession,
  RawStudioRitualSessionResponse,
  RawStudioRitualSessionsResponse,
  RawStudioVersionsResponse,
  StudioCollection,
  StudioAsset,
  StudioCaptureMode,
  StudioCheckpointReason,
  StudioDocument,
  StudioDocumentPage,
  StudioDocumentStatus,
  StudioDocumentVersion,
  StudioHome,
  StudioNextRitual,
  StudioSearchResult,
  StudioGoalMetric,
  StudioRitualCadence,
  StudioStructure,
  StudioStructureKind,
  StudioStructureLifecycleStatus,
  StudioRitualSession,
  StudioCitation,
  StudioSuggestion,
  StudioRelatedThought,
  StudioInternalCitationTarget,
  StudioProactivitySettings,
  StudioProactiveSignal,
  StudioOperationDraft,
  StudioOperationPreview,
  StudioOperationalLink
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
    idempotencyKey: raw.idempotency_key !== undefined ? raw.idempotency_key : raw.idempotencyKey ?? null,
    kind: raw.kind,
    displayName: required(raw.display_name, raw.displayName, "display_name"),
    sourceUrl: raw.source_url !== undefined ? raw.source_url : raw.sourceUrl ?? null,
    finalUrl: raw.final_url !== undefined ? raw.final_url : raw.finalUrl ?? null,
    mimeType: raw.mime_type !== undefined ? raw.mime_type : raw.mimeType ?? null,
    sizeBytes: required(raw.size_bytes, raw.sizeBytes, "size_bytes"),
    extractionStatus: required(raw.extraction_status, raw.extractionStatus, "extraction_status"),
    extractedText: raw.extracted_text !== undefined ? raw.extracted_text : raw.extractedText ?? null,
    lastErrorCode: raw.last_error_code !== undefined ? raw.last_error_code : raw.lastErrorCode ?? null,
    attemptCount: raw.attempt_count ?? raw.attemptCount ?? 0,
    nextAttemptAt: raw.next_attempt_at !== undefined ? raw.next_attempt_at : raw.nextAttemptAt ?? null,
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
    captureKey: raw.capture_key !== undefined ? raw.capture_key : raw.captureKey ?? null,
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
    archivedAt: raw.archived_at !== undefined ? raw.archived_at : raw.archivedAt ?? null,
    trashedAt: raw.trashed_at !== undefined ? raw.trashed_at : raw.trashedAt ?? null,
    preTrashStatus: raw.pre_trash_status !== undefined ? raw.pre_trash_status : raw.preTrashStatus ?? null
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
    createdAt: required(raw.created_at, raw.createdAt, "created_at"),
    title: raw.title ?? null,
    checkpointReason: raw.checkpoint_reason ?? raw.checkpointReason,
    sourceRevision: raw.source_revision !== undefined ? raw.source_revision : raw.sourceRevision ?? null,
    isLegacy: raw.is_legacy ?? raw.isLegacy
  };
}

export function mapStudioStructure(raw: RawStudioStructure): StudioStructure {
  return {
    id: raw.id,
    workspaceId: required(raw.workspace_id, raw.workspaceId, "workspace_id"),
    ownerProfileId: required(raw.owner_profile_id, raw.ownerProfileId, "owner_profile_id"),
    documentId: required(raw.document_id, raw.documentId, "document_id"),
    documentTitle: raw.document_title !== undefined ? raw.document_title : raw.documentTitle,
    kind: raw.kind,
    lifecycleStatus: required(raw.lifecycle_status, raw.lifecycleStatus, "lifecycle_status"),
    revision: raw.revision,
    horizonAt: raw.horizon_at !== undefined ? raw.horizon_at : raw.horizonAt ?? null,
    metricJson: raw.metric_json !== undefined ? raw.metric_json : raw.metricJson ?? null,
    cadenceJson: raw.cadence_json !== undefined ? raw.cadence_json : raw.cadenceJson ?? null,
    nextRunAt: raw.next_run_at !== undefined ? raw.next_run_at : raw.nextRunAt ?? null,
    propertiesJson: required(raw.properties_json, raw.propertiesJson, "properties_json"),
    createdAt: required(raw.created_at, raw.createdAt, "created_at"),
    updatedAt: required(raw.updated_at, raw.updatedAt, "updated_at"),
    archivedAt: raw.archived_at !== undefined ? raw.archived_at : raw.archivedAt ?? null
  };
}

export function mapStudioRitualSession(raw: RawStudioRitualSession): StudioRitualSession {
  return {
    id: raw.id,
    workspaceId: required(raw.workspace_id, raw.workspaceId, "workspace_id"),
    ownerProfileId: required(raw.owner_profile_id, raw.ownerProfileId, "owner_profile_id"),
    ritualId: required(raw.ritual_id, raw.ritualId, "ritual_id"),
    status: raw.status,
    revision: raw.revision,
    contextJson: raw.context_json !== undefined ? raw.context_json : raw.contextJson ?? null,
    preparationJson: raw.preparation_json !== undefined ? raw.preparation_json : raw.preparationJson ?? null,
    answersJson: raw.answers_json ?? raw.answersJson ?? {},
    synthesisJson: raw.synthesis_json !== undefined ? raw.synthesis_json : raw.synthesisJson ?? null,
    prepareAiRunId: raw.prepare_ai_run_id !== undefined ? raw.prepare_ai_run_id : raw.prepareAiRunId ?? null,
    synthesisAiRunId: raw.synthesis_ai_run_id !== undefined ? raw.synthesis_ai_run_id : raw.synthesisAiRunId ?? null,
    synthesisToken: raw.synthesis_token !== undefined ? raw.synthesis_token : raw.synthesisToken ?? null,
    synthesisLeaseExpiresAt: raw.synthesis_lease_expires_at !== undefined ? raw.synthesis_lease_expires_at : raw.synthesisLeaseExpiresAt ?? null,
    synthesisFailureCode: raw.synthesis_failure_code !== undefined ? raw.synthesis_failure_code : raw.synthesisFailureCode ?? null,
    failureCode: raw.failure_code !== undefined ? raw.failure_code : raw.failureCode ?? null,
    createdAt: required(raw.created_at, raw.createdAt, "created_at"),
    updatedAt: required(raw.updated_at, raw.updatedAt, "updated_at"),
    completedAt: raw.completed_at !== undefined ? raw.completed_at : raw.completedAt ?? null
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
    collections: raw.collections.map((collection) => ({ id: collection.id, name: collection.name })),
    structures: raw.structures ?? []
  };
}

function mapStudioNextRitual(raw: RawStudioNextRitual): StudioNextRitual {
  return {
    id: raw.id,
    title: raw.title,
    scheduledFor: required(raw.scheduled_for, raw.scheduledFor, "scheduled_for"),
    timezone: raw.timezone
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

export async function getStudioProactivitySettings(
  fetcher: StudioFetcher = fetch,
  signal?: AbortSignal
): Promise<StudioProactivitySettings> {
  const response = await studioRequest<{ settings: Record<string, unknown> }>(
    "/proactivity/settings", { signal }, fetcher
  );
  return mapProactivitySettings(response.settings);
}

export async function updateStudioProactivitySettings(
  input: Partial<Omit<StudioProactivitySettings, "updatedAt">>,
  fetcher: StudioFetcher = fetch,
  signal?: AbortSignal
): Promise<StudioProactivitySettings> {
  const response = await studioRequest<{ settings: Record<string, unknown> }>("/proactivity/settings", {
    method: "PATCH",
    body: JSON.stringify({
      ritual_reminder: input.ritualReminder,
      stale_goal: input.staleGoal,
      recurring_theme: input.recurringTheme,
      decision_review: input.decisionReview,
      operational_change: input.operationalChange,
      focused_content: input.focusedContent,
      stale_goal_after_days: input.staleGoalAfterDays
    }),
    signal
  }, fetcher);
  return mapProactivitySettings(response.settings);
}

export async function listStudioProactiveSignals(
  limit = 1,
  fetcher: StudioFetcher = fetch,
  signal?: AbortSignal
): Promise<StudioProactiveSignal[]> {
  const response = await studioRequest<{ signals: Array<Record<string, unknown>> }>(
    `/proactivity/signals?limit=${limit}`, { signal }, fetcher
  );
  return response.signals.map(mapProactiveSignal);
}

export async function snoozeStudioProactiveSignal(
  signalId: string,
  until: string,
  fetcher: StudioFetcher = fetch
): Promise<StudioProactiveSignal> {
  const response = await studioRequest<{ signal: Record<string, unknown> }>(
    `/proactivity/signals/${encodeURIComponent(signalId)}/snooze`,
    { method: "POST", body: JSON.stringify({ until }) }, fetcher
  );
  return mapProactiveSignal(response.signal);
}

export async function dismissStudioProactiveSignal(
  signalId: string,
  fetcher: StudioFetcher = fetch
): Promise<StudioProactiveSignal> {
  const response = await studioRequest<{ signal: Record<string, unknown> }>(
    `/proactivity/signals/${encodeURIComponent(signalId)}/dismiss`,
    { method: "POST", body: JSON.stringify({}) }, fetcher
  );
  return mapProactiveSignal(response.signal);
}

function mapProactivitySettings(raw: Record<string, unknown>): StudioProactivitySettings {
  return {
    ritualReminder: booleanField(raw, "ritual_reminder", "ritualReminder"),
    staleGoal: booleanField(raw, "stale_goal", "staleGoal"),
    recurringTheme: booleanField(raw, "recurring_theme", "recurringTheme"),
    decisionReview: booleanField(raw, "decision_review", "decisionReview"),
    operationalChange: booleanField(raw, "operational_change", "operationalChange"),
    focusedContent: booleanField(raw, "focused_content", "focusedContent"),
    staleGoalAfterDays: numberField(raw, "stale_goal_after_days", "staleGoalAfterDays"),
    updatedAt: stringField(raw, "updated_at", "updatedAt")
  };
}

function mapProactiveSignal(raw: Record<string, unknown>): StudioProactiveSignal {
  return {
    id: stringField(raw, "id", "id"),
    type: stringField(raw, "type", "type") as StudioProactiveSignal["type"],
    sourceId: stringField(raw, "source_id", "sourceId"),
    sourceScheduledFor: stringField(raw, "source_scheduled_for", "sourceScheduledFor"),
    title: stringField(raw, "title", "title"),
    reason: stringField(raw, "reason", "reason"),
    status: stringField(raw, "status", "status") as StudioProactiveSignal["status"],
    nextReminderAt: stringField(raw, "next_reminder_at", "nextReminderAt"),
    createdAt: stringField(raw, "created_at", "createdAt"),
    updatedAt: stringField(raw, "updated_at", "updatedAt"),
    dismissedAt: nullableStringField(raw, "dismissed_at", "dismissedAt")
  };
}

function rawField(raw: Record<string, unknown>, snake: string, camel: string) {
  return raw[snake] === undefined ? raw[camel] : raw[snake];
}

function booleanField(raw: Record<string, unknown>, snake: string, camel: string) {
  const value = rawField(raw, snake, camel);
  if (typeof value !== "boolean") throw new Error(`STUDIO_WIRE_FIELD_MISSING:${snake}`);
  return value;
}

function numberField(raw: Record<string, unknown>, snake: string, camel: string) {
  const value = rawField(raw, snake, camel);
  if (typeof value !== "number") throw new Error(`STUDIO_WIRE_FIELD_MISSING:${snake}`);
  return value;
}

function stringField(raw: Record<string, unknown>, snake: string, camel: string) {
  const value = rawField(raw, snake, camel);
  if (typeof value !== "string") throw new Error(`STUDIO_WIRE_FIELD_MISSING:${snake}`);
  return value;
}

function nullableStringField(raw: Record<string, unknown>, snake: string, camel: string) {
  const value = rawField(raw, snake, camel);
  if (value !== null && typeof value !== "string") throw new Error(`STUDIO_WIRE_FIELD_MISSING:${snake}`);
  return value;
}

export type CreateStudioDocumentInput = {
  title: string | null;
  body_json: Record<string, unknown>;
  body_text: string;
  capture_mode: StudioCaptureMode;
  /** Client-only operation key. It is sent as a header, never persisted from the JSON body. */
  capture_key: string;
};

export async function createStudioDocument(
  input: CreateStudioDocumentInput,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioDocument> {
  const { capture_key: captureKey, ...body } = input;
  const response = await studioRequest<RawStudioDocumentResponse>("/documents", {
    method: "POST",
    headers: { "idempotency-key": captureKey },
    body: JSON.stringify(body),
    signal
  }, fetcher);
  return mapStudioDocument(response.document);
}

export async function attachStudioFile(
  documentId: string,
  file: Blob,
  filename: string,
  idempotencyKey: string,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioAsset> {
  const form = new FormData();
  form.append("file", file, filename);
  const response = await studioRequest<RawStudioAssetResponse>(
    `/documents/${encodeURIComponent(documentId)}/assets`,
    { method: "POST", headers: { "idempotency-key": idempotencyKey }, body: form, signal },
    fetcher
  );
  return mapStudioAsset(response.asset);
}

export async function attachStudioLink(
  documentId: string,
  url: string,
  idempotencyKey: string,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioAsset> {
  const response = await studioRequest<RawStudioAssetResponse>(
    `/documents/${encodeURIComponent(documentId)}/assets`,
    { method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify({ url }), signal },
    fetcher
  );
  return mapStudioAsset(response.asset);
}

export async function getStudioDocumentAssets(
  documentId: string,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioAsset[]> {
  const response = await studioRequest<{ assets: RawStudioAsset[] }>(
    `/documents/${encodeURIComponent(documentId)}/assets`,
    { signal },
    fetcher
  );
  return response.assets.map(mapStudioAsset);
}

export async function getStudioAsset(
  assetId: string,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioAsset> {
  const response = await studioRequest<RawStudioAssetResponse>(
    `/assets/${encodeURIComponent(assetId)}`,
    { signal },
    fetcher
  );
  return mapStudioAsset(response.asset);
}

export async function retryStudioAsset(
  assetId: string,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioAsset> {
  const response = await studioRequest<RawStudioAssetResponse>(
    `/assets/${encodeURIComponent(assetId)}/retry`,
    { method: "POST", body: JSON.stringify({}), signal },
    fetcher
  );
  return mapStudioAsset(response.asset);
}

export async function getStudioAssetDownload(
  assetId: string,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<{ url: string; expiresInSeconds: number }> {
  const response = await studioRequest<{ url: string; expires_in_seconds?: number; expiresInSeconds?: number }>(
    `/assets/${encodeURIComponent(assetId)}/download`,
    { signal },
    fetcher
  );
  return {
    url: response.url,
    expiresInSeconds: response.expires_in_seconds ?? response.expiresInSeconds ?? 0
  };
}

export async function getStudioDocument(
  documentId: string,
  fetcher: StudioFetcher = fetch,
  signal?: AbortSignal
): Promise<StudioDocument> {
  const response = await studioRequest<RawStudioDocumentResponse>(
    `/documents/${encodeURIComponent(documentId)}`,
    { signal },
    fetcher
  );
  return mapStudioDocument(response.document);
}

export type UpdateStudioDocumentInput = {
  expected_revision: number;
  title?: string | null;
  body_json?: Record<string, unknown>;
  body_text?: string;
  capture_mode?: StudioCaptureMode;
  inbox_state?: "pending_review" | "reviewed";
  is_focused?: boolean;
};

export async function updateStudioDocument(
  documentId: string,
  input: UpdateStudioDocumentInput,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioDocument> {
  const response = await studioRequest<RawStudioDocumentResponse>(
    `/documents/${encodeURIComponent(documentId)}`,
    { method: "PATCH", body: JSON.stringify(input), signal },
    fetcher
  );
  return mapStudioDocument(response.document);
}

export async function createStudioCheckpoint(
  documentId: string,
  input: { expected_revision: number; reason: StudioCheckpointReason },
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch,
  options: { keepalive?: boolean } = {}
): Promise<StudioDocumentVersion> {
  const response = await studioRequest<{ version: RawStudioDocumentVersion }>(
    `/documents/${encodeURIComponent(documentId)}/checkpoints`,
    { method: "POST", body: JSON.stringify(input), signal, keepalive: options.keepalive },
    fetcher
  );
  return mapStudioDocumentVersion(response.version);
}

export async function createStudioExitCheckpoint(
  documentId: string,
  input: { known_revision: number },
  fetcher: StudioFetcher = fetch
): Promise<{ document: StudioDocument; version: StudioDocumentVersion }> {
  const response = await studioRequest<{
    document: RawStudioDocument;
    version: RawStudioDocumentVersion;
  }>(
    `/documents/${encodeURIComponent(documentId)}/exit-checkpoint`,
    { method: "POST", body: JSON.stringify(input), keepalive: true },
    fetcher
  );
  return { document: mapStudioDocument(response.document), version: mapStudioDocumentVersion(response.version) };
}

export async function listStudioDocuments(
  query: { status?: StudioDocumentStatus; limit?: number; cursor?: string; inbox_state?: "pending_review" | "reviewed"; collection_id?: string } = {},
  fetcher: StudioFetcher = fetch,
  signal?: AbortSignal
): Promise<StudioDocumentPage> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.inbox_state) params.set("inbox_state", query.inbox_state);
  if (query.collection_id) params.set("collection_id", query.collection_id);
  const suffix = params.size ? `?${params.toString()}` : "";
  const response = await studioRequest<RawStudioDocumentPageResponse>(`/documents${suffix}`, { signal }, fetcher);
  const rawCollections = response.collections_by_document_id ?? response.collectionsByDocumentId ?? {};
  return {
    items: response.documents.map(mapStudioDocument),
    nextCursor: response.next_cursor !== undefined ? response.next_cursor : response.nextCursor ?? null,
    collectionsByDocumentId: Object.fromEntries(Object.entries(rawCollections).map(([documentId, items]) => [
      documentId,
      items.map(mapStudioCollection)
    ]))
  };
}

export async function listStudioCollections(fetcher: StudioFetcher = fetch, signal?: AbortSignal): Promise<StudioCollection[]> {
  const response = await studioRequest<RawStudioCollectionsResponse>("/collections", { signal }, fetcher);
  return response.collections.map(mapStudioCollection);
}

export async function createStudioCollection(name: string, signal?: AbortSignal, fetcher: StudioFetcher = fetch): Promise<StudioCollection> {
  const response = await studioRequest<{ collection: RawStudioCollection }>("/collections", {
    method: "POST", body: JSON.stringify({ name }), signal
  }, fetcher);
  return mapStudioCollection(response.collection);
}

export async function renameStudioCollection(collectionId: string, name: string, signal?: AbortSignal, fetcher: StudioFetcher = fetch): Promise<StudioCollection> {
  const response = await studioRequest<{ collection: RawStudioCollection }>(`/collections/${encodeURIComponent(collectionId)}`, {
    method: "PATCH", body: JSON.stringify({ name }), signal
  }, fetcher);
  return mapStudioCollection(response.collection);
}

export async function deleteStudioCollection(collectionId: string, signal?: AbortSignal, fetcher: StudioFetcher = fetch): Promise<StudioCollection> {
  const response = await studioRequest<{ collection: RawStudioCollection }>(`/collections/${encodeURIComponent(collectionId)}`, {
    method: "DELETE", signal
  }, fetcher);
  return mapStudioCollection(response.collection);
}

export async function searchStudioDocuments(
  query: string,
  limit = 20,
  fetcher: StudioFetcher = fetch,
  signal?: AbortSignal
): Promise<StudioSearchResult[]> {
  const params = new URLSearchParams({ query, limit: String(limit) });
  const response = await studioRequest<RawStudioSearchResponse>(`/search?${params.toString()}`, { signal }, fetcher);
  return response.results.map(mapStudioSearchResult);
}

export async function archiveStudioDocument(
  documentId: string,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioDocument> {
  const response = await studioRequest<RawStudioDocumentResponse>(
    `/documents/${encodeURIComponent(documentId)}/archive`,
    { method: "POST", signal },
    fetcher
  );
  return mapStudioDocument(response.document);
}

export async function restoreStudioDocument(
  documentId: string,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioDocument> {
  const response = await studioRequest<RawStudioDocumentResponse>(
    `/documents/${encodeURIComponent(documentId)}/restore`,
    { method: "POST", signal },
    fetcher
  );
  return mapStudioDocument(response.document);
}

export async function addStudioDocumentToCollection(
  collectionId: string,
  documentId: string,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<void> {
  await studioRequest(
    `/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentId)}`,
    { method: "PUT", signal },
    fetcher
  );
}

export async function removeStudioDocumentFromCollection(
  collectionId: string,
  documentId: string,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<void> {
  await studioRequest(
    `/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentId)}`,
    { method: "DELETE", signal },
    fetcher
  );
}

export async function listStudioDocumentVersions(
  documentId: string,
  fetcher: StudioFetcher = fetch,
  signal?: AbortSignal
): Promise<StudioDocumentVersion[]> {
  const response = await studioRequest<RawStudioVersionsResponse>(
    `/documents/${encodeURIComponent(documentId)}/versions`,
    { signal },
    fetcher
  );
  return response.versions.map(mapStudioDocumentVersion);
}

export async function restoreStudioDocumentVersion(
  documentId: string,
  versionId: string,
  input: { expected_revision: number },
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<{ document: StudioDocument; version: StudioDocumentVersion }> {
  const response = await studioRequest<{
    document: RawStudioDocument;
    version: RawStudioDocumentVersion;
  }>(
    `/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/restore`,
    { method: "POST", body: JSON.stringify(input), signal },
    fetcher
  );
  return {
    document: mapStudioDocument(response.document),
    version: mapStudioDocumentVersion(response.version)
  };
}

export type StudioStructurePage = { items: StudioStructure[]; nextCursor: string | null };

export async function listStudioStructures(
  query: {
    kind?: StudioStructureKind;
    lifecycle_status?: StudioStructureLifecycleStatus;
    document_id?: string;
    cursor?: string;
    limit?: number;
  } = {},
  fetcher: StudioFetcher = fetch,
  signal?: AbortSignal
): Promise<StudioStructurePage> {
  const params = new URLSearchParams();
  if (query.kind) params.set("kind", query.kind);
  if (query.lifecycle_status) params.set("lifecycle_status", query.lifecycle_status);
  if (query.document_id) params.set("document_id", query.document_id);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const suffix = params.size ? `?${params.toString()}` : "";
  const response = await studioRequest<RawStudioStructuresResponse>(`/structures${suffix}`, { signal }, fetcher);
  return {
    items: response.structures.map(mapStudioStructure),
    nextCursor: response.next_cursor !== undefined ? response.next_cursor : response.nextCursor ?? null
  };
}

export type CreateStudioStructureInput = {
  kind: StudioStructureKind;
  horizon_at?: string | null;
  metric_json?: StudioGoalMetric | null;
  cadence_json?: StudioRitualCadence | null;
  properties_json: Record<string, unknown>;
};

export async function createStudioStructure(
  documentId: string,
  input: CreateStudioStructureInput,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioStructure> {
  const response = await studioRequest<RawStudioStructureResponse>(
    `/documents/${encodeURIComponent(documentId)}/structures`,
    { method: "POST", body: JSON.stringify(input), signal },
    fetcher
  );
  return mapStudioStructure(response.structure);
}

export type UpdateStudioStructureInput = {
  expected_revision: number;
  horizon_at?: string | null;
  metric_json?: StudioGoalMetric | null;
  cadence_json?: StudioRitualCadence | null;
  properties_json?: Record<string, unknown>;
};

export async function updateStudioStructure(
  structureId: string,
  input: UpdateStudioStructureInput,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioStructure> {
  const response = await studioRequest<RawStudioStructureResponse>(
    `/structures/${encodeURIComponent(structureId)}`,
    { method: "PATCH", body: JSON.stringify(input), signal },
    fetcher
  );
  return mapStudioStructure(response.structure);
}

export async function archiveStudioStructure(
  structureId: string,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioStructure> {
  const response = await studioRequest<RawStudioStructureResponse>(
    `/structures/${encodeURIComponent(structureId)}`,
    { method: "DELETE", signal },
    fetcher
  );
  return mapStudioStructure(response.structure);
}

export type StudioRitualSessionPage = { items: StudioRitualSession[]; nextCursor: string | null };

export async function listStudioRitualSessions(
  ritualId: string,
  query: { cursor?: string; limit?: number } = {},
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioRitualSessionPage> {
  const params = new URLSearchParams();
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const suffix = params.size ? `?${params.toString()}` : "";
  const response = await studioRequest<RawStudioRitualSessionsResponse>(
    `/rituals/${encodeURIComponent(ritualId)}/sessions${suffix}`,
    { signal },
    fetcher
  );
  return {
    items: response.sessions.map(mapStudioRitualSession),
    nextCursor: response.next_cursor !== undefined ? response.next_cursor : response.nextCursor ?? null
  };
}

export async function startStudioRitualSession(
  ritualId: string,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioRitualSession> {
  const response = await studioRequest<RawStudioRitualSessionResponse>(
    `/rituals/${encodeURIComponent(ritualId)}/sessions`,
    { method: "POST", body: JSON.stringify({}), signal },
    fetcher
  );
  return mapStudioRitualSession(response.session);
}

export async function updateStudioRitualSession(
  sessionId: string,
  input: { expected_revision: number; answers: Record<string, string> },
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioRitualSession> {
  const response = await studioRequest<RawStudioRitualSessionResponse>(
    `/ritual-sessions/${encodeURIComponent(sessionId)}`,
    { method: "PATCH", body: JSON.stringify(input), signal },
    fetcher
  );
  return mapStudioRitualSession(response.session);
}

export async function finishStudioRitualSession(
  sessionId: string,
  input: { expected_revision: number; answers: Record<string, string>; request_synthesis: boolean },
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioRitualSession> {
  const response = await studioRequest<RawStudioRitualSessionResponse>(
    `/ritual-sessions/${encodeURIComponent(sessionId)}/finish`,
    { method: "POST", body: JSON.stringify(input), signal },
    fetcher
  );
  return mapStudioRitualSession(response.session);
}

type RawStudioCitation = {
  source_type?: StudioCitation["sourceType"];
  sourceType?: StudioCitation["sourceType"];
  source_id?: string | null;
  sourceId?: string | null;
  url: string | null;
  label: string;
  excerpt: string;
  observed_at?: string;
  observedAt?: string;
  period_from?: string | null;
  periodFrom?: string | null;
  period_to?: string | null;
  periodTo?: string | null;
  metadata?: Record<string, unknown>;
};

type RawStudioSuggestion = {
  id: string;
  document_id?: string | null;
  documentId?: string | null;
  conversation_id?: string | null;
  conversationId?: string | null;
  ai_run_id?: string;
  aiRunId?: string;
  kind: "text";
  payload_json?: Record<string, unknown>;
  payloadJson?: Record<string, unknown>;
  status: StudioSuggestion["status"];
  accepted_version_id?: string | null;
  acceptedVersionId?: string | null;
  created_at?: string;
  createdAt?: string;
  decided_at?: string | null;
  decidedAt?: string | null;
};

export type StudioAssistantTurnInput = {
  conversationId?: string | null;
  documentId?: string | null;
  message: string;
  allowExternalResearch?: boolean;
  requestTextSuggestion?: boolean;
  selectedTextContext?: string | null;
  operationalContext?: {
    from: string | null;
    to: string | null;
    resourceTypes: Array<"dashboard" | "task" | "routine" | "process" | "training" | "announcement" | "people">;
    personIds: string[];
  } | null;
};

export type StudioAssistantStreamHandlers = {
  onRun?(run: { aiRunId: string; conversationId: string }): void;
  onDelta?(text: string): void;
  onCitation?(citation: StudioCitation): void;
  onSuggestion?(suggestion: StudioSuggestion): void;
  onDone?(messageId: string): void;
};

export class StudioAssistantStreamError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean) {
    super(code);
    this.name = "StudioAssistantStreamError";
  }
}

export function startStudioAssistantTurn(
  input: StudioAssistantTurnInput,
  handlers: StudioAssistantStreamHandlers,
  fetcher: StudioFetcher = fetch
) {
  const controller = new AbortController();
  const finished = runStudioAssistantTurn(input, handlers, controller.signal, fetcher);
  return { controller, finished };
}

async function runStudioAssistantTurn(
  input: StudioAssistantTurnInput,
  handlers: StudioAssistantStreamHandlers,
  signal: AbortSignal,
  fetcher: StudioFetcher
) {
  const headers = new Headers(createBaaseHeaders("dono"));
  headers.set("content-type", "application/json");
  headers.set("accept", "text/event-stream");
  const response = await fetcher("/api/studio/assistant/turns", await withConfiguredAuth({
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      conversation_id: input.conversationId ?? null,
      document_id: input.documentId ?? null,
      message: input.message,
      allow_external_research: input.allowExternalResearch ?? false,
      request_text_suggestion: input.requestTextSuggestion ?? false,
      selected_text_context: input.selectedTextContext?.slice(0, 4_000) || null,
      operational_context: input.operationalContext ? {
        from: input.operationalContext.from,
        to: input.operationalContext.to,
        resource_types: input.operationalContext.resourceTypes,
        person_ids: input.operationalContext.personIds
      } : null
    })
  }));
  if (!response.ok) {
    const payload = asRecord(parseJson(await response.text())) as StudioApiErrorPayload;
    throw new StudioApiError(
      response.status,
      typeof payload.error?.code === "string" ? payload.error.code : "STUDIO_ASSISTANT_FAILED",
      typeof payload.error?.message === "string" ? payload.error.message : "O copiloto está indisponível agora.",
      asRecord(payload.error?.details)
    );
  }
  await parseStudioSseStream(response, handlers, signal);
}

export async function parseStudioSseStream(
  response: Response,
  handlers: StudioAssistantStreamHandlers,
  signal?: AbortSignal
) {
  if (!response.body) throw new StudioAssistantStreamError("STUDIO_ASSISTANT_EMPTY_STREAM", true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];
  let completed = false;

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventName = "message";
      return;
    }
    const data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    dataLines = [];
    const currentEvent = eventName;
    eventName = "message";
    if (currentEvent === "run") handlers.onRun?.({
      aiRunId: String(data.ai_run_id ?? data.aiRunId ?? ""),
      conversationId: String(data.conversation_id ?? data.conversationId ?? "")
    });
    else if (currentEvent === "delta") handlers.onDelta?.(String(data.text ?? ""));
    else if (currentEvent === "citation") handlers.onCitation?.(mapStudioCitation(data as RawStudioCitation));
    else if (currentEvent === "suggestion") handlers.onSuggestion?.(mapStudioSuggestion(data as RawStudioSuggestion));
    else if (currentEvent === "done") {
      completed = true;
      handlers.onDone?.(String(data.message_id ?? data.messageId ?? ""));
    } else if (currentEvent === "error") {
      throw new StudioAssistantStreamError(String(data.code ?? "STUDIO_ASSISTANT_FAILED"), data.retryable !== false);
    }
  };

  const consume = (flush = false) => {
    let boundary = buffer.indexOf("\n");
    while (boundary >= 0) {
      const rawLine = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line) dispatch();
      else if (!line.startsWith(":")) {
        const separator = line.indexOf(":");
        const field = separator < 0 ? line : line.slice(0, separator);
        let value = separator < 0 ? "" : line.slice(separator + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") eventName = value;
        else if (field === "data") dataLines.push(value);
      }
      boundary = buffer.indexOf("\n");
    }
    if (flush && buffer) {
      buffer += "\n";
      consume(false);
    }
  };

  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      consume();
    }
    buffer += decoder.decode();
    consume(true);
    if (dataLines.length) dispatch();
    if (!completed) throw new StudioAssistantStreamError("STUDIO_ASSISTANT_INCOMPLETE", true);
  } finally {
    reader.releaseLock();
  }
}

export function mapStudioCitation(raw: RawStudioCitation): StudioCitation {
  return {
    sourceType: required(raw.source_type, raw.sourceType, "source_type"),
    sourceId: raw.source_id !== undefined ? raw.source_id : raw.sourceId ?? null,
    url: raw.url,
    label: raw.label,
    excerpt: raw.excerpt,
    observedAt: required(raw.observed_at, raw.observedAt, "observed_at"),
    periodFrom: raw.period_from !== undefined ? raw.period_from : raw.periodFrom ?? null,
    periodTo: raw.period_to !== undefined ? raw.period_to : raw.periodTo ?? null,
    metadata: raw.metadata ?? {}
  };
}

export function studioCitationInternalTarget(citation: StudioCitation): StudioInternalCitationTarget | null {
  const sourceId = citation.sourceId?.trim();
  if (citation.sourceType === "studio_document") {
    return sourceId ? { kind: "studio_document", resourceId: sourceId } : null;
  }
  if (citation.sourceType !== "operational_resource" && citation.sourceType !== "operational_metric") return null;
  const metadataType = typeof citation.metadata.resourceType === "string" ? citation.metadata.resourceType : null;
  const prefixed = parsePrefixedResource(sourceId);
  const normalizedMetadataType = metadataType === "person" ? "people" : metadataType;
  if (normalizedMetadataType && prefixed && normalizedMetadataType !== prefixed.type) return null;
  const rawType = metadataType ?? prefixed?.type ?? (citation.sourceType === "operational_metric" ? "dashboard" : null);
  if (citation.sourceType === "operational_metric" && rawType !== "dashboard") return null;
  if (citation.sourceType === "operational_resource" && rawType === "dashboard") return null;
  const resourceId = prefixed?.id ?? sourceId;
  if (rawType === "dashboard") return { kind: "dashboard", resourceId: sourceId || null };
  if (rawType === "people") return resourceId ? { kind: "person", resourceId } : null;
  if (["task", "routine", "process", "training", "announcement"].includes(rawType ?? "") && resourceId) {
    return { kind: rawType as StudioInternalCitationTarget["kind"], resourceId };
  }
  return null;
}

function parsePrefixedResource(sourceId: string | undefined) {
  if (!sourceId) return null;
  const match = sourceId.match(/^(dashboard|task|routine|process|training|announcement|people|person):(.+)$/u);
  if (!match?.[1] || !match[2]?.trim()) return null;
  return { type: match[1] === "person" ? "people" : match[1], id: match[2].trim() };
}

export function mapStudioSuggestion(raw: RawStudioSuggestion): StudioSuggestion {
  const payload = asRecord(raw.payload_json ?? raw.payloadJson);
  const proposal = asRecord(payload.proposal);
  return {
    id: raw.id,
    documentId: raw.document_id !== undefined ? raw.document_id : raw.documentId ?? null,
    conversationId: raw.conversation_id !== undefined ? raw.conversation_id : raw.conversationId ?? null,
    aiRunId: required(raw.ai_run_id, raw.aiRunId, "ai_run_id"),
    kind: raw.kind,
    payload: {
      facts: Array.isArray(payload.facts) ? payload.facts.map((item) => {
        const fact = asRecord(item);
        return { statement: String(fact.statement ?? ""), citationIndexes: Array.isArray(fact.citation_indexes) ? fact.citation_indexes.map(Number) : [] };
      }) : [],
      inferences: Array.isArray(payload.inferences) ? payload.inferences.map((item) => {
        const inference = asRecord(item);
        return { statement: String(inference.statement ?? ""), basis: String(inference.basis ?? ""), confidence: String(inference.confidence ?? "medium") as "low" | "medium" | "high" };
      }) : [],
      gaps: Array.isArray(payload.gaps) ? payload.gaps.map((item) => {
        const gap = asRecord(item);
        return { question: String(gap.question ?? ""), reason: String(gap.reason ?? "") };
      }) : [],
      citations: Array.isArray(payload.citations) ? payload.citations.map((item) => mapStudioCitation(asRecord(item) as RawStudioCitation)) : [],
      proposal: {
        documentId: String(proposal.document_id ?? proposal.documentId ?? ""),
        expectedRevision: Number(proposal.expected_revision ?? proposal.expectedRevision ?? 0),
        title: typeof proposal.title === "string" ? proposal.title : null,
        bodyJson: asRecord(proposal.body_json ?? proposal.bodyJson),
        bodyText: String(proposal.body_text ?? proposal.bodyText ?? "")
      }
    },
    status: raw.status,
    acceptedVersionId: raw.accepted_version_id !== undefined ? raw.accepted_version_id : raw.acceptedVersionId ?? null,
    createdAt: required(raw.created_at, raw.createdAt, "created_at"),
    decidedAt: raw.decided_at !== undefined ? raw.decided_at : raw.decidedAt ?? null
  };
}

export async function acceptStudioSuggestion(
  suggestionId: string,
  proposal?: StudioSuggestion["payload"]["proposal"],
  signal?: AbortSignal
): Promise<StudioDocument> {
  const response = await studioRequest<{ version: RawStudioDocumentVersion; suggestion: RawStudioSuggestion }>(
    `/suggestions/${encodeURIComponent(suggestionId)}/accept`,
    { method: "POST", body: JSON.stringify({ proposal: proposal ? {
      document_id: proposal.documentId,
      expected_revision: proposal.expectedRevision,
      title: proposal.title,
      body_json: proposal.bodyJson,
      body_text: proposal.bodyText
    } : undefined }), signal }
  );
  const version = mapStudioDocumentVersion(response.version);
  const suggestion = mapStudioSuggestion(response.suggestion);
  const document = await getStudioDocument(suggestion.documentId!, fetch, signal);
  if (document.revision !== version.versionNumber) return document;
  return document;
}

export async function dismissStudioSuggestion(suggestionId: string, signal?: AbortSignal): Promise<void> {
  await studioRequest(`/suggestions/${encodeURIComponent(suggestionId)}/dismiss`, {
    method: "POST", body: JSON.stringify({}), signal
  });
}

export async function createStudioOperationPreview(
  suggestionId: string,
  draft: StudioOperationDraft,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioOperationPreview> {
  const response = await studioRequest<{ preview: Record<string, unknown> }>(
    `/suggestions/${encodeURIComponent(suggestionId)}/operation-preview`,
    { method: "POST", body: JSON.stringify(draft), signal }, fetcher
  );
  return mapStudioOperationPreview(response.preview);
}

export async function confirmStudioOperationPreview(
  suggestionId: string,
  previewId: string,
  idempotencyKey: string,
  draft: StudioOperationDraft,
  signal?: AbortSignal,
  fetcher: StudioFetcher = fetch
): Promise<StudioOperationalLink> {
  const response = await studioRequest<{ link: Record<string, unknown> }>(
    `/suggestions/${encodeURIComponent(suggestionId)}/operation-confirm`,
    {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify({ preview_id: previewId, draft }),
      signal
    }, fetcher
  );
  return mapStudioOperationalLink(response.link);
}

function mapStudioOperationPreview(raw: Record<string, unknown>): StudioOperationPreview {
  return {
    id: stringField(raw, "id", "id"),
    sourceSuggestionId: stringField(raw, "source_suggestion_id", "sourceSuggestionId"),
    sourceDocumentId: stringField(raw, "source_document_id", "sourceDocumentId"),
    resourceType: stringField(raw, "resource_type", "resourceType") as StudioOperationDraft["resource_type"],
    payload: rawField(raw, "payload", "payload") as StudioOperationDraft,
    confirmedPayload: (rawField(raw, "confirmed_payload", "confirmedPayload") ?? null) as StudioOperationDraft | null,
    status: stringField(raw, "status", "status") as StudioOperationPreview["status"],
    expiresAt: stringField(raw, "expires_at", "expiresAt"),
    idempotencyKey: nullableStringField(raw, "idempotency_key", "idempotencyKey"),
    resultResourceId: nullableStringField(raw, "result_resource_id", "resultResourceId"),
    createdAt: stringField(raw, "created_at", "createdAt"),
    updatedAt: stringField(raw, "updated_at", "updatedAt"),
    confirmedAt: nullableStringField(raw, "confirmed_at", "confirmedAt")
  };
}

function mapStudioOperationalLink(raw: Record<string, unknown>): StudioOperationalLink {
  return {
    id: stringField(raw, "id", "id"),
    previewId: stringField(raw, "preview_id", "previewId"),
    sourceSuggestionId: stringField(raw, "source_suggestion_id", "sourceSuggestionId"),
    sourceDocumentId: stringField(raw, "source_document_id", "sourceDocumentId"),
    sourceStructureId: nullableStringField(raw, "source_structure_id", "sourceStructureId"),
    resourceType: stringField(raw, "resource_type", "resourceType") as StudioOperationDraft["resource_type"],
    resourceId: stringField(raw, "resource_id", "resourceId"),
    relationType: stringField(raw, "relation_type", "relationType") as "created",
    createdByProfileId: stringField(raw, "created_by_profile_id", "createdByProfileId"),
    createdAt: stringField(raw, "created_at", "createdAt")
  };
}

export async function getStudioRelatedThoughts(documentId: string, signal?: AbortSignal): Promise<StudioRelatedThought[]> {
  const response = await studioRequest<{ related: Array<{ document: RawStudioDocument; excerpt: string; explanation: string; score: number }> }>(
    `/documents/${encodeURIComponent(documentId)}/related?limit=6`, { signal }
  );
  return response.related.map((item) => ({ ...item, document: mapStudioDocument(item.document) }));
}

export async function acceptStudioRelation(
  sourceDocumentId: string,
  targetDocumentId: string,
  signal?: AbortSignal
): Promise<void> {
  await studioRequest(`/documents/${encodeURIComponent(sourceDocumentId)}/relations`, {
    method: "POST",
    body: JSON.stringify({ target_document_id: targetDocumentId, relation_type: "related_to" }),
    signal
  });
}
