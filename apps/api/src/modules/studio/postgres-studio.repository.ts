import type {
  StudioCaptureMode,
  StudioAsset,
  StudioAssetCleanupJob,
  StudioAssetCleanupStatus,
  StudioAssetUploadIntent,
  StudioAssetUploadIntentStatus,
  StudioAssetExtractionStatus,
  StudioAssetKind,
  StudioCollection,
  StudioCollectionMembership,
  StudioDocument,
  StudioDocumentStatus,
  StudioDocumentVersion,
  StudioIndexJob,
  StudioRelation,
  StudioConversation,
  StudioMessage,
  StudioSuggestion,
  StudioCitation,
  StudioStructure,
  StudioRitualSession,
  CreateStudioCitation,
  StudioRepository,
  StudioOwnerScope,
  StudioSearchDocument
} from "./studio.types";
import { STUDIO_ASSET_MAX_ATTEMPTS } from "./studio.types";
import {
  prepareStudioSearchFields,
  prepareStudioSearchQuery
} from "./studio-search";
import { assertStudioEditorJson } from "./studio-security";
import {
  generatedId,
  iso,
  withOperationalTransaction,
  type OperationalClient,
  type OperationalPool
} from "../../db/operational-repository-support";

type StudioDocumentRow = {
  id: string;
  workspace_id: string;
  owner_profile_id: string;
  capture_key: string | null;
  title: string | null;
  body_json: Record<string, unknown>;
  body_text: string;
  revision: number;
  capture_mode: StudioCaptureMode;
  inbox_state: StudioDocument["inboxState"];
  is_focused: boolean;
  status: StudioDocumentStatus;
  created_at: string | Date;
  updated_at: string | Date;
  archived_at: string | Date | null;
  trashed_at: string | Date | null;
  pre_trash_status: Exclude<StudioDocumentStatus, "trashed"> | null;
  trash_claim_token: string | null;
  trash_lease_expires_at: string | Date | null;
};

type StudioDocumentVersionRow = {
  id: string;
  workspace_id: string;
  owner_profile_id: string;
  document_id: string;
  version_number: number;
  body_json: Record<string, unknown>;
  body_text: string;
  origin: StudioDocumentVersion["origin"];
  actor_profile_id: string;
  ai_run_id: string | null;
  created_at: string | Date;
  title: string | null;
  checkpoint_reason: StudioDocumentVersion["checkpointReason"];
  checkpoint_key: string | null;
  source_revision: number | null;
  is_legacy: boolean;
};
type VersionCursor = { versionNumber: number; id: string };

type StudioNextRitualRow = {
  id: string;
  document_title: string | null;
  intention: string | null;
  scheduled_for: string | Date;
  timezone: string;
};

type StudioCollectionRow = {
  id: string;
  workspace_id: string;
  owner_profile_id: string;
  name: string;
  created_at: string | Date;
  updated_at: string | Date;
};

type StudioCollectionMembershipRow = {
  id: string;
  workspace_id: string;
  owner_profile_id: string;
  collection_id: string;
  document_id: string;
  created_at: string | Date;
};

type StudioRelationRow = {
  id: string;
  workspace_id: string;
  owner_profile_id: string;
  source_document_id: string;
  target_document_id: string;
  relation_type: StudioRelation["relationType"];
  created_by_profile_id: string;
  created_at: string | Date;
};

type StudioIndexJobRow = {
  id: string;
  workspace_id: string;
  owner_profile_id: string;
  document_id: string;
  snapshot_id: string;
  document_revision: number;
  status: StudioIndexJob["status"];
  attempt_count: number;
  next_attempt_at: string | Date | null;
  last_error_code: string | null;
  claim_token: string | null;
  lease_expires_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type StudioConversationRow = {
  id: string; workspace_id: string; owner_profile_id: string; document_id: string | null;
  created_at: string | Date; updated_at: string | Date;
};

type StudioMessageRow = {
  id: string; workspace_id: string; owner_profile_id: string; conversation_id: string;
  role: StudioMessage["role"]; content: string; ai_run_id: string | null;
  status: StudioMessage["status"]; created_at: string | Date;
};

type StudioSuggestionRow = {
  id: string; workspace_id: string; owner_profile_id: string; document_id: string | null;
  conversation_id: string | null; ai_run_id: string; kind: StudioSuggestion["kind"];
  payload_json: StudioSuggestion["payloadJson"]; status: StudioSuggestion["status"];
  accepted_version_id: string | null; created_at: string | Date; decided_at: string | Date | null;
};

type StudioCitationRow = {
  id: string; workspace_id: string; owner_profile_id: string; message_id: string | null;
  suggestion_id: string | null; source_type: StudioCitation["sourceType"];
  source_id: string | null; url: string | null; label: string; excerpt: string;
  observed_at: string | Date; period_from: string | Date | null; period_to: string | Date | null;
  metadata: Record<string, unknown>; created_at: string | Date;
};

type StudioStructureRow = {
  id: string; workspace_id: string; owner_profile_id: string; document_id: string;
  kind: StudioStructure["kind"]; lifecycle_status: StudioStructure["lifecycleStatus"];
  revision: number; horizon_at: string | Date | null;
  metric_json: StudioStructure["metricJson"]; cadence_json: StudioStructure["cadenceJson"];
  next_run_at: string | Date | null; properties_json: Record<string, unknown>;
  created_at: string | Date; updated_at: string | Date; archived_at: string | Date | null;
  document_title?: string | null;
};

type StudioRitualSessionRow = {
  id: string; workspace_id: string; owner_profile_id: string; ritual_id: string;
  status: StudioRitualSession["status"]; revision: number;
  context_json: Record<string, unknown> | null; preparation_json: Record<string, unknown> | null;
  answers_json: Record<string, string>; synthesis_json: Record<string, unknown> | null;
  prepare_ai_run_id: string | null; synthesis_ai_run_id: string | null; failure_code: string | null;
  preparation_token: string | null; preparation_lease_expires_at: string | Date | null;
  synthesis_token: string | null; synthesis_lease_expires_at: string | Date | null;
  synthesis_failure_code: string | null;
  created_at: string | Date; updated_at: string | Date; completed_at: string | Date | null;
};

type StudioAssetRow = {
  id: string;
  workspace_id: string;
  owner_profile_id: string;
  document_id: string;
  idempotency_key: string | null;
  kind: StudioAssetKind;
  display_name: string;
  object_key: string | null;
  source_url: string | null;
  final_url: string | null;
  fetched_at: string | Date | null;
  mime_type: string | null;
  size_bytes: string | number;
  extraction_status: StudioAssetExtractionStatus;
  extracted_text: string | null;
  extraction_metadata: Record<string, unknown>;
  last_error_code: string | null;
  attempt_count: number;
  next_attempt_at: string | Date | null;
  claim_token: string | null;
  lease_expires_at: string | Date | null;
  lifecycle_status: StudioAsset["lifecycleStatus"];
  created_at: string | Date;
  updated_at: string | Date;
};

type StudioAssetCleanupJobRow = {
  id: string;
  workspace_id: string;
  owner_profile_id: string;
  asset_id: string | null;
  object_key: string | null;
  status: StudioAssetCleanupStatus;
  attempt_count: number;
  next_attempt_at: string | Date | null;
  last_error_code: string | null;
  claim_token: string | null;
  lease_expires_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type StudioAssetUploadIntentRow = {
  id: string;
  workspace_id: string;
  owner_profile_id: string;
  document_id: string;
  object_key: string;
  display_name: string;
  kind: StudioAssetUploadIntent["kind"];
  mime_type: string;
  size_bytes: string | number;
  status: StudioAssetUploadIntentStatus;
  asset_id: string | null;
  attempt_count: number;
  next_attempt_at: string | Date | null;
  last_error_code: string | null;
  upload_token: string | null;
  upload_lease_expires_at: string | Date | null;
  storage_upload_id: string | null;
  storage_session_state: StudioAssetUploadIntent["storageSessionState"];
  claim_token: string | null;
  lease_expires_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type DocumentCursor = {
  updatedAt: string;
  id: string;
};

type StudioSearchDocumentRow = Pick<
  StudioDocumentRow,
  "id" | "title" | "body_text" | "updated_at"
>;

function documentFromRow(row: StudioDocumentRow): StudioDocument {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerProfileId: row.owner_profile_id,
    captureKey: row.capture_key,
    title: row.title,
    bodyJson: structuredClone(row.body_json),
    bodyText: row.body_text,
    revision: row.revision,
    captureMode: row.capture_mode,
    inboxState: row.inbox_state,
    isFocused: row.is_focused,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    archivedAt: row.archived_at ? iso(row.archived_at) : null,
    trashedAt: row.trashed_at ? iso(row.trashed_at) : null,
    preTrashStatus: row.pre_trash_status
  };
}

function versionFromRow(row: StudioDocumentVersionRow): StudioDocumentVersion {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerProfileId: row.owner_profile_id,
    documentId: row.document_id,
    versionNumber: row.version_number,
    bodyJson: structuredClone(row.body_json),
    bodyText: row.body_text,
    origin: row.origin,
    actorProfileId: row.actor_profile_id,
    aiRunId: row.ai_run_id,
    createdAt: iso(row.created_at),
    title: row.title,
    checkpointReason: row.checkpoint_reason,
    checkpointKey: row.checkpoint_key ?? null,
    sourceRevision: row.source_revision,
    isLegacy: row.is_legacy
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sameCheckpoint(version: StudioDocumentVersion, document: StudioDocument) {
  return !version.isLegacy && version.title?.trim() === document.title?.trim()
    && version.bodyText.replace(/\s+/gu, " ").trim() === document.bodyText.replace(/\s+/gu, " ").trim()
    && canonicalJson(version.bodyJson) === canonicalJson(document.bodyJson);
}

function collectionFromRow(row: StudioCollectionRow): StudioCollection {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerProfileId: row.owner_profile_id,
    name: row.name,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function membershipFromRow(row: StudioCollectionMembershipRow): StudioCollectionMembership {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerProfileId: row.owner_profile_id,
    collectionId: row.collection_id,
    documentId: row.document_id,
    createdAt: iso(row.created_at)
  };
}

function relationFromRow(row: StudioRelationRow): StudioRelation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerProfileId: row.owner_profile_id,
    sourceDocumentId: row.source_document_id,
    targetDocumentId: row.target_document_id,
    relationType: row.relation_type,
    createdByProfileId: row.created_by_profile_id,
    createdAt: iso(row.created_at)
  };
}

function indexJobFromRow(row: StudioIndexJobRow): StudioIndexJob {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerProfileId: row.owner_profile_id,
    documentId: row.document_id,
    snapshotId: row.snapshot_id,
    documentRevision: row.document_revision,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at ? iso(row.next_attempt_at) : null,
    lastErrorCode: row.last_error_code,
    claimToken: row.claim_token,
    leaseExpiresAt: row.lease_expires_at ? iso(row.lease_expires_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function conversationFromRow(row: StudioConversationRow): StudioConversation {
  return { id: row.id, workspaceId: row.workspace_id, ownerProfileId: row.owner_profile_id,
    documentId: row.document_id, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function messageFromRow(row: StudioMessageRow): StudioMessage {
  return { id: row.id, workspaceId: row.workspace_id, ownerProfileId: row.owner_profile_id,
    conversationId: row.conversation_id, role: row.role, content: row.content,
    aiRunId: row.ai_run_id, status: row.status, createdAt: iso(row.created_at) };
}

function suggestionFromRow(row: StudioSuggestionRow): StudioSuggestion {
  return { id: row.id, workspaceId: row.workspace_id, ownerProfileId: row.owner_profile_id,
    documentId: row.document_id, conversationId: row.conversation_id, aiRunId: row.ai_run_id,
    kind: row.kind, payloadJson: structuredClone(row.payload_json), status: row.status,
    acceptedVersionId: row.accepted_version_id, createdAt: iso(row.created_at),
    decidedAt: row.decided_at ? iso(row.decided_at) : null };
}

function citationFromRow(row: StudioCitationRow): StudioCitation {
  return { id: row.id, workspaceId: row.workspace_id, ownerProfileId: row.owner_profile_id,
    messageId: row.message_id, suggestionId: row.suggestion_id, sourceType: row.source_type,
    sourceId: row.source_id, url: row.url, label: row.label, excerpt: row.excerpt,
    observedAt: iso(row.observed_at), periodFrom: row.period_from ? iso(row.period_from).slice(0, 10) : null,
    periodTo: row.period_to ? iso(row.period_to).slice(0, 10) : null,
    metadata: structuredClone(row.metadata), createdAt: iso(row.created_at) };
}

function structureFromRow(row: StudioStructureRow): StudioStructure {
  return {
    id: row.id, workspaceId: row.workspace_id, ownerProfileId: row.owner_profile_id,
    documentId: row.document_id, documentTitle: row.document_title,
    kind: row.kind, lifecycleStatus: row.lifecycle_status,
    revision: row.revision, horizonAt: row.horizon_at ? iso(row.horizon_at) : null,
    metricJson: row.metric_json === null ? null : structuredClone(row.metric_json),
    cadenceJson: row.cadence_json === null ? null : structuredClone(row.cadence_json),
    nextRunAt: row.next_run_at ? iso(row.next_run_at) : null,
    propertiesJson: structuredClone(row.properties_json), createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at), archivedAt: row.archived_at ? iso(row.archived_at) : null
  };
}

function ritualSessionFromRow(row: StudioRitualSessionRow): StudioRitualSession {
  return {
    id: row.id, workspaceId: row.workspace_id, ownerProfileId: row.owner_profile_id,
    ritualId: row.ritual_id, status: row.status, revision: row.revision,
    contextJson: row.context_json === null ? null : structuredClone(row.context_json),
    preparationJson: row.preparation_json === null ? null : structuredClone(row.preparation_json),
    answersJson: structuredClone(row.answers_json),
    synthesisJson: row.synthesis_json === null ? null : structuredClone(row.synthesis_json),
    prepareAiRunId: row.prepare_ai_run_id, synthesisAiRunId: row.synthesis_ai_run_id,
    preparationToken: row.preparation_token,
    preparationLeaseExpiresAt: row.preparation_lease_expires_at === null ? null : iso(row.preparation_lease_expires_at),
    synthesisToken: row.synthesis_token,
    synthesisLeaseExpiresAt: row.synthesis_lease_expires_at === null ? null : iso(row.synthesis_lease_expires_at),
    synthesisFailureCode: row.synthesis_failure_code,
    failureCode: row.failure_code, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    completedAt: row.completed_at === null ? null : iso(row.completed_at)
  };
}

function encodeStructureCursor(structure: StudioStructure) {
  return Buffer.from(JSON.stringify({ createdAt: structure.createdAt, id: structure.id })).toString("base64url");
}

function decodeStructureCursor(cursor: string) {
  try {
    if (!cursor || !/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error();
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) throw new Error();
    const value = JSON.parse(decoded.toString("utf8")) as { createdAt?: unknown; id?: unknown };
    if (Object.keys(value).length !== 2 || typeof value.createdAt !== "string" || typeof value.id !== "string") throw new Error();
    const timestamp = new Date(value.createdAt);
    if (timestamp.toISOString() !== value.createdAt || !value.id) throw new Error();
    return { createdAt: value.createdAt, id: value.id };
  } catch { throw new Error("STUDIO_STRUCTURE_CURSOR_INVALID"); }
}

function encodeRitualSessionCursor(session: StudioRitualSession) {
  return Buffer.from(JSON.stringify({ createdAt: session.createdAt, id: session.id })).toString("base64url");
}

function decodeRitualSessionCursor(cursor: string) {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length !== 2
      || typeof parsed.createdAt !== "string" || typeof parsed.id !== "string" || !parsed.id
      || new Date(parsed.createdAt).toISOString() !== parsed.createdAt
      || Buffer.from(JSON.stringify(parsed)).toString("base64url") !== cursor) throw new Error();
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch { throw new Error("STUDIO_RITUAL_SESSION_CURSOR_INVALID"); }
}

function assetFromRow(row: StudioAssetRow): StudioAsset {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerProfileId: row.owner_profile_id,
    documentId: row.document_id,
    idempotencyKey: row.idempotency_key,
    kind: row.kind,
    displayName: row.display_name,
    objectKey: row.object_key,
    sourceUrl: row.source_url,
    finalUrl: row.final_url,
    fetchedAt: row.fetched_at ? iso(row.fetched_at) : null,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    extractionStatus: row.extraction_status,
    extractedText: row.extracted_text,
    extractionMetadata: structuredClone(row.extraction_metadata),
    lastErrorCode: row.last_error_code,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at ? iso(row.next_attempt_at) : null,
    claimToken: row.claim_token,
    leaseExpiresAt: row.lease_expires_at ? iso(row.lease_expires_at) : null,
    lifecycleStatus: row.lifecycle_status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function cleanupJobFromRow(row: StudioAssetCleanupJobRow): StudioAssetCleanupJob {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerProfileId: row.owner_profile_id,
    assetId: row.asset_id,
    objectKey: row.object_key,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at ? iso(row.next_attempt_at) : null,
    lastErrorCode: row.last_error_code,
    claimToken: row.claim_token,
    leaseExpiresAt: row.lease_expires_at ? iso(row.lease_expires_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function uploadIntentFromRow(row: StudioAssetUploadIntentRow): StudioAssetUploadIntent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerProfileId: row.owner_profile_id,
    documentId: row.document_id,
    objectKey: row.object_key,
    displayName: row.display_name,
    kind: row.kind,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    status: row.status,
    assetId: row.asset_id,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at ? iso(row.next_attempt_at) : null,
    lastErrorCode: row.last_error_code,
    uploadToken: row.upload_token,
    uploadLeaseExpiresAt: row.upload_lease_expires_at ? iso(row.upload_lease_expires_at) : null,
    storageUploadId: row.storage_upload_id,
    storageSessionState: row.storage_session_state,
    claimToken: row.claim_token,
    leaseExpiresAt: row.lease_expires_at ? iso(row.lease_expires_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function searchDocumentFromRow(row: StudioSearchDocumentRow): StudioSearchDocument {
  return {
    id: row.id,
    title: row.title,
    bodyText: row.body_text,
    updatedAt: iso(row.updated_at)
  };
}

function encodeCursor(document: StudioDocument) {
  return Buffer.from(JSON.stringify({ updatedAt: document.updatedAt, id: document.id })).toString("base64url");
}

function decodeCursor(cursor: string): DocumentCursor {
  try {
    if (!cursor || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) throw new Error();
    const value = JSON.parse(decoded.toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    if (Object.keys(value).length !== 2) throw new Error();
    const candidate = value as Partial<DocumentCursor>;
    if (typeof candidate.updatedAt !== "string" || typeof candidate.id !== "string" || !candidate.id) {
      throw new Error();
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(candidate.updatedAt)) throw new Error();
    const timestamp = new Date(candidate.updatedAt);
    if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== candidate.updatedAt) throw new Error();
    return { updatedAt: candidate.updatedAt, id: candidate.id };
  } catch {
    throw new Error("STUDIO_DOCUMENT_CURSOR_INVALID");
  }
}

function encodeVersionCursor(version: StudioDocumentVersion) {
  return Buffer.from(JSON.stringify({ versionNumber: version.versionNumber, id: version.id })).toString("base64url");
}

function decodeVersionCursor(cursor: string): VersionCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<VersionCursor>;
    if (!/^[A-Za-z0-9_-]+$/.test(cursor) || Buffer.from(cursor, "base64url").toString("base64url") !== cursor
      || !Number.isInteger(value.versionNumber) || value.versionNumber! < 1 || typeof value.id !== "string" || !value.id) throw new Error();
    return { versionNumber: value.versionNumber!, id: value.id };
  } catch { throw new Error("STUDIO_DOCUMENT_VERSION_CURSOR_INVALID"); }
}

async function findDocument(
  db: OperationalPool | OperationalClient,
  scope: StudioOwnerScope,
  documentId: string
) {
  const result = await db.query<StudioDocumentRow>(
    `SELECT * FROM studio_documents
     WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
    [scope.workspaceId, scope.ownerProfileId, documentId]
  );
  return result.rows[0] ? documentFromRow(result.rows[0]) : null;
}

async function findCollection(
  db: OperationalPool | OperationalClient,
  scope: StudioOwnerScope,
  collectionId: string
) {
  const result = await db.query<StudioCollectionRow>(
    `SELECT * FROM studio_collections
     WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
    [scope.workspaceId, scope.ownerProfileId, collectionId]
  );
  return result.rows[0] ? collectionFromRow(result.rows[0]) : null;
}

async function listDocumentCollectionsBatch(
  db: OperationalPool,
  scope: StudioOwnerScope,
  documentIds: string[]
): Promise<Record<string, StudioCollection[]>> {
  const result: Record<string, StudioCollection[]> = Object.fromEntries(documentIds.map((id) => [id, []]));
  if (documentIds.length === 0) return result;
  const rows = await db.query<StudioCollectionRow & { document_id: string }>(
    `SELECT collection.*,item.document_id FROM studio_collections collection
     JOIN studio_collection_items item
       ON item.workspace_id=collection.workspace_id
      AND item.owner_profile_id=collection.owner_profile_id
      AND item.collection_id=collection.id
     WHERE item.workspace_id=$1 AND item.owner_profile_id=$2 AND item.document_id=ANY($3::text[])
     ORDER BY item.document_id,date_trunc('milliseconds',collection.created_at) ASC,collection.id ASC`,
    [scope.workspaceId, scope.ownerProfileId, documentIds]
  );
  for (const row of rows.rows) result[row.document_id]?.push(collectionFromRow(row));
  return result;
}

function foreignKeyDomainError(error: unknown) {
  const candidate = error as { code?: string; constraint?: string };
  if (candidate?.code !== "23503") return null;
  return candidate.constraint?.includes("document")
    ? new Error("STUDIO_DOCUMENT_NOT_FOUND")
    : new Error("STUDIO_COLLECTION_NOT_FOUND");
}

async function insertVersion(
  client: OperationalClient,
  input: Omit<StudioDocumentVersion, "id" | "versionNumber" | "createdAt">
) {
  const result = await client.query<StudioDocumentVersionRow>(
    `INSERT INTO studio_document_versions
       (id,workspace_id,owner_profile_id,document_id,version_number,body_json,body_text,origin,actor_profile_id,ai_run_id,title,checkpoint_reason,source_revision,is_legacy,checkpoint_key)
     VALUES (
       $1,$2,$3,$4,
       (SELECT COALESCE(MAX(version_number),0)+1 FROM studio_document_versions
        WHERE workspace_id=$2 AND owner_profile_id=$3 AND document_id=$4),
       $5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14
     )
     RETURNING *`,
    [
      generatedId("studio_version"),
      input.workspaceId,
      input.ownerProfileId,
      input.documentId,
      JSON.stringify(input.bodyJson),
      input.bodyText,
      input.origin,
      input.actorProfileId,
      input.aiRunId,
      input.title ?? null,
      input.checkpointReason ?? "legacy_autosave",
      input.sourceRevision ?? null,
      input.isLegacy ?? true,
      input.checkpointKey ?? null
    ]
  );
  return versionFromRow(result.rows[0]!);
}

async function insertIndexJob(client: OperationalClient, document: StudioDocument) {
  await client.query(
    `INSERT INTO studio_index_jobs
       (id,workspace_id,owner_profile_id,document_id,snapshot_id,document_revision,status,next_attempt_at)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW())
     ON CONFLICT (workspace_id,owner_profile_id,document_id,document_revision) DO NOTHING`,
    [
      generatedId("studio_index_job"),
      document.workspaceId,
      document.ownerProfileId,
      document.id,
      generatedId("studio_memory_snapshot"),
      document.revision
    ]
  );
}

async function insertCitations(
  client: OperationalClient,
  inputs: CreateStudioCitation[],
  target: { messageId: string | null; suggestionId: string | null }
) {
  const stored: StudioCitation[] = [];
  for (const input of inputs) {
    const result = await client.query<StudioCitationRow>(
      `INSERT INTO studio_citations
        (id,workspace_id,owner_profile_id,message_id,suggestion_id,source_type,source_id,url,
         label,excerpt,observed_at,period_from,period_to,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) RETURNING *`,
      [generatedId("studio_citation"), input.workspaceId, input.ownerProfileId,
        target.messageId, target.suggestionId, input.sourceType, input.sourceId, input.url,
        input.label, input.excerpt, input.observedAt, input.periodFrom, input.periodTo,
        JSON.stringify(input.metadata)]
    );
    stored.push(citationFromRow(result.rows[0]!));
  }
  return stored;
}

export function createPostgresStudioRepository(db: OperationalPool): StudioRepository {
  return {
    handlesPermanentDeletionCleanup: true,
    async listDocuments(scope, input) {
      const params: unknown[] = [scope.workspaceId, scope.ownerProfileId];
      const conditions = ["workspace_id=$1", "owner_profile_id=$2"];
      if (input.status) {
        conditions.push(`status='${input.status}'`);
      }
      if (input.inboxState) {
        params.push(input.inboxState);
        conditions.push(`inbox_state=$${params.length}`);
      }
      if (input.collectionId) {
        params.push(input.collectionId);
        conditions.push(`EXISTS (SELECT 1 FROM studio_collection_items sci
          WHERE sci.workspace_id=$1 AND sci.owner_profile_id=$2
            AND sci.document_id=studio_documents.id AND sci.collection_id=$${params.length})`);
      }
      if (input.cursor) {
        const cursor = decodeCursor(input.cursor);
        params.push(cursor.updatedAt, cursor.id);
        conditions.push(`(date_bin('1 millisecond'::interval,updated_at,'2000-01-01 00:00:00+00'::timestamptz),id) < (date_bin('1 millisecond'::interval,$${params.length - 1}::timestamptz,'2000-01-01 00:00:00+00'::timestamptz),$${params.length}::text)`);
      }
      params.push(input.limit + 1);
      const result = await db.query<StudioDocumentRow>(
        `SELECT * FROM studio_documents
         WHERE ${conditions.join(" AND ")}
         ORDER BY date_bin('1 millisecond'::interval,updated_at,'2000-01-01 00:00:00+00'::timestamptz) DESC,id DESC
         LIMIT $${params.length}`,
        params
      );
      const documents = result.rows.map(documentFromRow);
      const items = documents.slice(0, input.limit);
      const collectionsByDocumentId = await listDocumentCollectionsBatch(db, scope, items.map((document) => document.id));
      return {
        items,
        nextCursor: documents.length > items.length && items.length > 0
          ? encodeCursor(items[items.length - 1]!)
          : null,
        collectionsByDocumentId
      };
    },

    findDocument(scope, documentId) {
      return findDocument(db, scope, documentId);
    },

    async createDocument(input) {
      return withOperationalTransaction(db, async (client) => {
        const search = prepareStudioSearchFields(input.title, input.bodyText);
        const result = await client.query<StudioDocumentRow>(
          `INSERT INTO studio_documents
             (id,workspace_id,owner_profile_id,capture_key,title,body_json,body_text,
              search_title_folded,search_body_folded,search_tokens,search_prefix_tokens,
              capture_mode,inbox_state,is_focused,status)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::text[],$11::text[],$12,$13,$14,$15)
           ON CONFLICT (workspace_id,owner_profile_id,capture_key)
             WHERE capture_key IS NOT NULL AND status='active'
             DO NOTHING
           RETURNING *`,
          [
            generatedId("studio_document"),
            input.workspaceId,
            input.ownerProfileId,
            input.captureKey ?? null,
            input.title,
            JSON.stringify(input.bodyJson),
            input.bodyText,
            search.titleFolded,
            search.bodyFolded,
            search.tokens,
            search.prefixTokens,
            input.captureMode,
            input.inboxState,
            input.isFocused,
            input.status
          ]
        );
        if (result.rows.length === 0) {
          const existing = await client.query<StudioDocumentRow>(
            `SELECT * FROM studio_documents
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND capture_key=$3 AND status='active'`,
            [input.workspaceId, input.ownerProfileId, input.captureKey]
          );
          if (!existing.rows[0]) throw new Error("STUDIO_DOCUMENT_CAPTURE_RETRY");
          return documentFromRow(existing.rows[0]);
        }
        const document = documentFromRow(result.rows[0]!);
        await insertVersion(client, {
          workspaceId: document.workspaceId,
          ownerProfileId: document.ownerProfileId,
          documentId: document.id,
          bodyJson: document.bodyJson,
          bodyText: document.bodyText,
          origin: "user",
          actorProfileId: document.ownerProfileId,
          aiRunId: null
        });
        await insertIndexJob(client, document);
        return document;
      }).catch((error: unknown) => {
        const postgresError = error as { code?: string; constraint?: string };
        if (postgresError.code === "23505" && postgresError.constraint === "studio_documents_capture_uidx") {
          throw new Error("STUDIO_DOCUMENT_CAPTURE_KEY_ACTIVE");
        }
        throw error;
      });
    },

    async updateDocument(document, expectedRevision) {
      return withOperationalTransaction(db, async (client) => {
        const search = prepareStudioSearchFields(document.title, document.bodyText);
        const result = await client.query<StudioDocumentRow>(
          `UPDATE studio_documents SET
             title=$4,body_json=$5::jsonb,body_text=$6,
             search_title_folded=CASE
               WHEN title IS DISTINCT FROM $4 THEN $7 ELSE search_title_folded END,
             search_body_folded=CASE
               WHEN body_text IS DISTINCT FROM $6 THEN $8 ELSE search_body_folded END,
             search_tokens=CASE
               WHEN title IS DISTINCT FROM $4 OR body_text IS DISTINCT FROM $6
               THEN $9::text[] ELSE search_tokens END,
             search_prefix_tokens=CASE
               WHEN title IS DISTINCT FROM $4 OR body_text IS DISTINCT FROM $6
               THEN $10::text[] ELSE search_prefix_tokens END,
             capture_mode=$11,
             inbox_state=$12,is_focused=$13,status=$14,archived_at=$15,trashed_at=$16,pre_trash_status=$17,
             revision=revision+1,updated_at=NOW()
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND revision=$18
           RETURNING *`,
          [
            document.workspaceId,
            document.ownerProfileId,
            document.id,
            document.title,
            JSON.stringify(document.bodyJson),
            document.bodyText,
            search.titleFolded,
            search.bodyFolded,
            search.tokens,
            search.prefixTokens,
            document.captureMode,
            document.inboxState,
            document.isFocused,
            document.status,
            document.archivedAt,
            document.trashedAt ?? null,
            document.preTrashStatus ?? null,
            expectedRevision
          ]
        );
        if (!result.rows[0]) {
          const exists = await findDocument(client, document, document.id);
          throw new Error(exists ? "STUDIO_DOCUMENT_STALE" : "STUDIO_DOCUMENT_NOT_FOUND");
        }
        const updated = documentFromRow(result.rows[0]);
        await insertIndexJob(client, updated);
        return updated;
      }).catch((error: unknown) => {
        const postgresError = error as { code?: string; constraint?: string };
        if (postgresError.code === "23505" && postgresError.constraint === "studio_documents_capture_uidx") {
          throw new Error("STUDIO_DOCUMENT_CAPTURE_KEY_ACTIVE");
        }
        throw error;
      });
    },

    async trashDocument(scope, documentId, trashedAt) {
      return withOperationalTransaction(db, async (client) => {
        const locked = await client.query<StudioDocumentRow>(
          `SELECT * FROM studio_documents
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR UPDATE`,
          [scope.workspaceId, scope.ownerProfileId, documentId]
        );
        if (!locked.rows[0]) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
        const current = documentFromRow(locked.rows[0]);
        if (current.status === "trashed") return current;
        const updated = await client.query<StudioDocumentRow>(
          `UPDATE studio_documents SET status='trashed',pre_trash_status=$4,trashed_at=$5,
             revision=revision+1,updated_at=NOW()
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 RETURNING *`,
          [scope.workspaceId, scope.ownerProfileId, documentId, current.status, trashedAt]
        );
        const document = documentFromRow(updated.rows[0]!);
        await insertIndexJob(client, document);
        return document;
      });
    },

    async restoreDocumentFromTrash(scope, documentId) {
      return withOperationalTransaction(db, async (client) => {
        const locked = await client.query<StudioDocumentRow>(
          `SELECT * FROM studio_documents
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR UPDATE`,
          [scope.workspaceId, scope.ownerProfileId, documentId]
        );
        if (!locked.rows[0]) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
        const current = documentFromRow(locked.rows[0]);
        if (current.status !== "trashed") return current;
        const restoredStatus = current.preTrashStatus === "archived" ? "archived" : "active";
        const updated = await client.query<StudioDocumentRow>(
          `UPDATE studio_documents SET status=$4,
             archived_at=CASE WHEN $4='active' THEN NULL ELSE archived_at END,
             trashed_at=NULL,pre_trash_status=NULL,revision=revision+1,updated_at=NOW()
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 RETURNING *`,
          [scope.workspaceId, scope.ownerProfileId, documentId, restoredStatus]
        );
        const document = documentFromRow(updated.rows[0]!);
        if (document.status === "active") await insertIndexJob(client, document);
        return document;
      }).catch((error: unknown) => {
        const postgresError = error as { code?: string; constraint?: string };
        if (postgresError.code === "23505" && postgresError.constraint === "studio_documents_capture_uidx") {
          throw new Error("STUDIO_DOCUMENT_CAPTURE_KEY_ACTIVE");
        }
        throw error;
      });
    },

    async claimNextExpiredTrash(cutoff, now, leaseMs = 120_000, excludeOwnerKeys = []) {
      const claimToken = generatedId("studio_trash_claim");
      const leaseExpiresAt = new Date(new Date(now).getTime() + leaseMs).toISOString();
      const claimed = await db.query<StudioDocumentRow>(
        `WITH candidate AS (
           SELECT workspace_id,owner_profile_id,id
           FROM studio_documents
           WHERE status='trashed' AND trashed_at <= $1
             AND (trash_claim_token IS NULL OR trash_lease_expires_at <= $2)
             AND NOT ((workspace_id || '/' || owner_profile_id) = ANY($3::text[]))
           ORDER BY trashed_at ASC,id ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE studio_documents document SET
           trash_claim_token=$4,trash_lease_expires_at=$5,updated_at=document.updated_at
         FROM candidate
         WHERE document.workspace_id=candidate.workspace_id
           AND document.owner_profile_id=candidate.owner_profile_id
           AND document.id=candidate.id
         RETURNING document.*`,
        [cutoff, now, excludeOwnerKeys, claimToken, leaseExpiresAt]
      );
      const row = claimed.rows[0];
      return row ? { ...documentFromRow(row), claimToken, leaseExpiresAt } : null;
    },

    async permanentlyDeleteDocument(scope, documentId) {
      return withOperationalTransaction(db, async (client) => {
        const locked = await client.query<StudioDocumentRow>(
          `SELECT * FROM studio_documents
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR UPDATE`,
          [scope.workspaceId, scope.ownerProfileId, documentId]
        );
        if (!locked.rows[0]) return false;
        if (locked.rows[0].status !== "trashed") throw new Error("STUDIO_DOCUMENT_NOT_TRASHED");
        const structureRows = await client.query<{ id: string }>(
          `SELECT id FROM studio_structures
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3`,
          [scope.workspaceId, scope.ownerProfileId, documentId]
        );
        const structureIds = structureRows.rows.map((structure) => structure.id);
        if (structureIds.length > 0) {
          await client.query(
            `DELETE FROM studio_proactive_signals
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND source_id=ANY($3::text[])
               AND signal_type IN ('ritual_reminder','stale_goal','decision_review')`,
            [scope.workspaceId, scope.ownerProfileId, structureIds]
          );
        }
        const assets = await client.query<{ id: string; object_key: string | null }>(
          `SELECT id,object_key FROM studio_assets
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3`,
          [scope.workspaceId, scope.ownerProfileId, documentId]
        );
        const uploads = await client.query<{ object_key: string }>(
          `SELECT object_key FROM studio_asset_upload_intents
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3`,
          [scope.workspaceId, scope.ownerProfileId, documentId]
        );
        const objectKeys = new Set([
          ...assets.rows.flatMap((asset) => asset.object_key ? [asset.object_key] : []),
          ...uploads.rows.map((upload) => upload.object_key)
        ]);
        for (const objectKey of objectKeys) {
          await client.query(
            `INSERT INTO studio_asset_cleanup_jobs
               (id,workspace_id,owner_profile_id,asset_id,object_key,status,next_attempt_at)
             VALUES ($1,$2,$3,NULL,$4,'pending',NOW())
             ON CONFLICT (workspace_id,owner_profile_id,object_key)
               WHERE object_key IS NOT NULL DO UPDATE SET
                 status=CASE WHEN studio_asset_cleanup_jobs.status='processing'
                   THEN studio_asset_cleanup_jobs.status ELSE 'pending' END,
                 attempt_count=CASE WHEN studio_asset_cleanup_jobs.status='processing'
                   THEN studio_asset_cleanup_jobs.attempt_count ELSE 0 END,
                 next_attempt_at=CASE WHEN studio_asset_cleanup_jobs.status='processing'
                   THEN studio_asset_cleanup_jobs.next_attempt_at ELSE NOW() END,
                 last_error_code=CASE WHEN studio_asset_cleanup_jobs.status='processing'
                   THEN studio_asset_cleanup_jobs.last_error_code ELSE NULL END,
                 claim_token=CASE WHEN studio_asset_cleanup_jobs.status='processing'
                   THEN studio_asset_cleanup_jobs.claim_token ELSE NULL END,
                 lease_expires_at=CASE WHEN studio_asset_cleanup_jobs.status='processing'
                   THEN studio_asset_cleanup_jobs.lease_expires_at ELSE NULL END,
                 updated_at=NOW()`,
            [generatedId("studio_asset_cleanup"), scope.workspaceId, scope.ownerProfileId, objectKey]
          );
        }
        const assetIds = assets.rows.map((asset) => asset.id);
        if (assetIds.length > 0) {
          await client.query(
            `DELETE FROM studio_asset_cleanup_jobs
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND asset_id=ANY($3::text[]) AND object_key IS NULL`,
            [scope.workspaceId, scope.ownerProfileId, assetIds]
          );
          await client.query(
            `UPDATE studio_asset_cleanup_jobs SET asset_id=NULL,updated_at=NOW()
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND asset_id=ANY($3::text[])`,
            [scope.workspaceId, scope.ownerProfileId, assetIds]
          );
        }
        await client.query(
          `DELETE FROM studio_operational_links
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND source_document_id=$3`,
          [scope.workspaceId, scope.ownerProfileId, documentId]
        );
        const memoryTables = await client.query<{ chunks: string | null; state: string | null }>(
          `SELECT to_regclass('studio_memory_chunks')::text AS chunks,
                  to_regclass('studio_memory_document_state')::text AS state`
        );
        if (memoryTables.rows[0]?.chunks) {
          await client.query(
            `DELETE FROM studio_memory_chunks
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3`,
            [scope.workspaceId, scope.ownerProfileId, documentId]
          );
        }
        if (memoryTables.rows[0]?.state) {
          await client.query(
            `DELETE FROM studio_memory_document_state
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3`,
            [scope.workspaceId, scope.ownerProfileId, documentId]
          );
        }
        const deleted = await client.query<{ id: string }>(
          `DELETE FROM studio_documents
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 RETURNING id`,
          [scope.workspaceId, scope.ownerProfileId, documentId]
        );
        return deleted.rows.length === 1;
      });
    },

    async listDocumentStructureIdsIncludingInactive(scope, documentId) {
      const result = await db.query<{ id: string }>(
        `SELECT id FROM studio_structures
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3
         ORDER BY id`,
        [scope.workspaceId, scope.ownerProfileId, documentId]
      );
      return result.rows.map((structure) => structure.id);
    },

    async listVersions(scope, documentId) {
      const result = await db.query<StudioDocumentVersionRow>(
        `SELECT * FROM studio_document_versions
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3
         ORDER BY version_number ASC,id ASC`,
        [scope.workspaceId, scope.ownerProfileId, documentId]
      );
      return result.rows.map(versionFromRow);
    },

    async listVersionPage(scope, documentId, query) {
      const params: unknown[] = [scope.workspaceId, scope.ownerProfileId, documentId];
      const conditions = ["workspace_id=$1", "owner_profile_id=$2", "document_id=$3"];
      if (query.cursor) {
        const cursor = decodeVersionCursor(query.cursor);
        params.push(cursor.versionNumber, cursor.id);
        conditions.push(`(version_number,id) < ($${params.length - 1},$${params.length})`);
      }
      params.push(query.limit + 1);
      const result = await db.query<StudioDocumentVersionRow>(
        `SELECT * FROM studio_document_versions WHERE ${conditions.join(" AND ")}
         ORDER BY version_number DESC,id DESC LIMIT $${params.length}`,
        params
      );
      const rows = result.rows.map(versionFromRow);
      const items = rows.slice(0, query.limit);
      return { items, nextCursor: rows.length > items.length && items.length ? encodeVersionCursor(items[items.length - 1]!) : null };
    },

    async findVersion(scope, documentId, versionId) {
      const result = await db.query<StudioDocumentVersionRow>(
        `SELECT * FROM studio_document_versions WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3 AND id=$4`,
        [scope.workspaceId, scope.ownerProfileId, documentId, versionId]
      );
      return result.rows[0] ? versionFromRow(result.rows[0]) : null;
    },

    async createCheckpoint(scope, documentId, actorProfileId, input) {
      return withOperationalTransaction(db, async (client) => {
        const locked = await client.query<StudioDocumentRow>(
          `SELECT * FROM studio_documents WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR UPDATE`,
          [scope.workspaceId, scope.ownerProfileId, documentId]
        );
        if (!locked.rows[0]) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
        const document = documentFromRow(locked.rows[0]);
        if (input.checkpoint_key) {
          const existing = await client.query<StudioDocumentVersionRow>(
            `SELECT * FROM studio_document_versions
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3 AND checkpoint_key=$4`,
            [scope.workspaceId, scope.ownerProfileId, documentId, input.checkpoint_key]
          );
          if (existing.rows[0]) return { version: versionFromRow(existing.rows[0]), inserted: false };
        }
        if (document.revision !== input.expected_revision) throw new Error("STUDIO_DOCUMENT_STALE");
        const latest = await client.query<StudioDocumentVersionRow>(
          `SELECT * FROM studio_document_versions WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3
           ORDER BY version_number DESC,id DESC LIMIT 1`, [scope.workspaceId, scope.ownerProfileId, documentId]
        );
        if (!input.checkpoint_key && latest.rows[0] && sameCheckpoint(versionFromRow(latest.rows[0]), document)) {
          return { version: versionFromRow(latest.rows[0]), inserted: false };
        }
        const version = await insertVersion(client, { ...scope, documentId, title: document.title, bodyJson: document.bodyJson,
          bodyText: document.bodyText, origin: "user", actorProfileId, aiRunId: null, checkpointReason: input.reason,
          checkpointKey: input.checkpoint_key ?? null, sourceRevision: document.revision, isLegacy: false });
        await insertIndexJob(client, document);
        return { version, inserted: true };
      });
    },

    async createExitCheckpoint(scope, documentId, actorProfileId, input) {
      return withOperationalTransaction(db, async (client) => {
        const locked = await client.query<StudioDocumentRow>(
          `SELECT * FROM studio_documents WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR UPDATE`,
          [scope.workspaceId, scope.ownerProfileId, documentId]
        );
        if (!locked.rows[0]) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
        const document = documentFromRow(locked.rows[0]);
        if (document.revision < input.known_revision) throw new Error("STUDIO_DOCUMENT_STALE");
        const latest = await client.query<StudioDocumentVersionRow>(
          `SELECT * FROM studio_document_versions WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3
           ORDER BY version_number DESC,id DESC LIMIT 1`, [scope.workspaceId, scope.ownerProfileId, documentId]
        );
        const latestVersion = latest.rows[0] ? versionFromRow(latest.rows[0]) : null;
        if (latestVersion && sameCheckpoint(latestVersion, document)) {
          return { document, version: latestVersion };
        }
        const version = await insertVersion(client, { ...scope, documentId, title: document.title,
          bodyJson: document.bodyJson, bodyText: document.bodyText, origin: "user", actorProfileId,
          aiRunId: null, checkpointReason: "document_exit", sourceRevision: document.revision, isLegacy: false });
        await insertIndexJob(client, document);
        return { document, version };
      });
    },

    async restoreDocumentVersion(scope, documentId, versionId, actorProfileId, expectedRevision) {
      return withOperationalTransaction(db, async (client) => {
        const locked = await client.query<StudioDocumentRow>(
          `SELECT * FROM studio_documents WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR UPDATE`,
          [scope.workspaceId, scope.ownerProfileId, documentId]
        );
        if (!locked.rows[0]) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
        const current = documentFromRow(locked.rows[0]);
        if (current.revision !== expectedRevision) throw new Error("STUDIO_DOCUMENT_STALE");
        const sourceResult = await client.query<StudioDocumentVersionRow>(
          `SELECT * FROM studio_document_versions WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3 AND id=$4 FOR KEY SHARE`,
          [scope.workspaceId, scope.ownerProfileId, documentId, versionId]
        );
        if (!sourceResult.rows[0]) throw new Error("STUDIO_DOCUMENT_VERSION_NOT_FOUND");
        const source = versionFromRow(sourceResult.rows[0]);
        assertStudioEditorJson(source.bodyJson);
        const bodyText = source.bodyText.replace(/\s+/gu, " ").trim();
        const search = prepareStudioSearchFields(source.title ?? null, bodyText);
        const updatedResult = await client.query<StudioDocumentRow>(
          `UPDATE studio_documents SET title=$4,body_json=$5::jsonb,body_text=$6,
             search_title_folded=$7,search_body_folded=$8,search_tokens=$9::text[],search_prefix_tokens=$10::text[],
             revision=revision+1,updated_at=NOW()
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND revision=$11 RETURNING *`,
          [scope.workspaceId, scope.ownerProfileId, documentId, source.title ?? null, JSON.stringify(source.bodyJson), bodyText,
            search.titleFolded, search.bodyFolded, search.tokens, search.prefixTokens, expectedRevision]
        );
        if (!updatedResult.rows[0]) throw new Error("STUDIO_DOCUMENT_STALE");
        const document = documentFromRow(updatedResult.rows[0]);
        await insertIndexJob(client, document);
        const version = await insertVersion(client, { ...scope, documentId, title: document.title, bodyJson: document.bodyJson,
          bodyText: document.bodyText, origin: "user", actorProfileId, aiRunId: null, checkpointReason: "restored",
          sourceRevision: document.revision, isLegacy: false });
        return { document, version };
      });
    },

    async findStructure(scope, structureId) {
      const result = await db.query<StudioStructureRow>(
        `SELECT * FROM studio_structures WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
        [scope.workspaceId, scope.ownerProfileId, structureId]
      );
      return result.rows[0] ? structureFromRow(result.rows[0]) : null;
    },

    async createStructure(input) {
      try {
        const result = await db.query<StudioStructureRow>(
          `INSERT INTO studio_structures
             (id,workspace_id,owner_profile_id,document_id,kind,lifecycle_status,
              horizon_at,metric_json,cadence_json,next_run_at,properties_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb) RETURNING *`,
          [generatedId("studio_structure"), input.workspaceId, input.ownerProfileId, input.documentId,
            input.kind, input.lifecycleStatus, input.horizonAt,
            input.metricJson === null ? null : JSON.stringify(input.metricJson),
            input.cadenceJson === null ? null : JSON.stringify(input.cadenceJson),
            input.nextRunAt, JSON.stringify(input.propertiesJson)]
        );
        return structureFromRow(result.rows[0]!);
      } catch (error) {
        const candidate = error as { code?: string; constraint?: string };
        if (candidate.code === "23505" && candidate.constraint === "studio_structures_active_kind_uidx") {
          throw new Error("STUDIO_STRUCTURE_ACTIVE_DUPLICATE");
        }
        if (candidate.code === "23503") throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
        throw error;
      }
    },

    async updateStructure(input, expectedRevision) {
      try {
        const result = await db.query<StudioStructureRow>(
          `UPDATE studio_structures SET lifecycle_status=$4,horizon_at=$5,metric_json=$6::jsonb,
             cadence_json=$7::jsonb,next_run_at=$8,properties_json=$9::jsonb,
             archived_at=$10,revision=revision+1,updated_at=NOW()
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND revision=$11 RETURNING *`,
          [input.workspaceId, input.ownerProfileId, input.id, input.lifecycleStatus,
            input.horizonAt, input.metricJson === null ? null : JSON.stringify(input.metricJson),
            input.cadenceJson === null ? null : JSON.stringify(input.cadenceJson),
            input.nextRunAt, JSON.stringify(input.propertiesJson), input.archivedAt, expectedRevision]
        );
        if (!result.rows[0]) {
          const exists = await db.query<{ id: string }>(
            `SELECT id FROM studio_structures WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
            [input.workspaceId, input.ownerProfileId, input.id]
          );
          throw new Error(exists.rows[0] ? "STUDIO_STRUCTURE_STALE" : "STUDIO_STRUCTURE_NOT_FOUND");
        }
        return structureFromRow(result.rows[0]);
      } catch (error) {
        const candidate = error as { code?: string; constraint?: string };
        if (candidate.code === "23505" && candidate.constraint === "studio_structures_active_kind_uidx") {
          throw new Error("STUDIO_STRUCTURE_ACTIVE_DUPLICATE");
        }
        throw error;
      }
    },

    async listStructures(scope, input) {
      const params: unknown[] = [scope.workspaceId, scope.ownerProfileId];
      const conditions = ["structures.workspace_id=$1", "structures.owner_profile_id=$2", "documents.status='active'"];
      if (input.documentId) { params.push(input.documentId); conditions.push(`structures.document_id=$${params.length}`); }
      if (input.kind) { params.push(input.kind); conditions.push(`structures.kind=$${params.length}`); }
      if (input.lifecycleStatus) { params.push(input.lifecycleStatus); conditions.push(`structures.lifecycle_status=$${params.length}`); }
      if (input.cursor) {
        const cursor = decodeStructureCursor(input.cursor);
        params.push(cursor.createdAt, cursor.id);
        conditions.push(`(structures.created_at,structures.id) < ($${params.length - 1}::timestamptz,$${params.length}::text)`);
      }
      params.push(input.limit + 1);
      const result = await db.query<StudioStructureRow>(
        `SELECT structures.*,documents.title AS document_title
         FROM studio_structures structures
         JOIN studio_documents documents
           ON documents.workspace_id=structures.workspace_id
          AND documents.owner_profile_id=structures.owner_profile_id
          AND documents.id=structures.document_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY structures.created_at DESC,structures.id DESC
         LIMIT $${params.length}`,
        params
      );
      const rows = result.rows.map(structureFromRow);
      const items = rows.slice(0, input.limit);
      return { items, nextCursor: rows.length > items.length && items.length
        ? encodeStructureCursor(items[items.length - 1]!) : null };
    },

    async findRitualSession(scope, sessionId) {
      const result = await db.query<StudioRitualSessionRow>(
        `SELECT * FROM studio_ritual_sessions
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
        [scope.workspaceId, scope.ownerProfileId, sessionId]
      );
      return result.rows[0] ? ritualSessionFromRow(result.rows[0]) : null;
    },

    async createRitualSession(input) {
      return withOperationalTransaction(db, async (client) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const id = generatedId("studio_ritual_session");
          const result = await client.query<StudioRitualSessionRow>(
            `WITH active_ritual AS MATERIALIZED (
               SELECT id FROM studio_structures
               WHERE workspace_id=$2 AND owner_profile_id=$3 AND id=$4
                 AND kind='ritual' AND lifecycle_status='active'
               FOR UPDATE
             ), inserted AS (
               INSERT INTO studio_ritual_sessions
                 (id,workspace_id,owner_profile_id,ritual_id,preparation_token,preparation_lease_expires_at)
               SELECT $1,$2,$3,$4,$5,$6 FROM active_ritual
               ON CONFLICT (workspace_id,owner_profile_id,ritual_id)
                 WHERE status IN ('preparing','ready','in_progress','failed') DO NOTHING
               RETURNING *
             )
             SELECT * FROM inserted
             UNION ALL
             SELECT sessions.* FROM studio_ritual_sessions sessions
             JOIN active_ritual ON active_ritual.id=sessions.ritual_id
             WHERE sessions.workspace_id=$2 AND sessions.owner_profile_id=$3
               AND sessions.status IN ('preparing','ready','in_progress','failed')
             ORDER BY created_at DESC,id DESC LIMIT 1`,
            [id, input.workspaceId, input.ownerProfileId, input.ritualId,
              input.preparationToken, input.preparationLeaseExpiresAt]
          );
          if (result.rows[0]) return ritualSessionFromRow(result.rows[0]);
        }
        throw new Error("STUDIO_RITUAL_NOT_FOUND");
      });
    },

    async updateRitualSession(input, expectedRevision) {
      const result = await db.query<StudioRitualSessionRow>(
        `UPDATE studio_ritual_sessions SET
           status=$4,context_json=$5::jsonb,preparation_json=$6::jsonb,answers_json=$7::jsonb,
           synthesis_json=$8::jsonb,prepare_ai_run_id=$9,synthesis_ai_run_id=$10,
           preparation_token=$11,preparation_lease_expires_at=$12,failure_code=$13,
           completed_at=$14,synthesis_token=$16,synthesis_lease_expires_at=$17,
           synthesis_failure_code=$18,revision=revision+1,updated_at=NOW()
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND revision=$15
           AND (status<>'completed' OR $4='completed')
         RETURNING *`,
        [input.workspaceId, input.ownerProfileId, input.id, input.status,
          input.contextJson === null ? null : JSON.stringify(input.contextJson),
          input.preparationJson === null ? null : JSON.stringify(input.preparationJson),
          JSON.stringify(input.answersJson), input.synthesisJson === null ? null : JSON.stringify(input.synthesisJson),
          input.prepareAiRunId, input.synthesisAiRunId, input.preparationToken,
          input.preparationLeaseExpiresAt, input.failureCode, input.completedAt, expectedRevision,
          input.synthesisToken, input.synthesisLeaseExpiresAt, input.synthesisFailureCode]
      );
      if (result.rows[0]) return ritualSessionFromRow(result.rows[0]);
      const existing = await db.query<{ revision: number; status: StudioRitualSession["status"] }>(
        `SELECT revision,status FROM studio_ritual_sessions
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
        [input.workspaceId, input.ownerProfileId, input.id]
      );
      if (!existing.rows[0]) throw new Error("STUDIO_RITUAL_SESSION_NOT_FOUND");
      if (existing.rows[0].status === "completed" && input.status !== "completed") {
        throw new Error("STUDIO_RITUAL_SESSION_COMPLETED");
      }
      throw new Error("STUDIO_RITUAL_SESSION_STALE");
    },

    async listRitualSessions(scope, ritualId, input) {
      const params: unknown[] = [scope.workspaceId, scope.ownerProfileId, ritualId];
      const conditions = ["workspace_id=$1", "owner_profile_id=$2", "ritual_id=$3"];
      if (input.cursor) {
        const cursor = decodeRitualSessionCursor(input.cursor);
        params.push(cursor.createdAt, cursor.id);
        conditions.push(`(created_at,id) < ($${params.length - 1}::timestamptz,$${params.length}::text)`);
      }
      params.push(input.limit + 1);
      const result = await db.query<StudioRitualSessionRow>(
        `SELECT * FROM studio_ritual_sessions WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC,id DESC LIMIT $${params.length}`,
        params
      );
      const rows = result.rows.map(ritualSessionFromRow);
      const items = rows.slice(0, input.limit);
      return {
        items,
        nextCursor: rows.length > items.length && items.length
          ? encodeRitualSessionCursor(items[items.length - 1]!) : null
      };
    },

    async appendVersion(input) {
      return withOperationalTransaction(db, async (client) => {
        const document = await client.query<{ id: string }>(
          `SELECT id FROM studio_documents
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
           FOR UPDATE`,
          [input.workspaceId, input.ownerProfileId, input.documentId]
        );
        if (!document.rows[0]) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
        return insertVersion(client, input);
      });
    },

    async searchDocuments(scope, input) {
      const query = prepareStudioSearchQuery(input.query);
      if (!query) return [];
      const params: unknown[] = [
        scope.workspaceId,
        scope.ownerProfileId,
        query.exactTokens,
        query.query,
        query.tokens,
        input.limit
      ];
      let prefixCondition = "";
      if (query.prefixToken !== null) {
        params.push([query.prefixToken]);
        prefixCondition = `AND (
          search_tokens @> $${params.length}::text[]
          OR search_prefix_tokens @> $${params.length}::text[]
        )`;
      }
      const result = await db.query<StudioSearchDocumentRow>(
        `SELECT id,title,body_text,updated_at,
           (CASE
              WHEN search_title_folded=$4 THEN 400
              WHEN strpos(search_title_folded,$4)=1 THEN 300
              WHEN strpos(search_title_folded,$4)>0 THEN 200
              ELSE 0
            END
            + CASE WHEN strpos(search_body_folded,$4)>0 THEN 100 ELSE 0 END
            + (SELECT COALESCE(SUM(
                CASE WHEN strpos(search_title_folded,token)>0 THEN 20 ELSE 0 END
                + CASE WHEN strpos(search_body_folded,token)>0 THEN 5 ELSE 0 END
              ),0) FROM unnest($5::text[]) AS token)) AS search_score
         FROM studio_documents
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND status='active'
           AND search_tokens @> $3::text[]
           ${prefixCondition}
         ORDER BY search_score DESC,date_trunc('milliseconds',updated_at) DESC,id ASC
         LIMIT $6`,
        params
      );
      return result.rows.map(searchDocumentFromRow);
    },

    async listRecentDocuments(scope, limit) {
      const result = await db.query<StudioDocumentRow>(
        `SELECT * FROM studio_documents
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND status='active'
         ORDER BY date_trunc('milliseconds',updated_at) DESC,id DESC
         LIMIT $3`,
        [scope.workspaceId, scope.ownerProfileId, limit]
      );
      return result.rows.map(documentFromRow);
    },

    async listFocusedDocuments(scope, limit) {
      const result = await db.query<StudioDocumentRow>(
        `SELECT * FROM studio_documents
         WHERE workspace_id=$1 AND owner_profile_id=$2
           AND status='active' AND is_focused=TRUE
         ORDER BY date_trunc('milliseconds',updated_at) DESC,id DESC
         LIMIT $3`,
        [scope.workspaceId, scope.ownerProfileId, limit]
      );
      return result.rows.map(documentFromRow);
    },

    async listNextRituals(scope, limit, scheduledAfter) {
      const result = await db.query<StudioNextRitualRow>(
        `SELECT structures.id,
                documents.title AS document_title,
                structures.properties_json->>'intention' AS intention,
                structures.next_run_at AS scheduled_for,
                structures.cadence_json->>'timezone' AS timezone
         FROM studio_structures structures
         JOIN studio_documents documents
           ON documents.workspace_id=structures.workspace_id
          AND documents.owner_profile_id=structures.owner_profile_id
          AND documents.id=structures.document_id
         WHERE structures.workspace_id=$1
           AND structures.owner_profile_id=$2
           AND structures.kind='ritual'
           AND structures.lifecycle_status='active'
           AND structures.next_run_at IS NOT NULL
           AND structures.next_run_at > $3::timestamptz
           AND documents.status='active'
         ORDER BY structures.next_run_at ASC,structures.id ASC
         LIMIT $4`,
        [scope.workspaceId, scope.ownerProfileId, scheduledAfter, limit]
      );
      return result.rows.map((row) => ({
        id: row.id,
        title: row.document_title?.trim() || row.intention?.trim() || "Ritual privado",
        scheduledFor: iso(row.scheduled_for),
        timezone: row.timezone
      }));
    },

    async countPendingReviewDocuments(scope) {
      const result = await db.query<{ count: string | number }>(
        `SELECT COUNT(*) AS count FROM studio_documents
         WHERE workspace_id=$1 AND owner_profile_id=$2
           AND status='active' AND inbox_state='pending_review'`,
        [scope.workspaceId, scope.ownerProfileId]
      );
      return Number(result.rows[0]?.count ?? 0);
    },

    async listCollections(scope) {
      const result = await db.query<StudioCollectionRow>(
        `SELECT * FROM studio_collections
         WHERE workspace_id=$1 AND owner_profile_id=$2
         ORDER BY date_trunc('milliseconds',created_at) ASC,id ASC`,
        [scope.workspaceId, scope.ownerProfileId]
      );
      return result.rows.map(collectionFromRow);
    },

    findCollection(scope, collectionId) {
      return findCollection(db, scope, collectionId);
    },

    async createCollection(input) {
      const result = await db.query<StudioCollectionRow>(
        `INSERT INTO studio_collections (id,workspace_id,owner_profile_id,name)
         VALUES ($1,$2,$3,$4)
         RETURNING *`,
        [generatedId("studio_collection"), input.workspaceId, input.ownerProfileId, input.name]
      );
      return collectionFromRow(result.rows[0]!);
    },

    async updateCollection(input) {
      const result = await db.query<StudioCollectionRow>(
        `UPDATE studio_collections SET name=$4,updated_at=NOW()
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
         RETURNING *`,
        [input.workspaceId, input.ownerProfileId, input.id, input.name]
      );
      if (!result.rows[0]) throw new Error("STUDIO_COLLECTION_NOT_FOUND");
      return collectionFromRow(result.rows[0]);
    },

    async deleteCollection(scope, collectionId) {
      const result = await db.query<{ id: string }>(
        `DELETE FROM studio_collections
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
         RETURNING id`,
        [scope.workspaceId, scope.ownerProfileId, collectionId]
      );
      return Boolean(result.rows[0]);
    },

    async addCollectionMembership(input) {
      try {
        return await withOperationalTransaction(db, async (client) => {
          const collection = await client.query<{ id: string }>(
            `SELECT id FROM studio_collections
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
             FOR KEY SHARE`,
            [input.workspaceId, input.ownerProfileId, input.collectionId]
          );
          if (!collection.rows[0]) throw new Error("STUDIO_COLLECTION_NOT_FOUND");
          const document = await client.query<{ id: string }>(
            `SELECT id FROM studio_documents
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
             FOR KEY SHARE`,
            [input.workspaceId, input.ownerProfileId, input.documentId]
          );
          if (!document.rows[0]) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");

          const inserted = await client.query<StudioCollectionMembershipRow>(
            `INSERT INTO studio_collection_items
               (id,workspace_id,owner_profile_id,collection_id,document_id)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (workspace_id,owner_profile_id,collection_id,document_id) DO NOTHING
             RETURNING *`,
            [
              generatedId("studio_collection_item"),
              input.workspaceId,
              input.ownerProfileId,
              input.collectionId,
              input.documentId
            ]
          );
          if (inserted.rows[0]) return membershipFromRow(inserted.rows[0]);

          const existing = await client.query<StudioCollectionMembershipRow>(
            `SELECT * FROM studio_collection_items
             WHERE workspace_id=$1 AND owner_profile_id=$2
               AND collection_id=$3 AND document_id=$4`,
            [input.workspaceId, input.ownerProfileId, input.collectionId, input.documentId]
          );
          if (!existing.rows[0]) throw new Error("STUDIO_COLLECTION_MEMBERSHIP_NOT_FOUND");
          return membershipFromRow(existing.rows[0]);
        });
      } catch (error) {
        throw foreignKeyDomainError(error) ?? error;
      }
    },

    async removeCollectionMembership(scope, collectionId, documentId) {
      const result = await db.query<{ id: string }>(
        `DELETE FROM studio_collection_items
         WHERE workspace_id=$1 AND owner_profile_id=$2
           AND collection_id=$3 AND document_id=$4
         RETURNING id`,
        [scope.workspaceId, scope.ownerProfileId, collectionId, documentId]
      );
      return Boolean(result.rows[0]);
    },

    async listDocumentCollections(scope, documentId) {
      const result = await db.query<StudioCollectionRow>(
        `SELECT collection.* FROM studio_collections collection
         JOIN studio_collection_items item
           ON item.workspace_id=collection.workspace_id
          AND item.owner_profile_id=collection.owner_profile_id
          AND item.collection_id=collection.id
         WHERE item.workspace_id=$1 AND item.owner_profile_id=$2 AND item.document_id=$3
         ORDER BY date_trunc('milliseconds',collection.created_at) ASC,collection.id ASC`,
        [scope.workspaceId, scope.ownerProfileId, documentId]
      );
      return result.rows.map(collectionFromRow);
    },

    listDocumentCollectionsBatch(scope, documentIds) {
      return listDocumentCollectionsBatch(db, scope, documentIds);
    },

    async listDocumentAssets(scope, documentId) {
      const result = await db.query<StudioAssetRow>(
        `SELECT * FROM studio_assets
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3
           AND lifecycle_status='active'
         ORDER BY date_trunc('milliseconds',created_at) ASC,id ASC`,
        [scope.workspaceId, scope.ownerProfileId, documentId]
      );
      return result.rows.map(assetFromRow);
    },

    async findAsset(scope, assetId) {
      const result = await db.query<StudioAssetRow>(
        `SELECT * FROM studio_assets
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND lifecycle_status='active'`,
        [scope.workspaceId, scope.ownerProfileId, assetId]
      );
      return result.rows[0] ? assetFromRow(result.rows[0]) : null;
    },

    async findAssetIncludingDeleting(scope, assetId) {
      const result = await db.query<StudioAssetRow>(
        `SELECT * FROM studio_assets
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
        [scope.workspaceId, scope.ownerProfileId, assetId]
      );
      return result.rows[0] ? assetFromRow(result.rows[0]) : null;
    },

    async createAsset(input) {
      try {
        const result = await db.query<StudioAssetRow>(
          `INSERT INTO studio_assets
             (id,workspace_id,owner_profile_id,document_id,idempotency_key,kind,display_name,
              object_key,source_url,final_url,fetched_at,mime_type,size_bytes,
              extraction_status,extracted_text,extraction_metadata,last_error_code,
              attempt_count,next_attempt_at,claim_token,lease_expires_at,lifecycle_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21,$22)
           ON CONFLICT (workspace_id,owner_profile_id,document_id,idempotency_key)
             WHERE idempotency_key IS NOT NULL AND lifecycle_status='active'
             DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
           RETURNING *`,
          [
            generatedId("studio_asset"), input.workspaceId, input.ownerProfileId,
            input.documentId, input.idempotencyKey ?? null, input.kind, input.displayName, input.objectKey,
            input.sourceUrl, input.finalUrl, input.fetchedAt, input.mimeType,
            input.sizeBytes, input.extractionStatus, input.extractedText,
            JSON.stringify(input.extractionMetadata), input.lastErrorCode,
            input.attemptCount, input.nextAttemptAt, input.claimToken ?? null,
            input.leaseExpiresAt ?? null, input.lifecycleStatus ?? "active"
          ]
        );
        return assetFromRow(result.rows[0]!);
      } catch (error) {
        const candidate = error as { code?: string; constraint?: string };
        if (candidate?.code === "23503" && candidate.constraint?.includes("document")) {
          throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
        }
        throw error;
      }
    },

    async findAssetByObjectKey(scope, objectKey) {
      const result = await db.query<StudioAssetRow>(
        `SELECT * FROM studio_assets
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND object_key=$3 AND lifecycle_status='active'`,
        [scope.workspaceId, scope.ownerProfileId, objectKey]
      );
      return result.rows[0] ? assetFromRow(result.rows[0]) : null;
    },

    async findAssetByIdempotencyKey(scope, documentId, idempotencyKey) {
      const result = await db.query<StudioAssetRow>(
        `SELECT * FROM studio_assets
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3
           AND idempotency_key=$4 AND lifecycle_status='active'`,
        [scope.workspaceId, scope.ownerProfileId, documentId, idempotencyKey]
      );
      return result.rows[0] ? assetFromRow(result.rows[0]) : null;
    },

    async createAssetUploadIntent(input) {
      try {
        const uploadToken = generatedId("studio_upload_claim");
        const result = await db.query<StudioAssetUploadIntentRow>(
          `INSERT INTO studio_asset_upload_intents
             (id,workspace_id,owner_profile_id,document_id,object_key,display_name,kind,mime_type,size_bytes,
              status,upload_token,upload_lease_expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'uploading',$10,$11)
           RETURNING *`,
          [generatedId("studio_asset_upload"), input.workspaceId, input.ownerProfileId, input.documentId,
            input.objectKey, input.displayName, input.kind, input.mimeType, input.sizeBytes,
            uploadToken, input.uploadLeaseExpiresAt]
        );
        return uploadIntentFromRow(result.rows[0]!);
      } catch (error) {
        const candidate = error as { code?: string; constraint?: string };
        if (candidate.code === "23503" && candidate.constraint?.includes("document")) {
          throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
        }
        throw error;
      }
    },

    async attachAssetUploadSession(input) {
      const result = await db.query<{ id: string }>(
        `UPDATE studio_asset_upload_intents
         SET storage_upload_id=$5,storage_session_state='active',updated_at=NOW()
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
           AND status='uploading' AND upload_token=$4
           AND storage_session_state='creating' AND storage_upload_id IS NULL
         RETURNING id`,
        [input.scope.workspaceId, input.scope.ownerProfileId, input.intentId,
          input.uploadToken, input.storageUploadId]
      );
      return Boolean(result.rows[0]);
    },

    async finalizeAssetUpload(input) {
      return withOperationalTransaction(db, async (client) => {
        const intentResult = await client.query<StudioAssetUploadIntentRow>(
          `SELECT * FROM studio_asset_upload_intents
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR UPDATE`,
          [input.scope.workspaceId, input.scope.ownerProfileId, input.intentId]
        );
        const intent = intentResult.rows[0];
        if (!intent) {
          const existing = await client.query<StudioAssetRow>(
            `SELECT * FROM studio_assets
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND object_key=$3 AND lifecycle_status='active'`,
            [input.scope.workspaceId, input.scope.ownerProfileId, input.asset.objectKey]
          );
          if (existing.rows[0]) return assetFromRow(existing.rows[0]);
          throw new Error("STUDIO_ASSET_UPLOAD_INTENT_NOT_FOUND");
        }
        if (input.asset.workspaceId !== intent.workspace_id || input.asset.ownerProfileId !== intent.owner_profile_id
          || input.asset.documentId !== intent.document_id || input.asset.objectKey !== intent.object_key) {
          throw new Error("STUDIO_ASSET_UPLOAD_INTENT_MISMATCH");
        }
        if (intent.status !== "uploading" || intent.upload_token !== input.uploadToken
          || intent.storage_session_state !== "active" || intent.storage_upload_id === null) {
          throw new Error("STUDIO_ASSET_UPLOAD_INTENT_STALE");
        }
        const existing = await client.query<StudioAssetRow>(
          `SELECT * FROM studio_assets
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND object_key=$3 AND lifecycle_status='active'`,
          [intent.workspace_id, intent.owner_profile_id, intent.object_key]
        );
        if (existing.rows[0]) {
          await client.query(
            `DELETE FROM studio_asset_upload_intents
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
            [intent.workspace_id, intent.owner_profile_id, intent.id]
          );
          return assetFromRow(existing.rows[0]);
        }
        const asset = await client.query<StudioAssetRow>(
          `INSERT INTO studio_assets
             (id,workspace_id,owner_profile_id,document_id,idempotency_key,kind,display_name,object_key,source_url,
              final_url,fetched_at,mime_type,size_bytes,extraction_status,extracted_text,
              extraction_metadata,last_error_code,attempt_count,next_attempt_at,claim_token,
              lease_expires_at,lifecycle_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21,$22)
           ON CONFLICT (workspace_id,owner_profile_id,document_id,idempotency_key)
             WHERE idempotency_key IS NOT NULL AND lifecycle_status='active'
             DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
           RETURNING *`,
          [generatedId("studio_asset"), input.asset.workspaceId, input.asset.ownerProfileId,
            input.asset.documentId, input.asset.idempotencyKey ?? null, input.asset.kind,
            input.asset.displayName, input.asset.objectKey,
            input.asset.sourceUrl, input.asset.finalUrl, input.asset.fetchedAt, input.asset.mimeType,
            input.asset.sizeBytes, input.asset.extractionStatus, input.asset.extractedText,
            JSON.stringify(input.asset.extractionMetadata), input.asset.lastErrorCode,
            input.asset.attemptCount, input.asset.nextAttemptAt, input.asset.claimToken ?? null,
            input.asset.leaseExpiresAt ?? null, input.asset.lifecycleStatus ?? "active"]
        );
        if (asset.rows[0]!.object_key !== intent.object_key) {
          await client.query(
            `INSERT INTO studio_asset_cleanup_jobs
               (id,workspace_id,owner_profile_id,asset_id,object_key)
             VALUES ($1,$2,$3,NULL,$4)
             ON CONFLICT (workspace_id,owner_profile_id,object_key) WHERE object_key IS NOT NULL
             DO NOTHING`,
            [generatedId("studio_asset_cleanup"), intent.workspace_id, intent.owner_profile_id, intent.object_key]
          );
        }
        await client.query(
          `DELETE FROM studio_asset_upload_intents
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
          [intent.workspace_id, intent.owner_profile_id, intent.id]
        );
        return assetFromRow(asset.rows[0]!);
      });
    },

    async renewAssetUploadIntentLease(input) {
      const result = await db.query<{ id: string }>(
        `UPDATE studio_asset_upload_intents SET upload_lease_expires_at=$5,updated_at=NOW()
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
           AND status='uploading' AND upload_token=$4
         RETURNING id`,
        [input.scope.workspaceId, input.scope.ownerProfileId, input.intentId,
          input.uploadToken, input.uploadLeaseExpiresAt]
      );
      return Boolean(result.rows[0]);
    },

    async reconcileAssetUploadFailure(input) {
      return withOperationalTransaction(db, async (client) => {
        const intentResult = await client.query<StudioAssetUploadIntentRow>(
          `SELECT * FROM studio_asset_upload_intents
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR UPDATE`,
          [input.scope.workspaceId, input.scope.ownerProfileId, input.intentId]
        );
        const intent = intentResult.rows[0];
        if (!intent) {
          const existing = await client.query<StudioAssetRow>(
            `SELECT * FROM studio_assets
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND object_key=$3 AND lifecycle_status='active'`,
            [input.scope.workspaceId, input.scope.ownerProfileId, input.objectKey]
          );
          if (existing.rows[0]) return assetFromRow(existing.rows[0]);
          throw new Error("STUDIO_ASSET_UPLOAD_INTENT_NOT_FOUND");
        }
        if (intent.object_key !== input.objectKey) throw new Error("STUDIO_ASSET_UPLOAD_INTENT_MISMATCH");
        if (input.storageUploadId && intent.storage_upload_id && intent.storage_upload_id !== input.storageUploadId) {
          throw new Error("STUDIO_ASSET_UPLOAD_SESSION_MISMATCH");
        }
        const existing = await client.query<StudioAssetRow>(
          `SELECT * FROM studio_assets
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND object_key=$3 AND lifecycle_status='active'`,
          [input.scope.workspaceId, input.scope.ownerProfileId, intent.object_key]
        );
        if (existing.rows[0]) {
          await client.query(
            `DELETE FROM studio_asset_upload_intents
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
            [input.scope.workspaceId, input.scope.ownerProfileId, input.intentId]
          );
          return assetFromRow(existing.rows[0]);
        }
        if (intent.status === "uploading" && intent.upload_token === input.uploadToken) {
          await client.query(
            `UPDATE studio_asset_upload_intents SET status='cleanup_pending',next_attempt_at=$4,
               last_error_code='STUDIO_ASSET_UPLOAD_INCOMPLETE',upload_token=NULL,
               upload_lease_expires_at=NULL,claim_token=NULL,lease_expires_at=NULL,
               storage_upload_id=COALESCE(storage_upload_id,$6),storage_session_state='abort_pending',updated_at=NOW()
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND upload_token=$5`,
            [input.scope.workspaceId, input.scope.ownerProfileId, input.intentId, input.now,
              input.uploadToken, input.storageUploadId ?? null]
          );
        }
        return null;
      });
    },

    async listAssetUploadIntents(scope) {
      const result = await db.query<StudioAssetUploadIntentRow>(
        `SELECT * FROM studio_asset_upload_intents
         WHERE workspace_id=$1 AND owner_profile_id=$2 ORDER BY created_at ASC,id ASC`,
        [scope.workspaceId, scope.ownerProfileId]
      );
      return result.rows.map(uploadIntentFromRow);
    },

    async claimNextAssetUploadCleanup(now, leaseMs = 120_000, excludeOwnerKeys = []) {
      return withOperationalTransaction(db, async (client) => {
        const token = generatedId("studio_upload_cleanup_claim");
        const leaseExpiresAt = new Date(new Date(now).getTime() + leaseMs).toISOString();
        const claimed = await client.query<StudioAssetUploadIntentRow>(
          `WITH resolved_candidates AS MATERIALIZED (
             SELECT intents.workspace_id,intents.owner_profile_id,intents.id
               FROM studio_asset_upload_intents intents
               JOIN studio_assets assets
                 ON assets.workspace_id=intents.workspace_id
                AND assets.owner_profile_id=intents.owner_profile_id
                AND assets.object_key=intents.object_key
                AND assets.lifecycle_status='active'
              WHERE ((intents.status IN ('cleanup_pending','failed') AND intents.next_attempt_at IS NOT NULL
                        AND intents.next_attempt_at <= $1)
                 OR (intents.status='uploading' AND intents.upload_lease_expires_at IS NOT NULL
                       AND intents.upload_lease_expires_at <= $1)
                 OR (intents.status='processing' AND intents.lease_expires_at IS NOT NULL
                       AND intents.lease_expires_at <= $1))
                AND NOT ((intents.workspace_id || '/' || intents.owner_profile_id) = ANY($2::text[]))
              ORDER BY intents.created_at ASC,intents.id ASC
              FOR UPDATE OF intents SKIP LOCKED
           ), resolved AS (
             DELETE FROM studio_asset_upload_intents intents
              USING resolved_candidates candidates
              WHERE intents.workspace_id=candidates.workspace_id
                AND intents.owner_profile_id=candidates.owner_profile_id
                AND intents.id=candidates.id
              RETURNING intents.id
           ), candidate AS (
             SELECT intents.workspace_id,intents.owner_profile_id,intents.id
               FROM studio_asset_upload_intents intents
              WHERE ((intents.status IN ('cleanup_pending','failed') AND intents.next_attempt_at IS NOT NULL
                        AND intents.next_attempt_at <= $1)
                 OR (intents.status='uploading' AND intents.upload_lease_expires_at IS NOT NULL
                       AND intents.upload_lease_expires_at <= $1)
                 OR (intents.status='processing' AND intents.lease_expires_at IS NOT NULL
                       AND intents.lease_expires_at <= $1))
                AND NOT ((intents.workspace_id || '/' || intents.owner_profile_id) = ANY($2::text[]))
                AND NOT EXISTS (
                  SELECT 1 FROM studio_assets assets
                   WHERE assets.workspace_id=intents.workspace_id
                     AND assets.owner_profile_id=intents.owner_profile_id
                     AND assets.object_key=intents.object_key
                     AND assets.lifecycle_status='active'
                )
              ORDER BY intents.created_at ASC,intents.id ASC
              FOR UPDATE OF intents SKIP LOCKED LIMIT 1
           )
           UPDATE studio_asset_upload_intents intents
              SET status='processing',attempt_count=intents.attempt_count+1,
                  next_attempt_at=NULL,upload_token=NULL,upload_lease_expires_at=NULL,
                  storage_session_state='abort_pending',claim_token=$3,lease_expires_at=$4,updated_at=NOW()
             FROM candidate
            WHERE intents.workspace_id=candidate.workspace_id
              AND intents.owner_profile_id=candidate.owner_profile_id
              AND intents.id=candidate.id
           RETURNING intents.*`,
          [now, excludeOwnerKeys, token, leaseExpiresAt]
        );
        return claimed.rows[0] ? uploadIntentFromRow(claimed.rows[0]) : null;
      });
    },

    async resolveClaimedAssetUploadIntent(input) {
      return withOperationalTransaction(db, async (client) => {
        const intentResult = await client.query<StudioAssetUploadIntentRow>(
          `SELECT * FROM studio_asset_upload_intents
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
             AND status='processing' AND claim_token=$4 FOR UPDATE`,
          [input.scope.workspaceId, input.scope.ownerProfileId, input.intentId, input.claimToken]
        );
        const intent = intentResult.rows[0];
        if (!intent) return null;
        const existing = await client.query<StudioAssetRow>(
          `SELECT * FROM studio_assets
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND object_key=$3 AND lifecycle_status='active'`,
          [intent.workspace_id, intent.owner_profile_id, intent.object_key]
        );
        if (!existing.rows[0]) return null;
        await client.query(
          `DELETE FROM studio_asset_upload_intents
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
          [intent.workspace_id, intent.owner_profile_id, intent.id]
        );
        return assetFromRow(existing.rows[0]);
      });
    },

    async failAssetUploadCleanup(input) {
      const result = await db.query<StudioAssetUploadIntentRow>(
        `UPDATE studio_asset_upload_intents SET status='failed',last_error_code=$5,next_attempt_at=$6,
           claim_token=NULL,lease_expires_at=NULL,updated_at=NOW()
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND status='processing' AND claim_token=$4
         RETURNING *`,
        [input.scope.workspaceId, input.scope.ownerProfileId, input.intentId, input.claimToken,
          input.lastErrorCode, input.nextAttemptAt]
      );
      return result.rows[0] ? uploadIntentFromRow(result.rows[0]) : null;
    },

    async completeAssetUploadCleanup(input) {
      const result = await db.query<{ id: string }>(
        `DELETE FROM studio_asset_upload_intents
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND status='processing' AND claim_token=$4
         RETURNING id`,
        [input.scope.workspaceId, input.scope.ownerProfileId, input.intentId, input.claimToken]
      );
      return Boolean(result.rows[0]);
    },

    async claimNextAsset(now, leaseMs = 120_000, excludeOwnerKeys = []) {
      const claimToken = generatedId("studio_asset_claim");
      const leaseExpiresAt = new Date(new Date(now).getTime() + leaseMs).toISOString();
      const result = await db.query<StudioAssetRow>(
        `WITH expired AS (
           UPDATE studio_assets SET extraction_status='failed',last_error_code='STUDIO_ASSET_LEASE_EXPIRED',
             next_attempt_at=NULL,claim_token=NULL,lease_expires_at=NULL,updated_at=NOW()
           WHERE lifecycle_status='active' AND extraction_status='processing' AND attempt_count >= $4
             AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1
           RETURNING id
         ), candidate AS (
           SELECT workspace_id,owner_profile_id,id
           FROM studio_assets
           WHERE lifecycle_status='active' AND attempt_count < $4 AND (
             extraction_status='pending'
             OR (extraction_status='failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= $1)
             OR (extraction_status='processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1)
           ) AND NOT ((workspace_id || '/' || owner_profile_id) = ANY($5::text[]))
           ORDER BY created_at ASC,id ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE studio_assets asset SET
           extraction_status='processing',
           attempt_count=asset.attempt_count+1,
           next_attempt_at=NULL,
           claim_token=$2,
           lease_expires_at=$3,
           updated_at=NOW()
         FROM candidate
         WHERE asset.workspace_id=candidate.workspace_id
           AND asset.owner_profile_id=candidate.owner_profile_id
           AND asset.id=candidate.id
         RETURNING asset.*`,
        [now, claimToken, leaseExpiresAt, STUDIO_ASSET_MAX_ATTEMPTS, excludeOwnerKeys]
      );
      return result.rows[0] ? assetFromRow(result.rows[0]) : null;
    },

    async finishAssetProcessing(input) {
      const result = await db.query<StudioAssetRow>(
        `UPDATE studio_assets SET
           extraction_status=$4,extracted_text=$5,extraction_metadata=$6::jsonb,
           last_error_code=$7,next_attempt_at=$8,claim_token=NULL,lease_expires_at=NULL,updated_at=NOW()
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
           AND lifecycle_status='active' AND extraction_status='processing' AND claim_token=$9
         RETURNING *`,
        [
          input.scope.workspaceId, input.scope.ownerProfileId, input.assetId, input.extractionStatus,
          input.extractedText, JSON.stringify(input.extractionMetadata), input.lastErrorCode,
          input.nextAttemptAt, input.claimToken
        ]
      );
      return result.rows[0] ? assetFromRow(result.rows[0]) : null;
    },

    async retryAssetProcessing(scope, assetId) {
      return withOperationalTransaction(db, async (client) => {
        const current = await client.query<StudioAssetRow>(
          `SELECT * FROM studio_assets
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
             AND lifecycle_status='active' FOR UPDATE`,
          [scope.workspaceId, scope.ownerProfileId, assetId]
        );
        const asset = current.rows[0];
        if (!asset) return null;
        if (asset.extraction_status !== "failed") return assetFromRow(asset);
        const retried = await client.query<StudioAssetRow>(
          `UPDATE studio_assets SET extraction_status='pending',extracted_text=NULL,
             extraction_metadata='{}'::jsonb,last_error_code=NULL,attempt_count=0,
             next_attempt_at=NULL,claim_token=NULL,lease_expires_at=NULL,updated_at=NOW()
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
           RETURNING *`,
          [scope.workspaceId, scope.ownerProfileId, assetId]
        );
        return assetFromRow(retried.rows[0]!);
      });
    },

    async tombstoneAssetForCleanup(scope, assetId) {
      return withOperationalTransaction(db, async (client) => {
        const asset = await client.query<StudioAssetRow>(
          `SELECT * FROM studio_assets
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR UPDATE`,
          [scope.workspaceId, scope.ownerProfileId, assetId]
        );
        if (!asset.rows[0]) return null;
        if (asset.rows[0].object_key) {
          await client.query(
            `DELETE FROM studio_asset_upload_intents
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND object_key=$3`,
            [scope.workspaceId, scope.ownerProfileId, asset.rows[0].object_key]
          );
        }
        const existing = await client.query<StudioAssetCleanupJobRow>(
          `SELECT * FROM studio_asset_cleanup_jobs
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND asset_id=$3
           ORDER BY created_at ASC LIMIT 1`,
          [scope.workspaceId, scope.ownerProfileId, assetId]
        );
        if (existing.rows[0]) return cleanupJobFromRow(existing.rows[0]);
        await client.query(
          `UPDATE studio_assets SET lifecycle_status='deleting',
             extraction_status=CASE WHEN extraction_status='processing' THEN 'failed' ELSE extraction_status END,
             claim_token=NULL,lease_expires_at=NULL,updated_at=NOW()
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
          [scope.workspaceId, scope.ownerProfileId, assetId]
        );
        const job = await client.query<StudioAssetCleanupJobRow>(
          `INSERT INTO studio_asset_cleanup_jobs
             (id,workspace_id,owner_profile_id,asset_id,object_key)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [generatedId("studio_asset_cleanup"), scope.workspaceId, scope.ownerProfileId, assetId, asset.rows[0].object_key]
        );
        return cleanupJobFromRow(job.rows[0]!);
      });
    },

    async enqueueOrphanAssetCleanup(input) {
      const inserted = await db.query<StudioAssetCleanupJobRow>(
        `INSERT INTO studio_asset_cleanup_jobs
           (id,workspace_id,owner_profile_id,asset_id,object_key)
         VALUES ($1,$2,$3,NULL,$4)
         ON CONFLICT (workspace_id,owner_profile_id,object_key) WHERE object_key IS NOT NULL
         DO NOTHING RETURNING *`,
        [generatedId("studio_asset_cleanup"), input.workspaceId, input.ownerProfileId, input.objectKey]
      );
      if (inserted.rows[0]) return cleanupJobFromRow(inserted.rows[0]);
      const existing = await db.query<StudioAssetCleanupJobRow>(
        `SELECT * FROM studio_asset_cleanup_jobs
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND object_key=$3`,
        [input.workspaceId, input.ownerProfileId, input.objectKey]
      );
      if (!existing.rows[0]) throw new Error("STUDIO_ASSET_CLEANUP_ENQUEUE_FAILED");
      return cleanupJobFromRow(existing.rows[0]);
    },

    async listAssetCleanupJobs(scope) {
      const result = await db.query<StudioAssetCleanupJobRow>(
        `SELECT * FROM studio_asset_cleanup_jobs
         WHERE workspace_id=$1 AND owner_profile_id=$2 ORDER BY created_at ASC,id ASC`,
        [scope.workspaceId, scope.ownerProfileId]
      );
      return result.rows.map(cleanupJobFromRow);
    },

    async claimNextAssetCleanup(now, leaseMs = 120_000, excludeOwnerKeys = []) {
      const claimToken = generatedId("studio_cleanup_claim");
      const leaseExpiresAt = new Date(new Date(now).getTime() + leaseMs).toISOString();
      const result = await db.query<StudioAssetCleanupJobRow>(
        `WITH candidate AS (
           SELECT workspace_id,owner_profile_id,id FROM studio_asset_cleanup_jobs
           WHERE (status='pending'
             OR (status='failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= $1)
             OR (status='processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1)
           ) AND NOT ((workspace_id || '/' || owner_profile_id) = ANY($4::text[]))
           ORDER BY created_at ASC,id ASC FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE studio_asset_cleanup_jobs job SET status='processing',attempt_count=job.attempt_count+1,
           next_attempt_at=NULL,claim_token=$2,lease_expires_at=$3,updated_at=NOW()
         FROM candidate
         WHERE job.workspace_id=candidate.workspace_id AND job.owner_profile_id=candidate.owner_profile_id
           AND job.id=candidate.id
         RETURNING job.*`,
        [now, claimToken, leaseExpiresAt, excludeOwnerKeys]
      );
      return result.rows[0] ? cleanupJobFromRow(result.rows[0]) : null;
    },

    async claimAssetCleanup(scope, jobId, now, leaseMs = 120_000) {
      const claimToken = generatedId("studio_cleanup_claim");
      const leaseExpiresAt = new Date(new Date(now).getTime() + leaseMs).toISOString();
      const result = await db.query<StudioAssetCleanupJobRow>(
        `UPDATE studio_asset_cleanup_jobs SET status='processing',attempt_count=attempt_count+1,
           next_attempt_at=NULL,claim_token=$5,lease_expires_at=$6,updated_at=NOW()
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND (
           status='pending'
           OR (status='failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= $4)
           OR (status='processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $4)
         ) RETURNING *`,
        [scope.workspaceId, scope.ownerProfileId, jobId, now, claimToken, leaseExpiresAt]
      );
      return result.rows[0] ? cleanupJobFromRow(result.rows[0]) : null;
    },

    async failAssetCleanup(input) {
      const result = await db.query<StudioAssetCleanupJobRow>(
        `UPDATE studio_asset_cleanup_jobs SET status='failed',last_error_code=$5,
           next_attempt_at=$6,claim_token=NULL,lease_expires_at=NULL,updated_at=NOW()
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND claim_token=$4 AND status='processing'
         RETURNING *`,
        [input.scope.workspaceId, input.scope.ownerProfileId, input.jobId, input.claimToken,
          input.lastErrorCode, input.nextAttemptAt]
      );
      return result.rows[0] ? cleanupJobFromRow(result.rows[0]) : null;
    },

    async completeAssetCleanup(input) {
      return withOperationalTransaction(db, async (client) => {
        const removedJob = await client.query<StudioAssetCleanupJobRow>(
          `DELETE FROM studio_asset_cleanup_jobs
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
             AND claim_token=$4 AND status='processing' RETURNING *`,
          [input.scope.workspaceId, input.scope.ownerProfileId, input.jobId, input.claimToken]
        );
        const job = removedJob.rows[0];
        if (!job) return false;
        if (job.object_key) {
          await client.query(
            `DELETE FROM studio_asset_upload_intents
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND object_key=$3`,
            [job.workspace_id, job.owner_profile_id, job.object_key]
          );
        }
        if (job.asset_id) {
          await client.query(
            `DELETE FROM studio_assets
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND lifecycle_status='deleting'`,
            [job.workspace_id, job.owner_profile_id, job.asset_id]
          );
        }
        return true;
      });
    },

    async createRelation(input) {
      if (input.createdByProfileId !== input.ownerProfileId) throw new Error("STUDIO_ACTOR_SCOPE_MISMATCH");
      if (input.sourceDocumentId === input.targetDocumentId) throw new Error("STUDIO_RELATION_SELF_INVALID");
      return withOperationalTransaction(db, async (client) => {
        const ownedDocuments = await client.query<{ id: string }>(
          `SELECT id FROM studio_documents
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=ANY($3::text[])
           FOR KEY SHARE`,
          [input.workspaceId, input.ownerProfileId, [input.sourceDocumentId, input.targetDocumentId]]
        );
        if (new Set(ownedDocuments.rows.map((row) => row.id)).size !== 2) {
          throw new Error("STUDIO_RELATION_DOCUMENT_NOT_FOUND");
        }
        const inserted = await client.query<StudioRelationRow>(
          `INSERT INTO studio_relations
             (id,workspace_id,owner_profile_id,source_document_id,target_document_id,relation_type,created_by_profile_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (workspace_id,owner_profile_id,source_document_id,target_document_id,relation_type)
           DO NOTHING RETURNING *`,
          [generatedId("studio_relation"), input.workspaceId, input.ownerProfileId,
            input.sourceDocumentId, input.targetDocumentId, input.relationType, input.createdByProfileId]
        );
        if (inserted.rows[0]) return relationFromRow(inserted.rows[0]);
        const existing = await client.query<StudioRelationRow>(
          `SELECT * FROM studio_relations
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND source_document_id=$3
             AND target_document_id=$4 AND relation_type=$5`,
          [input.workspaceId, input.ownerProfileId, input.sourceDocumentId,
            input.targetDocumentId, input.relationType]
        );
        if (!existing.rows[0]) throw new Error("STUDIO_RELATION_CREATE_FAILED");
        return relationFromRow(existing.rows[0]);
      });
    },

    async listRelations(scope, documentId) {
      const params: unknown[] = [scope.workspaceId, scope.ownerProfileId];
      const documentFilter = documentId
        ? (params.push(documentId), `AND (source_document_id=$3 OR target_document_id=$3)`)
        : "";
      const result = await db.query<StudioRelationRow>(
        `SELECT * FROM studio_relations
         WHERE workspace_id=$1 AND owner_profile_id=$2 ${documentFilter}
         ORDER BY created_at ASC,id ASC`,
        params
      );
      return result.rows.map(relationFromRow);
    },

    async listIndexJobs(scope) {
      const result = await db.query<StudioIndexJobRow>(
        `SELECT * FROM studio_index_jobs
         WHERE workspace_id=$1 AND owner_profile_id=$2 ORDER BY created_at ASC,id ASC`,
        [scope.workspaceId, scope.ownerProfileId]
      );
      return result.rows.map(indexJobFromRow);
    },

    async claimNextIndexJob(now, leaseMs = 60_000, maxAttempts = 5, excludeOwnerKeys = []) {
      const claimToken = generatedId("studio_index_claim");
      const leaseExpiresAt = new Date(new Date(now).getTime() + leaseMs).toISOString();
      const result = await db.query<StudioIndexJobRow>(
        `WITH terminalized AS (
           UPDATE studio_index_jobs SET status='failed',next_attempt_at=NULL,
             last_error_code='STUDIO_MEMORY_INDEX_MAX_ATTEMPTS',claim_token=NULL,
             lease_expires_at=NULL,updated_at=NOW()
           WHERE attempt_count >= $4 AND (
             (status IN ('pending','failed') AND next_attempt_at IS NOT NULL AND next_attempt_at <= $1)
             OR (status='processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1)
           ) RETURNING id
         ), candidate AS (
           SELECT workspace_id,owner_profile_id,id FROM studio_index_jobs
           WHERE attempt_count < $4 AND (
             (status IN ('pending','failed') AND next_attempt_at IS NOT NULL AND next_attempt_at <= $1)
             OR (status='processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1)
           ) AND NOT ((workspace_id || '/' || owner_profile_id) = ANY($5::text[]))
           ORDER BY created_at ASC,id ASC FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE studio_index_jobs job SET status='processing',attempt_count=job.attempt_count+1,
           next_attempt_at=NULL,last_error_code=NULL,claim_token=$2,lease_expires_at=$3,updated_at=NOW()
         FROM candidate
         WHERE job.workspace_id=candidate.workspace_id AND job.owner_profile_id=candidate.owner_profile_id
           AND job.id=candidate.id
         RETURNING job.*`,
        [now, claimToken, leaseExpiresAt, maxAttempts, excludeOwnerKeys]
      );
      return result.rows[0] ? indexJobFromRow(result.rows[0]) : null;
    },

    async renewIndexJobLease(input) {
      const result = await db.query<{ id: string }>(
        `UPDATE studio_index_jobs SET lease_expires_at=$6,updated_at=NOW()
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
           AND status='processing' AND claim_token=$4
           AND lease_expires_at IS NOT NULL AND lease_expires_at > $5
         RETURNING id`,
        [input.workspaceId, input.ownerProfileId, input.jobId, input.claimToken,
          input.now, input.leaseExpiresAt]
      );
      return result.rows.length === 1;
    },

    async completeIndexJob(input) {
      const result = await db.query<{ id: string }>(
        `UPDATE studio_index_jobs SET status='completed',next_attempt_at=NULL,last_error_code=NULL,
           claim_token=NULL,lease_expires_at=NULL,updated_at=NOW()
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
           AND status='processing' AND claim_token=$4
           AND lease_expires_at IS NOT NULL AND lease_expires_at > NOW() RETURNING id`,
        [input.workspaceId, input.ownerProfileId, input.jobId, input.claimToken]
      );
      return result.rows.length === 1;
    },

    async failIndexJob(input) {
      const result = await db.query<StudioIndexJobRow>(
        `UPDATE studio_index_jobs SET status='failed',next_attempt_at=$5,last_error_code=$6,
           claim_token=NULL,lease_expires_at=NULL,updated_at=NOW()
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
           AND status='processing' AND claim_token=$4
           AND lease_expires_at IS NOT NULL AND lease_expires_at > NOW() RETURNING *`,
        [input.workspaceId, input.ownerProfileId, input.jobId, input.claimToken,
          input.nextAttemptAt, input.lastErrorCode]
      );
      return result.rows[0] ? indexJobFromRow(result.rows[0]) : null;
    },

    async startAssistantTurn(input) {
      return withOperationalTransaction(db, async (client) => {
        let conversation: StudioConversation;
        if (input.conversationId) {
          const result = await client.query<StudioConversationRow>(
            `SELECT * FROM studio_conversations
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR UPDATE`,
            [input.workspaceId, input.ownerProfileId, input.conversationId]
          );
          if (!result.rows[0]) throw new Error("STUDIO_CONVERSATION_NOT_FOUND");
          conversation = conversationFromRow(result.rows[0]);
          if (input.documentId !== null && input.documentId !== conversation.documentId) {
            throw new Error("STUDIO_CONVERSATION_DOCUMENT_MISMATCH");
          }
        } else {
          if (input.documentId) {
            const document = await client.query<{ id: string }>(
              `SELECT id FROM studio_documents
               WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR KEY SHARE`,
              [input.workspaceId, input.ownerProfileId, input.documentId]
            );
            if (!document.rows[0]) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
          }
          const result = await client.query<StudioConversationRow>(
            `INSERT INTO studio_conversations (id,workspace_id,owner_profile_id,document_id)
             VALUES ($1,$2,$3,$4) RETURNING *`,
            [generatedId("studio_conversation"), input.workspaceId, input.ownerProfileId, input.documentId]
          );
          conversation = conversationFromRow(result.rows[0]!);
        }
        const messageResult = await client.query<StudioMessageRow>(
          `INSERT INTO studio_messages
             (id,workspace_id,owner_profile_id,conversation_id,role,content,ai_run_id,status)
           VALUES ($1,$2,$3,$4,'user',$5,NULL,'complete') RETURNING *`,
          [generatedId("studio_message"), input.workspaceId, input.ownerProfileId, conversation.id, input.content]
        );
        const updatedConversation = await client.query<StudioConversationRow>(
          `UPDATE studio_conversations SET updated_at=NOW()
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 RETURNING *`,
          [input.workspaceId, input.ownerProfileId, conversation.id]
        );
        return { conversation: conversationFromRow(updatedConversation.rows[0]!), message: messageFromRow(messageResult.rows[0]!) };
      });
    },

    async listConversationMessages(scope, conversationId, limit) {
      const conversation = await db.query<{ id: string }>(
        `SELECT id FROM studio_conversations WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
        [scope.workspaceId, scope.ownerProfileId, conversationId]
      );
      if (!conversation.rows[0]) throw new Error("STUDIO_CONVERSATION_NOT_FOUND");
      const result = await db.query<StudioMessageRow>(
        `SELECT * FROM (
           SELECT * FROM studio_messages
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND conversation_id=$3
           ORDER BY created_at DESC,id DESC LIMIT $4
         ) recent ORDER BY created_at ASC,id ASC`,
        [scope.workspaceId, scope.ownerProfileId, conversationId, limit]
      );
      return result.rows.map(messageFromRow);
    },

    async finishAssistantTurn(input) {
      return withOperationalTransaction(db, async (client) => {
        const conversation = await client.query<{ id: string }>(
          `SELECT id FROM studio_conversations
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR UPDATE`,
          [input.workspaceId, input.ownerProfileId, input.conversationId]
        );
        if (!conversation.rows[0]) throw new Error("STUDIO_CONVERSATION_NOT_FOUND");
        const messageResult = await client.query<StudioMessageRow>(
          `INSERT INTO studio_messages
             (id,workspace_id,owner_profile_id,conversation_id,role,content,ai_run_id,status)
           VALUES ($1,$2,$3,$4,'assistant',$5,$6,'complete') RETURNING *`,
          [generatedId("studio_message"), input.workspaceId, input.ownerProfileId,
            input.conversationId, input.content, input.aiRunId]
        );
        const message = messageFromRow(messageResult.rows[0]!);
        const citations = await insertCitations(client, input.citations, { messageId: message.id, suggestionId: null });
        await client.query(
          `UPDATE studio_conversations SET updated_at=NOW()
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
          [input.workspaceId, input.ownerProfileId, input.conversationId]
        );
        return { message, citations };
      });
    },

    async createAssistantSuggestion(input) {
      return withOperationalTransaction(db, async (client) => {
        if (input.conversationId) {
          const conversation = await client.query<{ id: string }>(
            `SELECT id FROM studio_conversations
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR KEY SHARE`,
            [input.workspaceId, input.ownerProfileId, input.conversationId]
          );
          if (!conversation.rows[0]) throw new Error("STUDIO_CONVERSATION_NOT_FOUND");
        }
        if (input.documentId) {
          const document = await client.query<{ id: string }>(
            `SELECT id FROM studio_documents
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR KEY SHARE`,
            [input.workspaceId, input.ownerProfileId, input.documentId]
          );
          if (!document.rows[0]) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
        }
        if (input.payloadJson.proposal.document_id !== input.documentId) throw new Error("STUDIO_SUGGESTION_DOCUMENT_MISMATCH");
        const result = await client.query<StudioSuggestionRow>(
          `INSERT INTO studio_suggestions
             (id,workspace_id,owner_profile_id,document_id,conversation_id,ai_run_id,kind,payload_json,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'pending') RETURNING *`,
          [generatedId("studio_suggestion"), input.workspaceId, input.ownerProfileId,
            input.documentId, input.conversationId, input.aiRunId, input.kind,
            JSON.stringify(input.payloadJson)]
        );
        const suggestion = suggestionFromRow(result.rows[0]!);
        const citations = await insertCitations(client, input.citations, { messageId: null, suggestionId: suggestion.id });
        return { suggestion, citations };
      });
    },

    async findSuggestion(scope, suggestionId) {
      const result = await db.query<StudioSuggestionRow>(
        `SELECT * FROM studio_suggestions WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
        [scope.workspaceId, scope.ownerProfileId, suggestionId]
      );
      return result.rows[0] ? suggestionFromRow(result.rows[0]) : null;
    },

    async acceptSuggestion(scope, suggestionId, actorProfileId, proposalOverride) {
      if (actorProfileId !== scope.ownerProfileId) throw new Error("STUDIO_ACTOR_SCOPE_MISMATCH");
      return withOperationalTransaction(db, async (client) => {
        const result = await client.query<StudioSuggestionRow>(
          `SELECT * FROM studio_suggestions
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR UPDATE`,
          [scope.workspaceId, scope.ownerProfileId, suggestionId]
        );
        if (!result.rows[0]) throw new Error("STUDIO_SUGGESTION_NOT_FOUND");
        const suggestion = suggestionFromRow(result.rows[0]);
        if (suggestion.status === "accepted") {
          const version = await client.query<StudioDocumentVersionRow>(
            `SELECT * FROM studio_document_versions
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
            [scope.workspaceId, scope.ownerProfileId, suggestion.acceptedVersionId]
          );
          if (!version.rows[0]) throw new Error("STUDIO_SUGGESTION_VERSION_NOT_FOUND");
          return { suggestion, version: versionFromRow(version.rows[0]) };
        }
        if (suggestion.status !== "pending") throw new Error("STUDIO_SUGGESTION_ALREADY_DECIDED");
        const payload = proposalOverride ?? suggestion.payloadJson.proposal;
        if (!suggestion.documentId || payload.document_id !== suggestion.documentId) {
          throw new Error("STUDIO_SUGGESTION_DOCUMENT_MISMATCH");
        }
        if (payload.expected_revision !== suggestion.payloadJson.proposal.expected_revision) {
          throw new Error("STUDIO_SUGGESTION_DOCUMENT_MISMATCH");
        }
        const documentResult = await client.query<StudioDocumentRow>(
          `SELECT * FROM studio_documents
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR UPDATE`,
          [scope.workspaceId, scope.ownerProfileId, suggestion.documentId]
        );
        if (!documentResult.rows[0]) throw new Error("STUDIO_DOCUMENT_NOT_FOUND");
        const document = documentFromRow(documentResult.rows[0]);
        if (document.revision !== payload.expected_revision) throw new Error("STUDIO_DOCUMENT_STALE");
        const search = prepareStudioSearchFields(payload.title, payload.body_text);
        const updatedDocument = await client.query<StudioDocumentRow>(
          `UPDATE studio_documents SET title=$4,body_json=$5::jsonb,body_text=$6,
             search_title_folded=$7,search_body_folded=$8,search_tokens=$9::text[],
             search_prefix_tokens=$10::text[],revision=revision+1,updated_at=NOW()
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 RETURNING *`,
          [scope.workspaceId, scope.ownerProfileId, document.id, payload.title,
            JSON.stringify(payload.body_json), payload.body_text, search.titleFolded,
            search.bodyFolded, search.tokens, search.prefixTokens]
        );
        const version = await insertVersion(client, {
          ...scope, documentId: document.id, bodyJson: payload.body_json, bodyText: payload.body_text,
          origin: "accepted_ai_suggestion", actorProfileId, aiRunId: suggestion.aiRunId
        });
        await insertIndexJob(client, documentFromRow(updatedDocument.rows[0]!));
        const accepted = await client.query<StudioSuggestionRow>(
          `UPDATE studio_suggestions SET status='accepted',accepted_version_id=$4,decided_at=NOW()
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 RETURNING *`,
          [scope.workspaceId, scope.ownerProfileId, suggestionId, version.id]
        );
        return { suggestion: suggestionFromRow(accepted.rows[0]!), version };
      });
    },

    async dismissSuggestion(scope, suggestionId) {
      return withOperationalTransaction(db, async (client) => {
        const result = await client.query<StudioSuggestionRow>(
          `SELECT * FROM studio_suggestions
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR UPDATE`,
          [scope.workspaceId, scope.ownerProfileId, suggestionId]
        );
        if (!result.rows[0]) throw new Error("STUDIO_SUGGESTION_NOT_FOUND");
        const suggestion = suggestionFromRow(result.rows[0]);
        if (suggestion.status === "dismissed") return { suggestion, version: null };
        if (suggestion.status !== "pending") throw new Error("STUDIO_SUGGESTION_ALREADY_DECIDED");
        const dismissed = await client.query<StudioSuggestionRow>(
          `UPDATE studio_suggestions SET status='dismissed',decided_at=NOW()
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 RETURNING *`,
          [scope.workspaceId, scope.ownerProfileId, suggestionId]
        );
        return { suggestion: suggestionFromRow(dismissed.rows[0]!), version: null };
      });
    }
  };
}
