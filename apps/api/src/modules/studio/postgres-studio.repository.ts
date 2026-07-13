import type {
  StudioCaptureMode,
  StudioDocument,
  StudioDocumentStatus,
  StudioDocumentVersion,
  StudioRepository,
  StudioOwnerScope
} from "./studio.types";
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

type DocumentCursor = {
  updatedAt: string;
  id: string;
};

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

function encodeCursor(document: StudioDocument) {
  return Buffer.from(JSON.stringify({ updatedAt: document.updatedAt, id: document.id })).toString("base64url");
}

function decodeCursor(cursor: string): DocumentCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<DocumentCursor>;
    if (typeof value.updatedAt !== "string" || typeof value.id !== "string") throw new Error();
    return { updatedAt: value.updatedAt, id: value.id };
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
        const result = await client.query<StudioDocumentRow>(
          `INSERT INTO studio_documents
             (id,workspace_id,owner_profile_id,title,body_json,body_text,capture_mode,inbox_state,is_focused,status)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            generatedId("studio_document"),
            input.workspaceId,
            input.ownerProfileId,
            input.title,
            JSON.stringify(input.bodyJson),
            input.bodyText,
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
        const result = await client.query<StudioDocumentRow>(
          `UPDATE studio_documents SET
             title=$4,body_json=$5::jsonb,body_text=$6,capture_mode=$7,
             inbox_state=$8,is_focused=$9,status=$10,archived_at=$11,
             revision=revision+1,updated_at=NOW()
           WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND revision=$12
           RETURNING *`,
          [
            document.workspaceId,
            document.ownerProfileId,
            document.id,
            document.title,
            JSON.stringify(document.bodyJson),
            document.bodyText,
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
    }
  };
}
