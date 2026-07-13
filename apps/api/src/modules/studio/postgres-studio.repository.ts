import type {
  StudioCaptureMode,
  StudioAsset,
  StudioAssetCleanupJob,
  StudioAssetCleanupStatus,
  StudioAssetExtractionStatus,
  StudioAssetKind,
  StudioCollection,
  StudioCollectionMembership,
  StudioDocument,
  StudioDocumentStatus,
  StudioDocumentVersion,
  StudioRepository,
  StudioOwnerScope,
  StudioSearchDocument
} from "./studio.types";
import { STUDIO_ASSET_MAX_ATTEMPTS } from "./studio.types";
import {
  prepareStudioSearchFields,
  prepareStudioSearchQuery
} from "./studio-search";
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

type StudioAssetRow = {
  id: string;
  workspace_id: string;
  owner_profile_id: string;
  document_id: string;
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
    archivedAt: row.archived_at ? iso(row.archived_at) : null
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
    createdAt: iso(row.created_at)
  };
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

function assetFromRow(row: StudioAssetRow): StudioAsset {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerProfileId: row.owner_profile_id,
    documentId: row.document_id,
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
       (id,workspace_id,owner_profile_id,document_id,version_number,body_json,body_text,origin,actor_profile_id,ai_run_id)
     VALUES (
       $1,$2,$3,$4,
       (SELECT COALESCE(MAX(version_number),0)+1 FROM studio_document_versions
        WHERE workspace_id=$2 AND owner_profile_id=$3 AND document_id=$4),
       $5::jsonb,$6,$7,$8,$9
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
      input.aiRunId
    ]
  );
  return versionFromRow(result.rows[0]!);
}

export function createPostgresStudioRepository(db: OperationalPool): StudioRepository {
  return {
    async listDocuments(scope, input) {
      const params: unknown[] = [scope.workspaceId, scope.ownerProfileId];
      const conditions = ["workspace_id=$1", "owner_profile_id=$2"];
      if (input.status) {
        params.push(input.status);
        conditions.push(`status=$${params.length}`);
      }
      if (input.cursor) {
        const cursor = decodeCursor(input.cursor);
        params.push(cursor.updatedAt, cursor.id);
        conditions.push(`(date_trunc('milliseconds',updated_at),id) < ($${params.length - 1}::timestamptz,$${params.length}::text)`);
      }
      params.push(input.limit + 1);
      const result = await db.query<StudioDocumentRow>(
        `SELECT * FROM studio_documents
         WHERE ${conditions.join(" AND ")}
         ORDER BY date_trunc('milliseconds',updated_at) DESC,id DESC
         LIMIT $${params.length}`,
        params
      );
      const documents = result.rows.map(documentFromRow);
      const items = documents.slice(0, input.limit);
      return {
        items,
        nextCursor: documents.length > items.length && items.length > 0
          ? encodeCursor(items[items.length - 1]!)
          : null
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
             (id,workspace_id,owner_profile_id,title,body_json,body_text,
              search_title_folded,search_body_folded,search_tokens,search_prefix_tokens,
              capture_mode,inbox_state,is_focused,status)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::text[],$10::text[],$11,$12,$13,$14)
           RETURNING *`,
          [
            generatedId("studio_document"),
            input.workspaceId,
            input.ownerProfileId,
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
        return document;
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
             inbox_state=$12,is_focused=$13,status=$14,archived_at=$15,
             revision=revision+1,updated_at=NOW()
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND revision=$16
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
            expectedRevision
          ]
        );
        if (!result.rows[0]) {
          const exists = await findDocument(client, document, document.id);
          throw new Error(exists ? "STUDIO_DOCUMENT_STALE" : "STUDIO_DOCUMENT_NOT_FOUND");
        }
        const updated = documentFromRow(result.rows[0]);
        await insertVersion(client, {
          workspaceId: updated.workspaceId,
          ownerProfileId: updated.ownerProfileId,
          documentId: updated.id,
          bodyJson: updated.bodyJson,
          bodyText: updated.bodyText,
          origin: "user",
          actorProfileId: updated.ownerProfileId,
          aiRunId: null
        });
        return updated;
      });
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
             (id,workspace_id,owner_profile_id,document_id,kind,display_name,
              object_key,source_url,final_url,fetched_at,mime_type,size_bytes,
              extraction_status,extracted_text,extraction_metadata,last_error_code,
              attempt_count,next_attempt_at,claim_token,lease_expires_at,lifecycle_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,$21)
           RETURNING *`,
          [
            generatedId("studio_asset"), input.workspaceId, input.ownerProfileId,
            input.documentId, input.kind, input.displayName, input.objectKey,
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

    async claimNextAsset(now, leaseMs = 120_000) {
      const claimToken = generatedId("studio_asset_claim");
      const leaseExpiresAt = new Date(new Date(now).getTime() + leaseMs).toISOString();
      const result = await db.query<StudioAssetRow>(
        `WITH candidate AS (
           SELECT workspace_id,owner_profile_id,id
           FROM studio_assets
           WHERE lifecycle_status='active' AND attempt_count < $4 AND (
             extraction_status='pending'
             OR (extraction_status='failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= $1)
             OR (extraction_status='processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1)
           )
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
        [now, claimToken, leaseExpiresAt, STUDIO_ASSET_MAX_ATTEMPTS]
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

    async tombstoneAssetForCleanup(scope, assetId) {
      return withOperationalTransaction(db, async (client) => {
        const asset = await client.query<StudioAssetRow>(
          `SELECT * FROM studio_assets
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 FOR UPDATE`,
          [scope.workspaceId, scope.ownerProfileId, assetId]
        );
        if (!asset.rows[0]) return null;
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

    async claimNextAssetCleanup(now, leaseMs = 120_000) {
      const claimToken = generatedId("studio_cleanup_claim");
      const leaseExpiresAt = new Date(new Date(now).getTime() + leaseMs).toISOString();
      const result = await db.query<StudioAssetCleanupJobRow>(
        `WITH candidate AS (
           SELECT workspace_id,owner_profile_id,id FROM studio_asset_cleanup_jobs
           WHERE status='pending'
             OR (status='failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= $1)
             OR (status='processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1)
           ORDER BY created_at ASC,id ASC FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE studio_asset_cleanup_jobs job SET status='processing',attempt_count=job.attempt_count+1,
           next_attempt_at=NULL,claim_token=$2,lease_expires_at=$3,updated_at=NOW()
         FROM candidate
         WHERE job.workspace_id=candidate.workspace_id AND job.owner_profile_id=candidate.owner_profile_id
           AND job.id=candidate.id
         RETURNING job.*`,
        [now, claimToken, leaseExpiresAt]
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
        if (job.asset_id) {
          await client.query(
            `DELETE FROM studio_assets
             WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND lifecycle_status='deleting'`,
            [job.workspace_id, job.owner_profile_id, job.asset_id]
          );
        }
        return true;
      });
    }
  };
}
