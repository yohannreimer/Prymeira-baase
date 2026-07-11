import type { CompanyProcess, ProcessRepository, ProcessVersionRecord } from "./process.types";
import { audit, generatedId, inTransaction, iso, type OperationalClient, type OperationalPool } from "../../db/operational-repository-support";

type ProcessRow = { id:string; workspace_id:string; area_id:string|null; title:string; summary:string|null; status:CompanyProcess["status"]; owner_profile_id:string|null; current_version:number; created_by_profile_id:string; published_at:string|Date|null; archived_at:string|Date|null; created_at:string|Date; updated_at:string|Date };
type VersionRow = { id:string; workspace_id:string; process_id:string; version_number:number; title:string; body:string; change_note:string; editor_profile_id:string; created_at:string|Date };
const versionFromRow = (row: VersionRow): ProcessVersionRecord => ({ id:row.id, workspaceId:row.workspace_id, processId:row.process_id, version:row.version_number, title:row.title, body:row.body, changeNote:row.change_note, editorProfileId:row.editor_profile_id, createdAt:iso(row.created_at) });

async function hydrate(db: Pick<OperationalPool,"query">|Pick<OperationalClient,"query">, rows: ProcessRow[]) {
  if (!rows.length) return [];
  const workspaceId = rows[0]!.workspace_id;
  const ids = rows.map((row) => row.id);
  const result = await db.query<VersionRow>("SELECT * FROM process_versions WHERE workspace_id=$1 AND process_id = ANY($2::text[]) ORDER BY version_number", [workspaceId, ids]);
  const grouped = new Map<string, ProcessVersionRecord[]>();
  for (const row of result.rows) grouped.set(row.process_id, [...(grouped.get(row.process_id) ?? []), versionFromRow(row)]);
  return rows.map((row): CompanyProcess => {
    const versions = grouped.get(row.id) ?? [];
    const currentVersion = versions.find((version) => version.version === row.current_version);
    if (!currentVersion) throw new Error("PROCESS_CURRENT_VERSION_NOT_FOUND");
    return { id:row.id, workspaceId:row.workspace_id, areaId:row.area_id, title:row.title, summary:row.summary, status:row.status, ownerProfileId:row.owner_profile_id, currentVersion, versions, createdByProfileId:row.created_by_profile_id, publishedAt:row.published_at ? iso(row.published_at) : null, archivedAt:row.archived_at ? iso(row.archived_at) : null, createdAt:iso(row.created_at), updatedAt:iso(row.updated_at) };
  });
}

export function createPostgresProcessRepository(db: OperationalPool): ProcessRepository {
  return {
    async listProcesses(workspaceId) {
      const result = await db.query<ProcessRow>("SELECT * FROM processes WHERE workspace_id=$1 AND archived_at IS NULL ORDER BY created_at,id", [workspaceId]);
      return hydrate(db, result.rows);
    },
    async findProcess(workspaceId, processId) {
      const result = await db.query<ProcessRow>("SELECT * FROM processes WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL", [workspaceId, processId]);
      return (await hydrate(db, result.rows))[0] ?? null;
    },
    async createProcess(input) {
      return inTransaction(db, async (client) => {
        const id = generatedId("process");
        const versions = input.versions.map((version) => ({ ...version, id: `version_${id}_${version.version}`, processId:id }));
        await client.query(`INSERT INTO processes
          (id,workspace_id,area_id,title,summary,status,owner_profile_id,current_version,created_by_profile_id,published_at,archived_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id,input.workspaceId,input.areaId,input.title,input.summary,input.status,input.ownerProfileId,input.currentVersion.version,input.createdByProfileId,input.publishedAt,input.archivedAt]);
        for (const version of versions) await insertVersion(client, version);
        await audit(client,input.workspaceId,"process",id,"create",input.createdByProfileId);
        const rows = await client.query<ProcessRow>("SELECT * FROM processes WHERE workspace_id=$1 AND id=$2",[input.workspaceId,id]);
        return (await hydrate(client,rows.rows))[0]!;
      });
    },
    async updateProcess(process) {
      return inTransaction(db, async (client) => {
        const persisted = await client.query<VersionRow>("SELECT * FROM process_versions WHERE workspace_id=$1 AND process_id=$2",[process.workspaceId,process.id]);
        const known = new Set(persisted.rows.map((row)=>row.version_number));
        const incomingByNumber = new Map(process.versions.map((version)=>[version.version,version]));
        for (const row of persisted.rows) {
          const incoming = incomingByNumber.get(row.version_number);
          if (incoming && (incoming.body !== row.body || incoming.title !== row.title || incoming.changeNote !== row.change_note)) throw new Error("PROCESS_VERSION_CONFLICT");
        }
        for (const version of process.versions.filter((item)=>!known.has(item.version))) await insertVersion(client,version);
        const result = await client.query<ProcessRow>(`UPDATE processes SET area_id=$3,title=$4,summary=$5,status=$6,owner_profile_id=$7,current_version=$8,published_at=$9,archived_at=$10,updated_at=NOW()
          WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL RETURNING *`,[process.workspaceId,process.id,process.areaId,process.title,process.summary,process.status,process.ownerProfileId,process.currentVersion.version,process.publishedAt,process.archivedAt]);
        if (!result.rows[0]) throw new Error("PROCESS_NOT_FOUND");
        await audit(client,process.workspaceId,"process",process.id,"update",process.currentVersion.editorProfileId);
        return (await hydrate(client,result.rows))[0]!;
      });
    },
    async deleteProcess(workspaceId, processId) {
      await inTransaction(db, async (client)=>{
        await client.query("UPDATE processes SET status='archived',archived_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",[workspaceId,processId]);
        await audit(client,workspaceId,"process",processId,"archive");
      });
    }
  };
}

function insertVersion(client: OperationalClient, version: ProcessVersionRecord) {
  return client.query(`INSERT INTO process_versions
    (id,workspace_id,process_id,version_number,title,body,change_note,editor_profile_id,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[version.id,version.workspaceId,version.processId,version.version,version.title,version.body,version.changeNote,version.editorProfileId,version.createdAt]);
}
