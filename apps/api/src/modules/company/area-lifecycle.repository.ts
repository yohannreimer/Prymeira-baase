import { randomUUID } from "node:crypto";
import { audit, iso, lockWorkspaceOperationalMutation, withOperationalTransaction, type OperationalClient, type OperationalPool } from "../../db/operational-repository-support";
import type { CompanyProcess } from "../processes/process.types";
import type { CompanyRoutine } from "../routines/routine.types";
import type {
  ArchiveAreaInput,
  ArchiveAreaResult,
  Area,
  AreaImpact,
  AreaLifecycleRepository,
  RoleTemplate,
  TeamInvite,
  TeamMember
} from "./company.types";

type AreaRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string | Date;
  updated_at: string | Date;
};

const areaFromRow = (row: AreaRow): Area => ({
  id: row.id,
  workspaceId: row.workspace_id,
  name: row.name,
  description: row.description,
  sortOrder: row.sort_order,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
});

export function createRelationalAreaLifecycleRepository(db: OperationalPool): AreaLifecycleRepository {
  return {
    async getImpact(workspaceId, areaId) {
      const area = await db.query<AreaRow>(
        "SELECT * FROM areas WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",
        [workspaceId, areaId]
      );
      if (!area.rows[0]) return null;
      return readRelationalImpact(db, areaFromRow(area.rows[0]));
    },

    archive(command) {
      return withOperationalTransaction(db, async (client) => {
        await lockWorkspaceOperationalMutation(client, command.workspaceId);
        const source = await client.query<AreaRow>(
          "SELECT * FROM areas WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE",
          [command.workspaceId, command.areaId]
        );
        if (!source.rows[0]) throw new Error("AREA_NOT_FOUND");
        await lockTarget(client, command.workspaceId, command.areaId, command.resolution);

        const area = areaFromRow(source.rows[0]);
        const impact = await readRelationalImpact(client, area, true);
        if (!command.resolution && hasLinks(impact)) throw new Error("AREA_ARCHIVE_RESOLUTION_REQUIRED");

        const result = await mutateRelational(client, impact, command.resolution);
        const archived = await client.query<{ id: string }>(
          `UPDATE areas SET archived_at=NOW(),updated_at=NOW()
           WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL RETURNING id`,
          [command.workspaceId, command.areaId]
        );
        if (!archived.rows[0]) throw new Error("AREA_NOT_FOUND");
        await audit(client, command.workspaceId, "area", command.areaId, "archive", command.actorProfileId, {
          strategy: command.resolution?.strategy ?? "no_impact",
          targetAreaId: command.resolution?.strategy === "reassign" ? command.resolution.targetAreaId : null,
          reassigned: result.reassigned,
          unassigned: result.unassigned,
          archived: result.archived
        });
        return result;
      });
    }
  };
}

async function lockTarget(
  client: OperationalClient,
  workspaceId: string,
  sourceAreaId: string,
  resolution?: ArchiveAreaInput
) {
  if (resolution?.strategy !== "reassign") return;
  if (resolution.targetAreaId === sourceAreaId) throw new Error("AREA_ARCHIVE_TARGET_SAME");
  const target = await client.query<{ id: string }>(
    "SELECT id FROM areas WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE",
    [workspaceId, resolution.targetAreaId]
  );
  if (!target.rows[0]) throw new Error("AREA_ARCHIVE_TARGET_NOT_FOUND");
}

async function readRelationalImpact(
  db: Pick<OperationalPool, "query">,
  area: Area,
  lockPendingInvites = false
): Promise<AreaImpact> {
  const roles = await db.query<{ id: string; name: string }>(
    "SELECT id,name FROM role_templates WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL ORDER BY created_at,id",
    [area.workspaceId, area.id]
  );
  const processes = await db.query<{ id: string; title: string }>(
    `SELECT DISTINCT p.id,p.title FROM processes p
     WHERE p.workspace_id=$1 AND p.archived_at IS NULL AND p.status<>'archived'
       AND (p.area_id=$2 OR p.owner_role_template_id IN
         (SELECT id FROM role_templates WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL))
     ORDER BY p.id`,
    [area.workspaceId, area.id]
  );
  const routines = await db.query<{ id: string; title: string }>(
    `SELECT DISTINCT r.id,r.title FROM routines r
     WHERE r.workspace_id=$1 AND r.archived_at IS NULL AND r.status<>'archived'
       AND (r.area_id=$2 OR EXISTS (
         SELECT 1 FROM routine_assignments ra JOIN role_templates rt
           ON rt.workspace_id=ra.workspace_id AND rt.id=ra.role_template_id
         WHERE ra.workspace_id=r.workspace_id AND ra.routine_id=r.id
           AND rt.area_id=$2 AND rt.archived_at IS NULL))
     ORDER BY r.id`,
    [area.workspaceId, area.id]
  );
  const people = await db.query<{ id: string; name: string }>(
    `SELECT DISTINCT p.id,p.name FROM people p
     WHERE p.workspace_id=$1 AND p.archived_at IS NULL AND p.status<>'archived'
       AND (p.area_id=$2 OR p.role_template_id IN
         (SELECT id FROM role_templates WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL))
     ORDER BY p.id`,
    [area.workspaceId, area.id]
  );
  const pendingInvites = await db.query<{ data: TeamInvite }>(
    `SELECT data FROM baase_records
     WHERE kind='team_invite' AND workspace_id=$1 AND data->>'status'='pending'
       AND (data->>'areaId'=$2 OR data->>'roleTemplateId' IN
         (SELECT id FROM role_templates WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL))
     ORDER BY id${lockPendingInvites ? " FOR UPDATE" : ""}`,
    [area.workspaceId, area.id]
  );
  return {
    area,
    processes: processes.rows,
    routines: routines.rows,
    roleTemplates: roles.rows,
    people: people.rows,
    pendingInvites: pendingInvites.rows.map(({ data }) => ({ id: data.id, name: data.name, email: data.email }))
  };
}

async function mutateRelational(
  client: OperationalClient,
  impact: AreaImpact,
  resolution?: ArchiveAreaInput
): Promise<ArchiveAreaResult> {
  const workspaceId = impact.area.workspaceId;
  const areaId = impact.area.id;
  if (resolution?.strategy === "reassign") {
    const target = resolution.targetAreaId;
    await client.query(
      "UPDATE processes SET area_id=$3,updated_at=NOW() WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL AND status<>'archived'",
      [workspaceId, areaId, target]
    );
    await client.query(
      "UPDATE routines SET area_id=$3,updated_at=NOW() WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL AND status<>'archived'",
      [workspaceId, areaId, target]
    );
    await client.query(
      "UPDATE role_templates SET area_id=$3,updated_at=NOW() WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL",
      [workspaceId, areaId, target]
    );
    await client.query(
      "UPDATE people SET area_id=$3,updated_at=NOW() WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL AND status<>'archived'",
      [workspaceId, areaId, target]
    );
    await client.query(
      `UPDATE baase_records SET
         data=jsonb_set(jsonb_set(data,'{areaId}',to_jsonb($3::text),true),'{updatedAt}',to_jsonb(NOW()::text),true),
         updated_at=NOW()
       WHERE kind='team_invite' AND workspace_id=$1 AND data->>'status'='pending' AND data->>'areaId'=$2`,
      [workspaceId, areaId, target]
    );
    return {
      area: impact.area,
      reassigned: {
        processes: impact.processes.length,
        routines: impact.routines.length,
        roleTemplates: impact.roleTemplates.length,
        people: impact.people.length,
        pendingInvites: impact.pendingInvites.length
      },
      unassigned: { processes: 0, routines: 0, people: 0, pendingInvites: 0 },
      archived: { areas: 1, roleTemplates: 0 }
    };
  }

  await client.query(
    "UPDATE processes SET area_id=NULL,updated_at=NOW() WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL AND status<>'archived'",
    [workspaceId, areaId]
  );
  await client.query(
    `UPDATE baase_records SET
       data=data || jsonb_build_object(
         'areaId',CASE WHEN data->>'areaId'=$2 THEN 'null'::jsonb ELSE data->'areaId' END,
         'roleTemplateId',CASE WHEN data->>'roleTemplateId' IN
           (SELECT id FROM role_templates WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL)
           THEN 'null'::jsonb ELSE data->'roleTemplateId' END,
         'accessScope','workspace','updatedAt',NOW()::text
       ),updated_at=NOW()
     WHERE kind='team_invite' AND workspace_id=$1 AND data->>'status'='pending'
       AND (data->>'areaId'=$2 OR data->>'roleTemplateId' IN
         (SELECT id FROM role_templates WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL))`,
    [workspaceId, areaId]
  );
  await client.query(
    `UPDATE processes SET owner_role_template_id=NULL,updated_at=NOW()
     WHERE workspace_id=$1 AND archived_at IS NULL AND status<>'archived' AND owner_role_template_id IN
       (SELECT id FROM role_templates WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL)`,
    [workspaceId, areaId]
  );
  await client.query(
    "UPDATE routines SET area_id=NULL,updated_at=NOW() WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL AND status<>'archived'",
    [workspaceId, areaId]
  );
  await client.query(
    `DELETE FROM routine_assignments WHERE workspace_id=$1 AND role_template_id IN
       (SELECT id FROM role_templates WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL)`,
    [workspaceId, areaId]
  );
  await client.query(
    `UPDATE people SET
       area_id=CASE WHEN area_id=$2 THEN NULL ELSE area_id END,
       role_template_id=CASE WHEN role_template_id IN
         (SELECT id FROM role_templates WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL)
         THEN NULL ELSE role_template_id END,
       updated_at=NOW()
     WHERE workspace_id=$1 AND archived_at IS NULL AND status<>'archived'
       AND (area_id=$2 OR role_template_id IN
         (SELECT id FROM role_templates WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL))`,
    [workspaceId, areaId]
  );
  await client.query(
    "UPDATE role_templates SET archived_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND area_id=$2 AND archived_at IS NULL",
    [workspaceId, areaId]
  );
  return {
    area: impact.area,
    reassigned: { processes: 0, routines: 0, roleTemplates: 0, people: 0, pendingInvites: 0 },
    unassigned: {
      processes: impact.processes.length,
      routines: impact.routines.length,
      people: impact.people.length,
      pendingInvites: impact.pendingInvites.length
    },
    archived: { areas: 1, roleTemplates: impact.roleTemplates.length }
  };
}

type JsonbRecord = { kind: string; id: string; data: unknown };

export function createJsonbAreaLifecycleRepository(db: OperationalPool): AreaLifecycleRepository {
  return {
    async getImpact(workspaceId, areaId) {
      const records = await readJsonbRecords(db, workspaceId);
      return jsonbImpact(records, workspaceId, areaId);
    },
    archive(command) {
      return withOperationalTransaction(db, async (client) => {
        await lockWorkspaceOperationalMutation(client, command.workspaceId);
        const records = await readJsonbRecords(client, command.workspaceId, true);
        const impact = jsonbImpact(records, command.workspaceId, command.areaId);
        if (!impact) throw new Error("AREA_NOT_FOUND");
        if (command.resolution?.strategy === "reassign") {
          if (command.resolution.targetAreaId === command.areaId) throw new Error("AREA_ARCHIVE_TARGET_SAME");
          const target = jsonbImpact(records, command.workspaceId, command.resolution.targetAreaId);
          if (!target) throw new Error("AREA_ARCHIVE_TARGET_NOT_FOUND");
        }
        if (!command.resolution && hasLinks(impact)) throw new Error("AREA_ARCHIVE_RESOLUTION_REQUIRED");
        const result = await mutateJsonb(client, records, impact, command.resolution);
        const archivedAt = new Date().toISOString();
        const archivedArea = { ...impact.area, archivedAt, updatedAt: archivedAt };
        await client.query(
          `UPDATE baase_records SET data=$3::jsonb,updated_at=NOW()
           WHERE kind='area' AND workspace_id=$1 AND id=$2 AND COALESCE(data->>'archivedAt','')=''`,
          [command.workspaceId, command.areaId, JSON.stringify(archivedArea)]
        );
        const timestamp = new Date().toISOString();
        const auditRecord = {
          id: `audit_${randomUUID()}`,
          workspaceId: command.workspaceId,
          entityType: "area",
          entityId: command.areaId,
          action: "archive",
          actorProfileId: command.actorProfileId,
          details: { strategy: command.resolution?.strategy ?? "no_impact", result },
          createdAt: timestamp,
          updatedAt: timestamp
        };
        await client.query(
          `INSERT INTO baase_records (kind,workspace_id,id,data,created_at,updated_at)
           VALUES ('operational_audit',$1,$2,$3::jsonb,$4,$4)`,
          [command.workspaceId, auditRecord.id, JSON.stringify(auditRecord), timestamp]
        );
        return result;
      });
    }
  };
}

async function readJsonbRecords(db: Pick<OperationalPool, "query">, workspaceId: string, lock = false) {
  const result = await db.query<JsonbRecord>(
    `SELECT kind,id,data FROM baase_records
     WHERE workspace_id=$1 AND kind=ANY($2::text[]) ORDER BY kind,id${lock ? " FOR UPDATE" : ""}`,
    [workspaceId, ["area", "role_template", "team_member", "team_invite", "process", "routine"]]
  );
  return result.rows;
}

function jsonbImpact(records: JsonbRecord[], workspaceId: string, areaId: string): AreaImpact | null {
  const area = records.find((record) => record.kind === "area" && record.id === areaId)?.data as Area | undefined;
  if (!area || area.workspaceId !== workspaceId || area.archivedAt) return null;
  const roles = records.filter((record) => record.kind === "role_template")
    .map((record) => record.data as RoleTemplate).filter((role) => role.areaId === areaId && !role.archivedAt);
  const roleIds = new Set(roles.map((role) => role.id));
  return {
    area,
    processes: records.filter((record) => record.kind === "process").map((record) => record.data as CompanyProcess)
      .filter((process) => process.status !== "archived" && process.areaId === areaId).map(({ id, title }) => ({ id, title })),
    routines: records.filter((record) => record.kind === "routine").map((record) => record.data as CompanyRoutine)
      .filter((routine) => routine.status === "active" && routine.areaId === areaId).map(({ id, title }) => ({ id, title })),
    roleTemplates: roles.map(({ id, name }) => ({ id, name })),
    people: records.filter((record) => record.kind === "team_member").map((record) => record.data as TeamMember)
      .filter((person) => person.areaId === areaId || Boolean(person.roleTemplateId && roleIds.has(person.roleTemplateId)))
      .map(({ id, name }) => ({ id, name })),
    pendingInvites: records.filter((record) => record.kind === "team_invite").map((record) => record.data as TeamInvite)
      .filter((invite) => invite.status === "pending" && (invite.areaId === areaId || Boolean(invite.roleTemplateId && roleIds.has(invite.roleTemplateId))))
      .map(({ id, name, email }) => ({ id, name, email }))
  };
}

async function mutateJsonb(
  client: OperationalClient,
  records: JsonbRecord[],
  impact: AreaImpact,
  resolution?: ArchiveAreaInput
): Promise<ArchiveAreaResult> {
  const roleIds = new Set(impact.roleTemplates.map((role) => role.id));
  const targetAreaId = resolution?.strategy === "reassign" ? resolution.targetAreaId : null;
  for (const record of records) {
    let changed = false;
    if (record.kind === "process") {
      const process = record.data as CompanyProcess;
      if (process.status !== "archived" && process.areaId === impact.area.id) { process.areaId = targetAreaId; changed = true; }
    } else if (record.kind === "routine") {
      const routine = record.data as CompanyRoutine;
      if (routine.status === "active" && routine.areaId === impact.area.id) { routine.areaId = targetAreaId; changed = true; }
    } else if (record.kind === "role_template") {
      const role = record.data as RoleTemplate;
      if (roleIds.has(role.id) && resolution?.strategy === "reassign") { role.areaId = resolution.targetAreaId; changed = true; }
      if (roleIds.has(role.id) && resolution?.strategy !== "reassign") {
        role.archivedAt = new Date().toISOString();
        changed = true;
      }
    } else if (record.kind === "team_member") {
      const person = record.data as TeamMember;
      if (person.areaId === impact.area.id) { person.areaId = targetAreaId; changed = true; }
      if (resolution?.strategy !== "reassign" && person.roleTemplateId && roleIds.has(person.roleTemplateId)) {
        person.roleTemplateId = null; changed = true;
      }
    } else if (record.kind === "team_invite") {
      const invite = record.data as TeamInvite;
      if (invite.status !== "pending") continue;
      if (invite.areaId === impact.area.id) { invite.areaId = targetAreaId; changed = true; }
      if (resolution?.strategy !== "reassign" && invite.roleTemplateId && roleIds.has(invite.roleTemplateId)) {
        invite.roleTemplateId = null; changed = true;
      }
      if (changed && resolution?.strategy !== "reassign" && invite.accessScope !== "workspace") invite.accessScope = "workspace";
    }
    if (changed) {
      const data = record.data as { updatedAt?: string };
      data.updatedAt = new Date().toISOString();
      await client.query(
        "UPDATE baase_records SET data=$4::jsonb,updated_at=$5 WHERE kind=$1 AND workspace_id=$2 AND id=$3",
        [record.kind, impact.area.workspaceId, record.id, JSON.stringify(record.data), data.updatedAt]
      );
    }
  }
  const reassign = resolution?.strategy === "reassign";
  return {
    area: impact.area,
    reassigned: reassign ? {
      processes: impact.processes.length, routines: impact.routines.length, roleTemplates: impact.roleTemplates.length,
      people: impact.people.length, pendingInvites: impact.pendingInvites.length
    } : { processes: 0, routines: 0, roleTemplates: 0, people: 0, pendingInvites: 0 },
    unassigned: reassign ? { processes: 0, routines: 0, people: 0, pendingInvites: 0 } : {
      processes: impact.processes.length, routines: impact.routines.length, people: impact.people.length,
      pendingInvites: impact.pendingInvites.length
    },
    archived: { areas: 1, roleTemplates: reassign ? 0 : impact.roleTemplates.length }
  };
}

function hasLinks(impact: AreaImpact) {
  return impact.processes.length + impact.routines.length + impact.roleTemplates.length
    + impact.people.length + impact.pendingInvites.length > 0;
}
