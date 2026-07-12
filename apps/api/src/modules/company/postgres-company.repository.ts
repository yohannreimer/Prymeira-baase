import { randomUUID } from "node:crypto";
import { normalizeAccessScope, normalizeAreaAccessIds, type Area, type CompanyRepository, type RoleTemplate, type TeamInvite, type TeamMember } from "./company.types";
import { audit, generatedId, lockActiveAreaReference, lockActiveRoleTemplateReference, lockWorkspaceOperationalMutation, withOperationalTransaction, iso, type OperationalPool } from "../../db/operational-repository-support";

type AreaRow = { id: string; workspace_id: string; name: string; description: string | null; sort_order: number; created_at: string | Date; updated_at: string | Date };
type RoleRow = { id: string; workspace_id: string; area_id: string; name: string; description: string | null; created_at: string | Date; updated_at: string | Date };
type PersonRow = { id: string; workspace_id: string; name: string; email: string | null; role: TeamMember["role"]; area_id: string | null; role_template_id: string | null; access_scope: TeamMember["accessScope"]; clerk_user_id: string | null; customer_id: string | null; area_access_ids: string[] | null; status: TeamMember["status"]; created_by_profile_id: string; created_at: string | Date; updated_at: string | Date };
type InviteRecordRow = { data: TeamInvite };

const areaFromRow = (row: AreaRow): Area => ({ id: row.id, workspaceId: row.workspace_id, name: row.name, description: row.description, sortOrder: row.sort_order, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) });
const roleFromRow = (row: RoleRow): RoleTemplate => ({ id: row.id, workspaceId: row.workspace_id, areaId: row.area_id, name: row.name, description: row.description, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) });
const personFromRow = (row: PersonRow): TeamMember => ({ id: row.id, workspaceId: row.workspace_id, name: row.name, email: row.email, role: row.role, areaId: row.area_id, areaAccessIds: normalizeAreaAccessIds(row.area_id, row.area_access_ids), roleTemplateId: row.role_template_id, accessScope: normalizeAccessScope(row.role, row.access_scope), clerkUserId: row.clerk_user_id, customerId: row.customer_id, status: row.status, createdByProfileId: row.created_by_profile_id, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) });

const personSelect = `SELECT p.*, COALESCE(ARRAY(SELECT paa.area_id FROM person_area_access paa WHERE paa.workspace_id=p.workspace_id AND paa.person_id=p.id ORDER BY paa.area_id), ARRAY[]::TEXT[]) AS area_access_ids FROM people p`;

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
        await lockWorkspaceOperationalMutation(client, input.workspaceId);
        const id = generatedId("area");
        const result = await client.query<AreaRow>(`INSERT INTO areas (id, workspace_id, name, description, sort_order)
          VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(sort_order) + 1 FROM areas WHERE workspace_id = $2), 1)) RETURNING *`, [id, input.workspaceId, input.name, input.description]);
        await audit(client, input.workspaceId, "area", id, "create");
        return areaFromRow(result.rows[0]!);
      });
    },
    async updateArea(area) {
      return withOperationalTransaction(db, async (client) => {
        await lockWorkspaceOperationalMutation(client, area.workspaceId);
        const result = await client.query<AreaRow>(`UPDATE areas SET name = $3, description = $4, sort_order = $5, updated_at = NOW()
          WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL RETURNING *`, [area.workspaceId, area.id, area.name, area.description, area.sortOrder]);
        if (!result.rows[0]) throw new Error("AREA_NOT_FOUND");
        await audit(client, area.workspaceId, "area", area.id, "update");
        return areaFromRow(result.rows[0]);
      });
    },
    async deleteArea(workspaceId, areaId) {
      await withOperationalTransaction(db, async (client) => {
        await lockWorkspaceOperationalMutation(client, workspaceId);
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
        await lockWorkspaceOperationalMutation(client, input.workspaceId);
        await lockActiveAreaReference(client, input.workspaceId, input.areaId);
        const id = generatedId("role");
        const result = await client.query<RoleRow>(`INSERT INTO role_templates (id, workspace_id, area_id, name, description)
          VALUES ($1, $2, $3, $4, $5) RETURNING *`, [id, input.workspaceId, input.areaId, input.name, input.description]);
        await audit(client, input.workspaceId, "role_template", id, "create");
        return roleFromRow(result.rows[0]!);
      });
    },
    async deleteRoleTemplate(workspaceId, roleTemplateId) {
      await withOperationalTransaction(db, async (client) => {
        await lockWorkspaceOperationalMutation(client, workspaceId);
        await client.query("UPDATE role_templates SET archived_at = NOW(), updated_at = NOW() WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL", [workspaceId, roleTemplateId]);
        await audit(client, workspaceId, "role_template", roleTemplateId, "archive");
      });
    },
    async listTeamMembers(workspaceId) {
      const result = await db.query<PersonRow>(`${personSelect} WHERE p.workspace_id = $1 AND p.archived_at IS NULL ORDER BY p.created_at, p.id`, [workspaceId]);
      return result.rows.map(personFromRow);
    },
    async findTeamMember(workspaceId, personId) {
      const result = await db.query<PersonRow>(`${personSelect} WHERE p.workspace_id = $1 AND p.id = $2 AND p.archived_at IS NULL`, [workspaceId, personId]);
      return result.rows[0] ? personFromRow(result.rows[0]) : null;
    },
    async findTeamMemberByClerkUserId(workspaceId, clerkUserId) {
      const result = await db.query<PersonRow>(`${personSelect} WHERE p.workspace_id=$1 AND p.clerk_user_id=$2 AND p.archived_at IS NULL`, [workspaceId, clerkUserId]);
      return result.rows[0] ? personFromRow(result.rows[0]) : null;
    },
    async findTeamMemberByCustomerId(workspaceId, customerId) {
      const result = await db.query<PersonRow>(`${personSelect} WHERE p.workspace_id=$1 AND p.customer_id=$2 AND p.archived_at IS NULL`, [workspaceId, customerId]);
      return result.rows[0] ? personFromRow(result.rows[0]) : null;
    },
    async findUnlinkedTeamMembersByEmail(workspaceId, email) {
      const result = await db.query<PersonRow>(`${personSelect} WHERE p.workspace_id=$1 AND lower(p.email)=lower($2) AND p.clerk_user_id IS NULL AND p.customer_id IS NULL AND p.archived_at IS NULL`, [workspaceId, email]);
      return result.rows.map(personFromRow);
    },
    async hasLinkedOwner(workspaceId) {
      const result = await db.query<{ id: string }>("SELECT id FROM people WHERE workspace_id=$1 AND role='owner' AND status='active' AND clerk_user_id IS NOT NULL AND archived_at IS NULL LIMIT 1", [workspaceId]);
      return Boolean(result.rows[0]);
    },
    async createTeamMember(input) {
      return withOperationalTransaction(db, async (client) => {
        await lockWorkspaceOperationalMutation(client, input.workspaceId);
        await lockActiveAreaReference(client, input.workspaceId, input.areaId);
        await lockActiveRoleTemplateReference(client, input.workspaceId, input.areaId, input.roleTemplateId);
        await lockAreaAccess(client, input.workspaceId, input.areaAccessIds ?? []);
        const id = generatedId("person");
        const result = await client.query<PersonRow>(`INSERT INTO people
          (id, workspace_id, name, email, role, area_id, role_template_id, access_scope, clerk_user_id, customer_id, status, created_by_profile_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [id, input.workspaceId, input.name, input.email, input.role, input.areaId, input.roleTemplateId, normalizeAccessScope(input.role, input.accessScope), input.clerkUserId ?? null, input.customerId ?? null, input.status ?? "active", input.createdByProfileId]);
        await replaceAreaAccess(client, input.workspaceId, id, normalizeAreaAccessIds(input.areaId, input.areaAccessIds));
        await audit(client, input.workspaceId, "person", id, "create", input.createdByProfileId);
        return readPerson(client, input.workspaceId, id, result.rows[0]!);
      });
    },
    async updateTeamMember(person) {
      return withOperationalTransaction(db, async (client) => {
        await lockWorkspaceOperationalMutation(client, person.workspaceId);
        await lockActiveAreaReference(client, person.workspaceId, person.areaId);
        await lockActiveRoleTemplateReference(client, person.workspaceId, person.areaId, person.roleTemplateId);
        await lockAreaAccess(client, person.workspaceId, person.areaAccessIds);
        const result = await client.query<PersonRow>(`UPDATE people SET name=$3,email=$4,role=$5,area_id=$6,role_template_id=$7,access_scope=$8,clerk_user_id=$9,customer_id=$10,status=$11,updated_at=NOW()
          WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL RETURNING *`, [person.workspaceId, person.id, person.name, person.email, person.role, person.areaId, person.roleTemplateId, normalizeAccessScope(person.role, person.accessScope), person.clerkUserId, person.customerId, person.status]);
        if (!result.rows[0]) throw new Error("TEAM_MEMBER_NOT_FOUND");
        await replaceAreaAccess(client, person.workspaceId, person.id, normalizeAreaAccessIds(person.areaId, person.areaAccessIds));
        await audit(client, person.workspaceId, "person", person.id, "update", person.createdByProfileId);
        return readPerson(client, person.workspaceId, person.id, result.rows[0]);
      });
    },
    async deleteTeamMember(workspaceId, personId) {
      await withOperationalTransaction(db, async (client) => {
        await lockWorkspaceOperationalMutation(client, workspaceId);
        await client.query("UPDATE people SET status='archived', archived_at=NOW(), updated_at=NOW() WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL", [workspaceId, personId]);
        await audit(client, workspaceId, "person", personId, "archive");
      });
    },
    listTeamInvites: inviteRepository.listTeamInvites.bind(inviteRepository),
    findTeamInviteByCode: inviteRepository.findTeamInviteByCode.bind(inviteRepository),
    async createTeamInvite(input) {
      return withOperationalTransaction(db, async (client) => {
        await lockWorkspaceOperationalMutation(client, input.workspaceId);
        await lockActiveAreaReference(client, input.workspaceId, input.areaId);
        await lockActiveRoleTemplateReference(client, input.workspaceId, input.areaId, input.roleTemplateId);
        const timestamp = new Date().toISOString();
        const invite: TeamInvite = {
          ...input,
          id: `invite_${randomUUID()}`,
          code: `BAASE-${randomUUID().replaceAll("-", "").toUpperCase()}`,
          status: "pending",
          createdAt: timestamp,
          updatedAt: timestamp
        };
        await client.query(
          `INSERT INTO baase_records (kind,workspace_id,id,data,created_at,updated_at)
           VALUES ('team_invite',$1,$2,$3::jsonb,$4,$4)`,
          [invite.workspaceId, invite.id, JSON.stringify(invite), timestamp]
        );
        await audit(client, invite.workspaceId, "team_invite", invite.id, "create", invite.createdByProfileId);
        return invite;
      });
    },
    updateTeamInvite: inviteRepository.updateTeamInvite.bind(inviteRepository),
    deleteTeamInvite: inviteRepository.deleteTeamInvite.bind(inviteRepository),
    async acceptTeamInviteAtomically(invite, member) {
      return withOperationalTransaction(db, async (client) => {
        await lockWorkspaceOperationalMutation(client, invite.workspaceId);
        const locked = await client.query<InviteRecordRow>(
          `SELECT data FROM baase_records
           WHERE kind='team_invite' AND workspace_id=$1 AND id=$2 FOR UPDATE`,
          [invite.workspaceId, invite.id]
        );
        const persisted = locked.rows[0]?.data;
        if (!persisted) throw new Error("INVITE_NOT_FOUND");
        if (persisted.status === "revoked") throw new Error("INVITE_NOT_FOUND");

        const personId = persisted.personId ?? `person_${persisted.id}`;
        if (persisted.status === "accepted") {
          const existing = await client.query<PersonRow>(
            "SELECT * FROM people WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",
            [persisted.workspaceId, personId]
          );
          if (!existing.rows[0]) throw new Error("INVITE_ACCEPTANCE_INCOMPLETE");
          return { invite: persisted, person: personFromRow(existing.rows[0]) };
        }
        if (persisted.updatedAt !== invite.updatedAt) throw new Error("INVITE_STALE");

        if (persisted.areaId) {
          const area = await client.query<{ id: string }>(
            "SELECT id FROM areas WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",
            [persisted.workspaceId, persisted.areaId]
          );
          if (!area.rows[0]) throw new Error("INVITE_STALE");
        }
        if (persisted.roleTemplateId) {
          const role = await client.query<{ area_id: string }>(
            "SELECT area_id FROM role_templates WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",
            [persisted.workspaceId, persisted.roleTemplateId]
          );
          if (!role.rows[0] || (persisted.areaId && role.rows[0].area_id !== persisted.areaId)) {
            throw new Error("INVITE_STALE");
          }
        }

        const created = await client.query<PersonRow>(`INSERT INTO people
          (id,workspace_id,name,email,role,area_id,role_template_id,access_scope,clerk_user_id,customer_id,status,created_by_profile_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [
          personId, persisted.workspaceId, member.name, member.email, persisted.role,
          persisted.areaId, persisted.roleTemplateId, normalizeAccessScope(persisted.role, persisted.accessScope),
          member.clerkUserId, member.customerId, member.status, member.createdByProfileId
        ]);
        await replaceAreaAccess(client, persisted.workspaceId, personId, normalizeAreaAccessIds(persisted.areaId, persisted.areaAccessIds));
        const acceptedAt = nextTimestamp(persisted.updatedAt);
        const acceptedInvite: TeamInvite = { ...persisted, status: "accepted", personId, acceptedAt, updatedAt: acceptedAt };
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
        return { invite: acceptedInvite, person: await readPerson(client, persisted.workspaceId, personId, created.rows[0]!) };
      });
    }
  };
}

async function readPerson(db: Pick<OperationalPool, "query">, workspaceId: string, personId: string, fallback?: PersonRow) {
  const result = await db.query<PersonRow>(`${personSelect} WHERE p.workspace_id=$1 AND p.id=$2`, [workspaceId, personId]);
  return personFromRow(result.rows[0] ?? fallback!);
}

async function lockAreaAccess(client: Parameters<typeof lockActiveAreaReference>[0], workspaceId: string, areaIds: string[]) {
  for (const areaId of areaIds) await lockActiveAreaReference(client, workspaceId, areaId);
}

async function replaceAreaAccess(client: Parameters<typeof lockActiveAreaReference>[0], workspaceId: string, personId: string, areaIds: string[]) {
  await client.query("DELETE FROM person_area_access WHERE workspace_id=$1 AND person_id=$2", [workspaceId, personId]);
  for (const areaId of areaIds) await client.query("INSERT INTO person_area_access (workspace_id,person_id,area_id) VALUES ($1,$2,$3)", [workspaceId, personId, areaId]);
}

function nextTimestamp(previous: string) {
  const now = new Date();
  return now.getTime() > new Date(previous).getTime()
    ? now.toISOString()
    : new Date(new Date(previous).getTime() + 1).toISOString();
}
