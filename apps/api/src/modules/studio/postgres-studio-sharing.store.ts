import { randomUUID } from "node:crypto";
import type { OperationalPool } from "../../db/operational-repository-support";
import type { StudioSharingStore } from "./studio-sharing.store";
import type { StudioComment, StudioImportRecord, StudioShare, StudioShareAudience } from "./studio-sharing.types";

type Row = Record<string, unknown>;
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);

export function createPostgresStudioSharingStore(pool: OperationalPool): StudioSharingStore {
  return {
    async replaceShares(scope, documentId, audiences, now) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM studio_document_shares WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3",
          [scope.workspaceId, scope.ownerProfileId, documentId]);
        const result: StudioShare[] = [];
        for (const audience of audiences) {
          const share = { ...scope, id: `studio_share_${randomUUID()}`, documentId, audience, createdAt: now };
          await client.query(
            `INSERT INTO studio_document_shares
              (id,workspace_id,owner_profile_id,document_id,audience_type,recipient_profile_id,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [share.id, scope.workspaceId, scope.ownerProfileId, documentId, audience.type,
              audience.type === "owner" ? audience.profileId : null, now]
          );
          result.push(share);
        }
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },
    async listSharesForSource(scope, documentId) {
      const result = await pool.query<Row>(
        "SELECT * FROM studio_document_shares WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3 ORDER BY created_at,id",
        [scope.workspaceId, scope.ownerProfileId, documentId]
      );
      return result.rows.map(shareFromRow);
    },
    async listSharesForRecipient(workspaceId, ownerProfileId) {
      const result = await pool.query<Row>(
        `SELECT * FROM studio_document_shares
         WHERE workspace_id=$1 AND owner_profile_id<>$2
           AND (audience_type='all_owners' OR recipient_profile_id=$2)
         ORDER BY created_at DESC,id DESC`, [workspaceId, ownerProfileId]
      );
      return result.rows.map(shareFromRow);
    },
    async findSourceShare(source, documentId, recipientProfileId) {
      const result = await pool.query<Row>(
        `SELECT * FROM studio_document_shares WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3
         AND (audience_type='all_owners' OR recipient_profile_id=$4) LIMIT 1`,
        [source.workspaceId, source.ownerProfileId, documentId, recipientProfileId]
      );
      return result.rows[0] ? shareFromRow(result.rows[0]) : null;
    },
    async listComments(source, documentId) {
      const result = await pool.query<Row>(
        "SELECT * FROM studio_document_comments WHERE workspace_id=$1 AND owner_profile_id=$2 AND document_id=$3 ORDER BY created_at,id",
        [source.workspaceId, source.ownerProfileId, documentId]
      );
      return result.rows.map(commentFromRow);
    },
    async createComment(input) {
      const id = `studio_comment_${randomUUID()}`;
      const result = await pool.query<Row>(
        `INSERT INTO studio_document_comments
          (id,workspace_id,owner_profile_id,document_id,author_profile_id,author_name,body,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [id, input.workspaceId, input.ownerProfileId, input.documentId, input.authorProfileId, input.authorName,
          input.body, input.createdAt, input.updatedAt]
      );
      return commentFromRow(result.rows[0]!);
    },
    async updateComment(comment) {
      const result = await pool.query<Row>(
        `UPDATE studio_document_comments SET body=$4,updated_at=$5
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 RETURNING *`,
        [comment.workspaceId, comment.ownerProfileId, comment.id, comment.body, comment.updatedAt]
      );
      if (!result.rows[0]) throw new Error("STUDIO_COMMENT_NOT_FOUND");
      return commentFromRow(result.rows[0]);
    },
    async deleteComment(source, commentId) {
      const result = await pool.query("DELETE FROM studio_document_comments WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3",
        [source.workspaceId, source.ownerProfileId, commentId]);
      return (result.rowCount ?? 0) > 0;
    },
    async findComment(source, commentId) {
      const result = await pool.query<Row>(
        "SELECT * FROM studio_document_comments WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3",
        [source.workspaceId, source.ownerProfileId, commentId]
      );
      return result.rows[0] ? commentFromRow(result.rows[0]) : null;
    },
    async findImportByKey(scope, key) {
      const result = await pool.query<Row>(
        "SELECT * FROM studio_document_imports WHERE workspace_id=$1 AND owner_profile_id=$2 AND idempotency_key=$3",
        [scope.workspaceId, scope.ownerProfileId, key]
      );
      return result.rows[0] ? importFromRow(result.rows[0]) : null;
    },
    async findImport(scope, importedDocumentId) {
      const result = await pool.query<Row>(
        "SELECT * FROM studio_document_imports WHERE workspace_id=$1 AND owner_profile_id=$2 AND imported_document_id=$3",
        [scope.workspaceId, scope.ownerProfileId, importedDocumentId]
      );
      return result.rows[0] ? importFromRow(result.rows[0]) : null;
    },
    async createImport(input) {
      const id = `studio_import_${randomUUID()}`;
      const result = await pool.query<Row>(
        `INSERT INTO studio_document_imports
          (id,workspace_id,owner_profile_id,imported_document_id,source_workspace_id,source_owner_profile_id,
           source_document_id,source_owner_name,source_title,source_revision,dismissed_revision,source_unavailable_at,
           idempotency_key,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [id, input.workspaceId, input.ownerProfileId, input.importedDocumentId, input.sourceWorkspaceId,
          input.sourceOwnerProfileId, input.sourceDocumentId, input.sourceOwnerName, input.sourceTitle,
          input.sourceRevision, input.dismissedRevision, input.sourceUnavailableAt, input.idempotencyKey, input.createdAt]
      );
      return importFromRow(result.rows[0]!);
    },
    async updateImport(input) {
      const result = await pool.query<Row>(
        `UPDATE studio_document_imports SET dismissed_revision=$4,source_unavailable_at=$5
         WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 RETURNING *`,
        [input.workspaceId, input.ownerProfileId, input.id, input.dismissedRevision, input.sourceUnavailableAt]
      );
      if (!result.rows[0]) throw new Error("STUDIO_IMPORT_NOT_FOUND");
      return importFromRow(result.rows[0]);
    }
  };
}

function shareFromRow(row: Row): StudioShare {
  const audience: StudioShareAudience = row.audience_type === "all_owners"
    ? { type: "all_owners" } : { type: "owner", profileId: String(row.recipient_profile_id) };
  return { id: String(row.id), workspaceId: String(row.workspace_id), ownerProfileId: String(row.owner_profile_id),
    documentId: String(row.document_id), audience, createdAt: iso(row.created_at) };
}
function commentFromRow(row: Row): StudioComment {
  return { id: String(row.id), workspaceId: String(row.workspace_id), ownerProfileId: String(row.owner_profile_id),
    documentId: String(row.document_id), authorProfileId: String(row.author_profile_id), authorName: String(row.author_name),
    body: String(row.body), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
function importFromRow(row: Row): StudioImportRecord {
  return { id: String(row.id), workspaceId: String(row.workspace_id), ownerProfileId: String(row.owner_profile_id),
    importedDocumentId: String(row.imported_document_id), sourceWorkspaceId: String(row.source_workspace_id),
    sourceOwnerProfileId: String(row.source_owner_profile_id), sourceDocumentId: String(row.source_document_id),
    sourceOwnerName: String(row.source_owner_name), sourceTitle: row.source_title == null ? null : String(row.source_title),
    sourceRevision: Number(row.source_revision), dismissedRevision: row.dismissed_revision == null ? null : Number(row.dismissed_revision),
    sourceUnavailableAt: row.source_unavailable_at == null ? null : iso(row.source_unavailable_at),
    idempotencyKey: String(row.idempotency_key), createdAt: iso(row.created_at) };
}

