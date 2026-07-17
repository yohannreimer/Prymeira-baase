import type { OperationalPool } from "../../db/operational-repository-support";
import { generatedId } from "../../db/operational-repository-support";
import type { Publication, PublicationExternalGrant, PublicationStore } from "./publication.types";

type PublicationRow = {
  id: string; workspace_id: string; owner_profile_id: string; resource_type: Publication["resourceType"];
  resource_id: string; format: Publication["format"]; status: Publication["status"]; title: string;
  object_key: string | null; content_type: string | null; size_bytes: number | null; error_code: string | null;
  created_at: string | Date;
};
type GrantRow = {
  id: string; publication_id: string; token_hash: string; expires_at: string | Date;
  revoked_at: string | Date | null; created_at: string | Date;
};
const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const publicationFromRow = (row: PublicationRow): Publication => ({
  id: row.id, workspaceId: row.workspace_id, ownerProfileId: row.owner_profile_id,
  resourceType: row.resource_type, resourceId: row.resource_id, format: row.format, status: row.status,
  title: row.title, objectKey: row.object_key, contentType: row.content_type,
  sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes), errorCode: row.error_code, createdAt: iso(row.created_at)
});
const grantFromRow = (row: GrantRow): PublicationExternalGrant => ({
  id: row.id, publicationId: row.publication_id, tokenHash: row.token_hash, expiresAt: iso(row.expires_at),
  revokedAt: row.revoked_at ? iso(row.revoked_at) : null, createdAt: iso(row.created_at)
});

export function createPostgresPublicationStore(pool: OperationalPool): PublicationStore {
  return {
    async create(input) {
      const result = await pool.query<PublicationRow>(
        `INSERT INTO publications
          (id,workspace_id,owner_profile_id,resource_type,resource_id,format,status,title,object_key,content_type,size_bytes,error_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [generatedId("publication"), input.workspaceId, input.ownerProfileId, input.resourceType, input.resourceId,
          input.format, input.status, input.title, input.objectKey, input.contentType, input.sizeBytes, input.errorCode]
      );
      return publicationFromRow(result.rows[0]!);
    },
    async find(workspaceId, id) {
      const result = await pool.query<PublicationRow>("SELECT * FROM publications WHERE workspace_id=$1 AND id=$2", [workspaceId, id]);
      return result.rows[0] ? publicationFromRow(result.rows[0]) : null;
    },
    async createGrant(input) {
      const result = await pool.query<GrantRow>(
        `INSERT INTO publication_external_grants (id,publication_id,token_hash,expires_at)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [generatedId("publication_grant"), input.publicationId, input.tokenHash, input.expiresAt]
      );
      return grantFromRow(result.rows[0]!);
    },
    async findGrantByHash(tokenHash) {
      const result = await pool.query<PublicationRow & {
        grant_id: string; grant_publication_id: string; grant_token_hash: string; grant_expires_at: string | Date;
        grant_revoked_at: string | Date | null; grant_created_at: string | Date;
      }>(`SELECT p.*,g.id AS grant_id,g.publication_id AS grant_publication_id,g.token_hash AS grant_token_hash,
              g.expires_at AS grant_expires_at,g.revoked_at AS grant_revoked_at,g.created_at AS grant_created_at
           FROM publication_external_grants g JOIN publications p ON p.id=g.publication_id WHERE g.token_hash=$1`, [tokenHash]);
      const row = result.rows[0];
      if (!row) return null;
      return { publication: publicationFromRow(row), grant: grantFromRow({
        id: row.grant_id, publication_id: row.grant_publication_id, token_hash: row.grant_token_hash,
        expires_at: row.grant_expires_at, revoked_at: row.grant_revoked_at, created_at: row.grant_created_at
      }) };
    },
    async revokeGrant(workspaceId, publicationId, grantId, revokedAt) {
      const result = await pool.query<{ id: string }>(
        `UPDATE publication_external_grants g SET revoked_at=$4 FROM publications p
         WHERE g.id=$3 AND g.publication_id=$2 AND p.id=g.publication_id AND p.workspace_id=$1 RETURNING g.id`,
        [workspaceId, publicationId, grantId, revokedAt]
      );
      return result.rows.length > 0;
    }
  };
}
