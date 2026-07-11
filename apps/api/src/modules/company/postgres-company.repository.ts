import type { Area, CompanyRepository, RoleTemplate, TeamInvite, TeamMember } from "./company.types";
import { audit, generatedId, withOperationalTransaction, iso, type OperationalPool } from "../../db/operational-repository-support";

type AreaRow = { id: string; workspace_id: string; name: string; description: string | null; sort_order: number; created_at: string | Date; updated_at: string | Date };
type RoleRow = { id: string; workspace_id: string; area_id: string; name: string; description: string | null; created_at: string | Date; updated_at: string | Date };
type PersonRow = { id: string; workspace_id: string; name: string; email: string | null; role: TeamMember["role"]; area_id: string | null; role_template_id: string | null; status: TeamMember["status"]; created_by_profile_id: string; created_at: string | Date; updated_at: string | Date };
type InviteRecordRow = { data: TeamInvite };

const areaFromRow = (row: AreaRow): Area => ({ id: row.id, workspaceId: row.workspace_id, name: row.name, description: row.description, sortOrder: row.sort_order, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) });
const roleFromRow = (row: RoleRow): RoleTemplate => ({ id: row.id, workspaceId: row.workspace_id, areaId: row.area_id, name: row.name, description: row.description, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) });
const personFromRow = (row: PersonRow): TeamMember => ({ id: row.id, workspaceId: row.workspace_id, name: row.name, email: row.email, role: row.role, areaId: row.area_id, roleTemplateId: row.role_template_id, status: row.status, createdByProfileId: row.created_by_profile_id, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) });

export function createPostgresCompanyRepository(db: OperationalPool, inviteRepository: CompanyRepository): CompanyRepository {
  return {
    async listAreas(workspaceId) {
      const result = await db.query<AreaRow>("SELECT * FROM areas WHERE workspace_id = $1 AND archived_at IS NULL ORDER BY sort_order, id", [workspaceId]);
      return result.rows.map(areaFromRow);
    },
    async findAreaById(workspaceId, areaId) {
      const result = await db.query<AreaRow>("SELECT * FROM areas WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL", [workspaceId, areaId]);
      return result.rows[0] ? areaFromRow(result.rows[0]) : null;
    },
    async createArea(input) {
      return withOperationalTransaction(db, async (client) => {
        const id = generatedId("area");
        const result = await client.query<AreaRow>(`INSERT INTO areas (id, workspace_id, name, description, sort_order)
          VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(sort_order) + 1 FROM areas WHERE workspace_id = $2), 1)) RETURNING *`, [id, input.workspaceId, input.name, input.description]);
        await audit(client, input.workspaceId, "area", id, "create");
        return areaFromRow(result.rows[0]!);
      });
    },
    async updateArea(area) {
      return withOperationalTransaction(db, async (client) => {
        const result = await client.query<AreaRow>(`UPDATE areas SET name = $3, description = $4, sort_order = $5, updated_at = NOW()
          WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL RETURNING *`, [area.workspaceId, area.id, area.name, area.description, area.sortOrder]);
        if (!result.rows[0]) throw new Error("AREA_NOT_FOUND");
        await audit(client, area.workspaceId, "area", area.id, "update");
        return areaFromRow(result.rows[0]);
      });
    },
    async deleteArea(workspaceId, areaId) {
      await withOperationalTransaction(db, async (client) => {
        await client.query("UPDATE areas SET archived_at = NOW(), updated_at = NOW() WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL", [workspaceId, areaId]);
        await audit(client, workspaceId, "area", areaId, "archive");
      });
    },
    async listRoleTemplates(workspaceId) {
      const result = await db.query<RoleRow>("SELECT * FROM role_templates WHERE workspace_id = $1 AND archived_at IS NULL ORDER BY created_at, id", [workspaceId]);
      return result.rows.map(roleFromRow);
    },
    async createRoleTemplate(input) {
      return withOperationalTransaction(db, async (client) => {
        const id = generatedId("role");
        const result = await client.query<RoleRow>(`INSERT INTO role_templates (id, workspace_id, area_id, name, description)
          VALUES ($1, $2, $3, $4, $5) RETURNING *`, [id, input.workspaceId, input.areaId, input.name, input.description]);
        await audit(client, input.workspaceId, "role_template", id, "create");
        return roleFromRow(result.rows[0]!);
      });
    },
    async deleteRoleTemplate(workspaceId, roleTemplateId) {
      await withOperationalTransaction(db, async (client) => {
        await client.query("UPDATE role_templates SET archived_at = NOW(), updated_at = NOW() WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL", [workspaceId, roleTemplateId]);
        await audit(client, workspaceId, "role_template", roleTemplateId, "archive");
      });
    },
    async listTeamMembers(workspaceId) {
      const result = await db.query<PersonRow>("SELECT * FROM people WHERE workspace_id = $1 AND archived_at IS NULL ORDER BY created_at, id", [workspaceId]);
      return result.rows.map(personFromRow);
    },
    async findTeamMember(workspaceId, personId) {
      const result = await db.query<PersonRow>("SELECT * FROM people WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL", [workspaceId, personId]);
      return result.rows[0] ? personFromRow(result.rows[0]) : null;
    },
    async createTeamMember(input) {
      return withOperationalTransaction(db, async (client) => {
        const id = generatedId("person");
        const result = await client.query<PersonRow>(`INSERT INTO people
          (id, workspace_id, name, email, role, area_id, role_template_id, status, created_by_profile_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [id, input.workspaceId, input.name, input.email, input.role, input.areaId, input.roleTemplateId, input.status ?? "active", input.createdByProfileId]);
        await audit(client, input.workspaceId, "person", id, "create", input.createdByProfileId);
        return personFromRow(result.rows[0]!);
      });
    },
    async updateTeamMember(person) {
      return withOperationalTransaction(db, async (client) => {
        const result = await client.query<PersonRow>(`UPDATE people SET name=$3,email=$4,role=$5,area_id=$6,role_template_id=$7,status=$8,updated_at=NOW()
          WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL RETURNING *`, [person.workspaceId, person.id, person.name, person.email, person.role, person.areaId, person.roleTemplateId, person.status]);
        if (!result.rows[0]) throw new Error("TEAM_MEMBER_NOT_FOUND");
        await audit(client, person.workspaceId, "person", person.id, "update", person.createdByProfileId);
        return personFromRow(result.rows[0]);
      });
    },
    async deleteTeamMember(workspaceId, personId) {
      await withOperationalTransaction(db, async (client) => {
        await client.query("UPDATE people SET status='archived', archived_at=NOW(), updated_at=NOW() WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL", [workspaceId, personId]);
        await audit(client, workspaceId, "person", personId, "archive");
      });
    },
    listTeamInvites: inviteRepository.listTeamInvites.bind(inviteRepository),
    findTeamInviteByCode: inviteRepository.findTeamInviteByCode.bind(inviteRepository),
    createTeamInvite: inviteRepository.createTeamInvite.bind(inviteRepository),
    updateTeamInvite: inviteRepository.updateTeamInvite.bind(inviteRepository),
    deleteTeamInvite: inviteRepository.deleteTeamInvite.bind(inviteRepository),
    async acceptTeamInviteAtomically(invite, member) {
      return withOperationalTransaction(db, async (client) => {
        const locked = await client.query<InviteRecordRow>(
          `SELECT data FROM baase_records
           WHERE kind='team_invite' AND workspace_id=$1 AND id=$2 FOR UPDATE`,
          [invite.workspaceId, invite.id]
        );
        const persisted = locked.rows[0]?.data;
        if (!persisted) throw new Error("INVITE_NOT_FOUND");
        if (persisted.status === "revoked") throw new Error("INVITE_NOT_FOUND");

        const personId = `person_${persisted.id}`;
        if (persisted.status === "accepted") {
          const existing = await client.query<PersonRow>(
            "SELECT * FROM people WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",
            [persisted.workspaceId, personId]
          );
          if (!existing.rows[0]) throw new Error("INVITE_ACCEPTANCE_INCOMPLETE");
          return { invite: persisted, person: personFromRow(existing.rows[0]) };
        }

        const created = await client.query<PersonRow>(`INSERT INTO people
          (id,workspace_id,name,email,role,area_id,role_template_id,status,created_by_profile_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [
          personId, member.workspaceId, member.name, member.email, member.role,
          member.areaId, member.roleTemplateId, member.status, member.createdByProfileId
        ]);
        const acceptedAt = nextTimestamp(persisted.updatedAt);
        const acceptedInvite: TeamInvite = { ...persisted, status: "accepted", updatedAt: acceptedAt };
        const updated = await client.query<{ id: string }>(
          `UPDATE baase_records SET data=$3::jsonb,updated_at=$4
           WHERE kind='team_invite' AND workspace_id=$1 AND id=$2
             AND data ->> 'updatedAt'=$5 AND data ->> 'status'='pending'
           RETURNING id`,
          [persisted.workspaceId, persisted.id, JSON.stringify(acceptedInvite), acceptedAt, persisted.updatedAt]
        );
        if (!updated.rows[0]) throw new Error("INVITE_STALE");
        await audit(client, member.workspaceId, "person", personId, "create", member.createdByProfileId);
        await audit(client, persisted.workspaceId, "team_invite", persisted.id, "accept", member.createdByProfileId);
        return { invite: acceptedInvite, person: personFromRow(created.rows[0]!) };
      });
    }
  };
}

function nextTimestamp(previous: string) {
  const now = new Date();
  return now.getTime() > new Date(previous).getTime()
    ? now.toISOString()
    : new Date(new Date(previous).getTime() + 1).toISOString();
}
