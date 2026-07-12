import type { CompanyProcess, ProcessMaterial, ProcessOwner, ProcessRepository, ProcessVersionRecord } from "./process.types";
import { audit, generatedId, lockActiveAreaReference, lockActivePersonReference, lockActiveRoleTemplateReference, lockWorkspaceOperationalMutation, withOperationalTransaction, iso, type OperationalClient, type OperationalPool } from "../../db/operational-repository-support";

type ProcessRow = { id:string; workspace_id:string; area_id:string|null; title:string; summary:string|null; status:CompanyProcess["status"]; owner_profile_id:string|null; owner_role_template_id:string|null; current_version:number; created_by_profile_id:string; published_at:string|Date|null; archived_at:string|Date|null; created_at:string|Date; updated_at:string|Date };
type VersionRow = { id:string; workspace_id:string; process_id:string; version_number:number; title:string; body:string; change_note:string; editor_profile_id:string; created_at:string|Date };
type MaterialRow = { id:string; workspace_id:string; process_id:string; kind:ProcessMaterial["kind"]; title:string; url:string|null; object_key:string|null; content_type:string|null; size_bytes:number|string|null; created_at:string|Date };
const versionFromRow = (row: VersionRow): ProcessVersionRecord => ({ id:row.id, workspaceId:row.workspace_id, processId:row.process_id, version:row.version_number, title:row.title, body:row.body, changeNote:row.change_note, editorProfileId:row.editor_profile_id, createdAt:iso(row.created_at) });
const materialFromRow = (row: MaterialRow): ProcessMaterial => ({ id:row.id, workspaceId:row.workspace_id, processId:row.process_id, kind:row.kind, title:row.title, url:row.url, objectKey:row.object_key, contentType:row.content_type, sizeBytes:row.size_bytes === null ? null : Number(row.size_bytes), createdAt:iso(row.created_at) });

async function hydrate(db: Pick<OperationalPool,"query">|Pick<OperationalClient,"query">, rows: ProcessRow[]) {
  if (!rows.length) return [];
  const workspaceId = rows[0]!.workspace_id;
  const ids = rows.map((row) => row.id);
  const result = await db.query<VersionRow>("SELECT * FROM process_versions WHERE workspace_id=$1 AND process_id = ANY($2::text[]) ORDER BY version_number", [workspaceId, ids]);
  const materialsResult = await db.query<MaterialRow>("SELECT * FROM process_materials WHERE workspace_id=$1 AND process_id = ANY($2::text[]) ORDER BY created_at,id", [workspaceId, ids]);
  const grouped = new Map<string, ProcessVersionRecord[]>();
  for (const row of result.rows) grouped.set(row.process_id, [...(grouped.get(row.process_id) ?? []), versionFromRow(row)]);
  const materialsByProcess = new Map<string, ProcessMaterial[]>();
  for (const row of materialsResult.rows) materialsByProcess.set(row.process_id, [...(materialsByProcess.get(row.process_id) ?? []), materialFromRow(row)]);
  return rows.map((row): CompanyProcess => {
    const versions = grouped.get(row.id) ?? [];
    const currentVersion = versions.find((version) => version.version === row.current_version);
    if (!currentVersion) throw new Error("PROCESS_CURRENT_VERSION_NOT_FOUND");
    const owner = ownerFromRow(row);
    return { id:row.id, workspaceId:row.workspace_id, areaId:row.area_id, title:row.title, summary:row.summary, status:row.status, ownerProfileId:row.owner_profile_id, owner, materials: materialsByProcess.get(row.id) ?? [], currentVersion, versions, createdByProfileId:row.created_by_profile_id, publishedAt:row.published_at ? iso(row.published_at) : null, archivedAt:row.archived_at ? iso(row.archived_at) : null, createdAt:iso(row.created_at), updatedAt:iso(row.updated_at) };
  });
}

function ownerFromRow(row: ProcessRow): ProcessOwner | null {
  if (row.owner_profile_id) return { type: "person", personId: row.owner_profile_id };
  if (row.owner_role_template_id) return { type: "role", roleTemplateId: row.owner_role_template_id };
  return null;
}

function ownerColumns(process: Pick<CompanyProcess, "owner" | "ownerProfileId">) {
  const owner = Object.prototype.hasOwnProperty.call(process, "owner")
    ? process.owner ?? null
    : process.ownerProfileId ? { type: "person" as const, personId: process.ownerProfileId } : null;
  return {
    ownerProfileId: owner?.type === "person" ? owner.personId : null,
    ownerRoleTemplateId: owner?.type === "role" ? owner.roleTemplateId : null
  };
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
      return withOperationalTransaction(db, async (client) => {
        await lockWorkspaceOperationalMutation(client, input.workspaceId);
        await lockActiveAreaReference(client, input.workspaceId, input.areaId);
        const owner = ownerColumns(input);
        await lockActivePersonReference(client, input.workspaceId, owner.ownerProfileId);
        await lockActiveRoleTemplateReference(client, input.workspaceId, input.areaId, owner.ownerRoleTemplateId);
        const id = generatedId("process");
        const versions = input.versions.map((version) => ({ ...version, id: `version_${id}_${version.version}`, processId:id }));
        await client.query(`INSERT INTO processes
          (id,workspace_id,area_id,title,summary,status,owner_profile_id,owner_role_template_id,current_version,created_by_profile_id,published_at,archived_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id,input.workspaceId,input.areaId,input.title,input.summary,input.status,owner.ownerProfileId,owner.ownerRoleTemplateId,input.currentVersion.version,input.createdByProfileId,input.publishedAt,input.archivedAt]);
        for (const version of versions) await insertVersion(client, version);
        await replaceMaterials(client, { ...input, id, versions, currentVersion: versions.find((version) => version.version === input.currentVersion.version)!, createdAt: "", updatedAt: "" });
        await audit(client,input.workspaceId,"process",id,"create",input.createdByProfileId);
        const rows = await client.query<ProcessRow>("SELECT * FROM processes WHERE workspace_id=$1 AND id=$2",[input.workspaceId,id]);
        return (await hydrate(client,rows.rows))[0]!;
      });
    },
    async updateProcess(process) {
      return withOperationalTransaction(db, async (client) => {
        await lockWorkspaceOperationalMutation(client, process.workspaceId);
        await lockActiveAreaReference(client, process.workspaceId, process.areaId);
        const owner = ownerColumns(process);
        await lockActivePersonReference(client, process.workspaceId, owner.ownerProfileId);
        await lockActiveRoleTemplateReference(client, process.workspaceId, process.areaId, owner.ownerRoleTemplateId);
        const parent = await client.query<ProcessRow>("SELECT * FROM processes WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE",[process.workspaceId,process.id]);
        if (!parent.rows[0]) throw new Error("PROCESS_NOT_FOUND");
        if (iso(parent.rows[0].updated_at) !== process.updatedAt) throw new Error("PROCESS_STALE");
        const persisted = await client.query<VersionRow>("SELECT * FROM process_versions WHERE workspace_id=$1 AND process_id=$2",[process.workspaceId,process.id]);
        const known = new Set(persisted.rows.map((row)=>row.version_number));
        const incomingByNumber = new Map(process.versions.map((version)=>[version.version,version]));
        for (const row of persisted.rows) {
          const incoming = incomingByNumber.get(row.version_number);
          if (incoming && (incoming.body !== row.body || incoming.title !== row.title || incoming.changeNote !== row.change_note)) throw new Error("PROCESS_VERSION_CONFLICT");
        }
        for (const version of process.versions.filter((item)=>!known.has(item.version))) await insertVersion(client,version);
        const result = await client.query<ProcessRow>(`UPDATE processes SET area_id=$3,title=$4,summary=$5,status=$6,owner_profile_id=$7,owner_role_template_id=$8,current_version=$9,published_at=$10,archived_at=$11,updated_at=GREATEST(NOW(),updated_at+INTERVAL '1 millisecond')
          WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL RETURNING *`,[process.workspaceId,process.id,process.areaId,process.title,process.summary,process.status,owner.ownerProfileId,owner.ownerRoleTemplateId,process.currentVersion.version,process.publishedAt,process.archivedAt]);
        await replaceMaterials(client, process);
        await audit(client,process.workspaceId,"process",process.id,"update",process.currentVersion.editorProfileId);
        return (await hydrate(client,result.rows))[0]!;
      });
    },
    async deleteProcess(workspaceId, processId) {
      await withOperationalTransaction(db, async (client)=>{
        await client.query("UPDATE processes SET status='archived',archived_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",[workspaceId,processId]);
        await audit(client,workspaceId,"process",processId,"archive");
      });
    },
    async listProcessMaterials(workspaceId, processId) {
      const result = await db.query<MaterialRow>("SELECT * FROM process_materials WHERE workspace_id=$1 AND process_id=$2 ORDER BY created_at,id", [workspaceId, processId]);
      return result.rows.map(materialFromRow);
    },
    async findProcessMaterial(workspaceId, processId, materialId) {
      const result = await db.query<MaterialRow>("SELECT * FROM process_materials WHERE workspace_id=$1 AND process_id=$2 AND id=$3", [workspaceId, processId, materialId]);
      return result.rows[0] ? materialFromRow(result.rows[0]) : null;
    },
    async addProcessMaterial(input) {
      return withOperationalTransaction(db, async (client) => {
        await lockWorkspaceOperationalMutation(client, input.workspaceId);
        await requireActiveProcess(client, input.workspaceId, input.processId);
        const id = generatedId("material");
        const result = await client.query<MaterialRow>(`INSERT INTO process_materials
          (id,workspace_id,process_id,kind,title,url,object_key,content_type,size_bytes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [
          id, input.workspaceId, input.processId, input.kind, input.title, input.url,
          input.objectKey, input.contentType, input.sizeBytes
        ]);
        await touchProcess(client, input.workspaceId, input.processId);
        await audit(client, input.workspaceId, "process_material", id, "create");
        return materialFromRow(result.rows[0]!);
      });
    },
    async removeProcessMaterial(workspaceId, processId, materialId) {
      return withOperationalTransaction(db, async (client) => {
        await lockWorkspaceOperationalMutation(client, workspaceId);
        await requireActiveProcess(client, workspaceId, processId);
        const result = await client.query<MaterialRow>("DELETE FROM process_materials WHERE workspace_id=$1 AND process_id=$2 AND id=$3 RETURNING *", [workspaceId, processId, materialId]);
        if (!result.rows[0]) return null;
        await touchProcess(client, workspaceId, processId);
        await audit(client, workspaceId, "process_material", materialId, "delete");
        return materialFromRow(result.rows[0]);
      });
    }
  };
}

function insertVersion(client: OperationalClient, version: ProcessVersionRecord) {
  return client.query(`INSERT INTO process_versions
    (id,workspace_id,process_id,version_number,title,body,change_note,editor_profile_id,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[version.id,version.workspaceId,version.processId,version.version,version.title,version.body,version.changeNote,version.editorProfileId,version.createdAt]);
}

async function replaceMaterials(client: OperationalClient, process: CompanyProcess) {
  await client.query("DELETE FROM process_materials WHERE workspace_id=$1 AND process_id=$2", [process.workspaceId, process.id]);
  for (const material of process.materials ?? []) {
    const id = material.id.replace("material_new_", `material_${process.id}_`);
    await client.query(`INSERT INTO process_materials
      (id,workspace_id,process_id,kind,title,url,object_key,content_type,size_bytes,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`, [
      id, process.workspaceId, process.id, material.kind, material.title, material.url,
      material.objectKey, material.contentType, material.sizeBytes, material.createdAt
    ]);
  }
}

async function requireActiveProcess(client: OperationalClient, workspaceId: string, processId: string) {
  const process = await client.query<{ id: string }>(
    "SELECT id FROM processes WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE",
    [workspaceId, processId]
  );
  if (!process.rows[0]) throw new Error("PROCESS_NOT_FOUND");
}

function touchProcess(client: OperationalClient, workspaceId: string, processId: string) {
  return client.query(
    "UPDATE processes SET updated_at=GREATEST(NOW(),updated_at+INTERVAL '1 millisecond') WHERE workspace_id=$1 AND id=$2",
    [workspaceId, processId]
  );
}
