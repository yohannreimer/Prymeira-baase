import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { ensureOperationalSchema } from "../../db/operational-schema";
import { createPostgresRepositoryBundle, createRelationalOperationalRepositoryBundle, ensurePostgresSchema } from "../../db/postgres";
import type { OperationalClient, OperationalPool } from "../../db/operational-repository-support";
import { createPostgresProcessRepository } from "../processes/postgres-process.repository";
import { createPostgresRoutineRepository } from "../routines/postgres-routine.repository";
import { createRelationalAreaLifecycleRepository } from "./area-lifecycle.repository";
import { createAreaLifecycleService } from "./area-lifecycle.service";
import { createCompanyService } from "./company.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
let schemaSequence = 0;

describe.skipIf(!testDatabaseUrl)("area lifecycle on PostgreSQL 16", () => {
  it("unassigns every active link, preserves history, handles pending invites, and audits exact details", async () => {
    await withPostgresSchema(async (pool) => {
      await seedLinkedArea(pool);
      const service = createAreaLifecycleService(createRelationalAreaLifecycleRepository(pool));

      const impact = await service.getImpact("workspace_a", "area_source");
      expect(impact).toMatchObject({
        processes: [{ id: "process_1", title: "Fechamento" }],
        routines: [{ id: "routine_1", title: "Abertura" }],
        roleTemplates: [{ id: "role_1", name: "Caixa" }],
        people: [{ id: "person_1", name: "Ana" }],
        pendingInvites: [{ id: "invite_1", name: "Bia", email: "bia@example.com" }]
      });

      const result = await service.archive("workspace_a", "area_source", "owner_1", { strategy: "unassign" });
      expect(result.unassigned).toEqual({ processes: 1, routines: 1, people: 1, pendingInvites: 1 });
      expect(result.archived).toEqual({ areas: 1, roleTemplates: 1 });

      const state = await pool.query<{
        area_archived: boolean; process_area: string | null; process_owner_role: string | null;
        routine_area: string | null; person_area: string | null; person_role: string | null;
        role_archived: boolean; assignment_count: number; version_count: number; snapshot: string | null;
      }>(`SELECT
        (SELECT archived_at IS NOT NULL FROM areas WHERE workspace_id='workspace_a' AND id='area_source') area_archived,
        (SELECT area_id FROM processes WHERE workspace_id='workspace_a' AND id='process_1') process_area,
        (SELECT owner_role_template_id FROM processes WHERE workspace_id='workspace_a' AND id='process_1') process_owner_role,
        (SELECT area_id FROM routines WHERE workspace_id='workspace_a' AND id='routine_1') routine_area,
        (SELECT area_id FROM people WHERE workspace_id='workspace_a' AND id='person_1') person_area,
        (SELECT role_template_id FROM people WHERE workspace_id='workspace_a' AND id='person_1') person_role,
        (SELECT archived_at IS NOT NULL FROM role_templates WHERE workspace_id='workspace_a' AND id='role_1') role_archived,
        (SELECT COUNT(*)::int FROM routine_assignments WHERE workspace_id='workspace_a') assignment_count,
        (SELECT COUNT(*)::int FROM process_versions WHERE workspace_id='workspace_a' AND process_id='process_1') version_count,
        (SELECT area_name_snapshot FROM routine_occurrences WHERE workspace_id='workspace_a' AND id='occurrence_1') snapshot`);
      expect(state.rows[0]).toEqual({
        area_archived: true, process_area: null, process_owner_role: null, routine_area: null,
        person_area: null, person_role: null, role_archived: true, assignment_count: 0,
        version_count: 1, snapshot: "Operacao"
      });
      const invite = await pool.query<{ data: { areaId: string | null; roleTemplateId: string | null; accessScope: string } }>(
        "SELECT data FROM baase_records WHERE kind='team_invite' AND workspace_id='workspace_a' AND id='invite_1'"
      );
      expect(invite.rows[0]?.data).toMatchObject({ areaId: null, roleTemplateId: null, accessScope: "workspace" });
      const audit = await pool.query<{ action: string; actor_profile_id: string; details: Record<string, unknown> }>(
        "SELECT action,actor_profile_id,details FROM operational_audit_log WHERE workspace_id='workspace_a' AND entity_id='area_source'"
      );
      expect(audit.rows[0]).toMatchObject({
        action: "archive",
        actor_profile_id: "owner_1",
        details: { strategy: "unassign", archived: { areas: 1, roleTemplates: 1 } }
      });
    });
  });

  it("rejects a target archived while reassignment is waiting for its row lock", async () => {
    await withPostgresSchema(async (pool) => {
      await seedAreas(pool);
      const locker = await pool.connect();
      try {
        await locker.query("BEGIN");
        await locker.query("SELECT id FROM areas WHERE workspace_id='workspace_a' AND id='area_target' FOR UPDATE");
        const archive = createAreaLifecycleService(createRelationalAreaLifecycleRepository(pool))
          .archive("workspace_a", "area_source", "owner_1", { strategy: "reassign", targetAreaId: "area_target" });
        await sleep(50);
        await locker.query("UPDATE areas SET archived_at=NOW() WHERE workspace_id='workspace_a' AND id='area_target'");
        await locker.query("COMMIT");
        await expect(archive).rejects.toThrow("AREA_ARCHIVE_TARGET_NOT_FOUND");
      } finally {
        await locker.query("ROLLBACK").catch(() => undefined);
        locker.release();
      }
      expect((await pool.query("SELECT archived_at FROM areas WHERE workspace_id='workspace_a' AND id='area_source'")).rows[0]?.archived_at).toBeNull();
    });
  });

  it("blocks a concurrent link creation and rejects it after the source archive commits", async () => {
    await withPostgresSchema(async (pool) => {
      await seedAreas(pool);
      let releaseSourceLock!: () => void;
      const sourceLocked = new Promise<void>((resolve) => { releaseSourceLock = resolve; });
      let notifyLocked!: () => void;
      const locked = new Promise<void>((resolve) => { notifyLocked = resolve; });
      const lifecyclePool = pauseAfterSourceLock(pool, notifyLocked, sourceLocked);
      const archive = createAreaLifecycleService(createRelationalAreaLifecycleRepository(lifecyclePool))
        .archive("workspace_a", "area_source", "owner_1");
      await locked;

      const createLink = createPostgresProcessRepository(pool).createProcess({
        workspaceId: "workspace_a", areaId: "area_source", title: "Racing", summary: null, status: "draft",
        ownerProfileId: null, currentVersion: version("new"), versions: [version("new")], createdByProfileId: "owner_1",
        publishedAt: null, archivedAt: null
      });
      await sleep(30);
      releaseSourceLock();
      await expect(archive).resolves.toMatchObject({ archived: { areas: 1 } });
      await expect(createLink).rejects.toThrow("AREA_NOT_FOUND");
      expect((await pool.query("SELECT id FROM processes WHERE workspace_id='workspace_a'")).rows).toEqual([]);
    });
  });

  it("blocks a concurrent link update to the source and rejects it after archive", async () => {
    await withPostgresSchema(async (pool) => {
      await seedAreas(pool);
      await pool.query("INSERT INTO areas (id,workspace_id,name,sort_order) VALUES ('area_update','workspace_a','Update source',3)");
      const processRepository = createPostgresProcessRepository(pool);
      const process = await processRepository.createProcess({
        workspaceId: "workspace_a", areaId: "area_target", title: "Existing", summary: null, status: "draft",
        ownerProfileId: null, currentVersion: version("existing"), versions: [version("existing")], createdByProfileId: "owner_1",
        publishedAt: null, archivedAt: null
      });
      let releaseSourceLock!: () => void;
      const sourceLocked = new Promise<void>((resolve) => { releaseSourceLock = resolve; });
      let notifyLocked!: () => void;
      const locked = new Promise<void>((resolve) => { notifyLocked = resolve; });
      const lifecyclePool = pauseAfterSourceLock(pool, notifyLocked, sourceLocked, "area_update");
      const archive = createAreaLifecycleService(createRelationalAreaLifecycleRepository(lifecyclePool))
        .archive("workspace_a", "area_update", "owner_1");
      await locked;
      const updateLink = processRepository.updateProcess({ ...process, areaId: "area_update" });
      await sleep(30);
      releaseSourceLock();
      await expect(archive).resolves.toMatchObject({ archived: { areas: 1 } });
      await expect(updateLink).rejects.toThrow("AREA_NOT_FOUND");
      expect((await processRepository.findProcess("workspace_a", process.id))?.areaId).toBe("area_target");
    });
  });

  it("serializes an outgoing process move so the archive counts only committed links", async () => {
    await withPostgresSchema(async (pool) => {
      await seedAreas(pool);
      const processRepository = createPostgresProcessRepository(pool);
      const process = await processRepository.createProcess({
        workspaceId: "workspace_a", areaId: "area_source", title: "Existing", summary: null, status: "draft",
        ownerProfileId: null, currentVersion: version("outgoing"), versions: [version("outgoing")], createdByProfileId: "owner_1",
        publishedAt: null, archivedAt: null
      });
      let releaseSourceLock!: () => void;
      const sourceLocked = new Promise<void>((resolve) => { releaseSourceLock = resolve; });
      let notifyLocked!: () => void;
      const locked = new Promise<void>((resolve) => { notifyLocked = resolve; });
      const lifecyclePool = pauseAfterSourceLock(pool, notifyLocked, sourceLocked);
      const archive = createAreaLifecycleService(createRelationalAreaLifecycleRepository(lifecyclePool))
        .archive("workspace_a", "area_source", "owner_1", { strategy: "unassign" });
      await locked;

      const move = processRepository.updateProcess({ ...process, areaId: "area_target" });
      await sleep(30);
      releaseSourceLock();

      await expect(archive).resolves.toMatchObject({ unassigned: { processes: 1 } });
      await expect(move).rejects.toThrow("PROCESS_STALE");
      expect((await processRepository.findProcess("workspace_a", process.id))?.areaId).toBeNull();
    });
  });

  it("rejects an invite whose area is archived while the invite creation waits", async () => {
    await withPostgresSchema(async (pool) => {
      await seedAreas(pool);
      const jsonb = createPostgresRepositoryBundle(pool);
      const relational = createRelationalOperationalRepositoryBundle(pool, jsonb.companyRepository);
      const company = createCompanyService(relational.companyRepository!);
      let releaseSourceLock!: () => void;
      const sourceLocked = new Promise<void>((resolve) => { releaseSourceLock = resolve; });
      let notifyLocked!: () => void;
      const locked = new Promise<void>((resolve) => { notifyLocked = resolve; });
      const lifecyclePool = pauseAfterSourceLock(pool, notifyLocked, sourceLocked);
      const archive = createAreaLifecycleService(createRelationalAreaLifecycleRepository(lifecyclePool))
        .archive("workspace_a", "area_source", "owner_1");
      await locked;

      const invite = company.createTeamInvite("workspace_a", {
        name: "Bia", role: "employee", areaId: "area_source", createdByProfileId: "owner_1"
      });
      await sleep(30);
      releaseSourceLock();

      await expect(archive).resolves.toMatchObject({ archived: { areas: 1 } });
      await expect(invite).rejects.toThrow("AREA_NOT_FOUND");
      expect((await pool.query("SELECT id FROM baase_records WHERE kind='team_invite' AND workspace_id='workspace_a'")).rows).toEqual([]);
    });
  });

  it("keeps JSONB mode coherent across linked records and its audit", async () => {
    await withPostgresSchema(async (pool) => {
      const bundle = createPostgresRepositoryBundle(pool);
      const source = await bundle.companyRepository.createArea({ workspaceId: "workspace_a", name: "Operacao", description: null });
      const target = await bundle.companyRepository.createArea({ workspaceId: "workspace_a", name: "Financeiro", description: null });
      const role = await bundle.companyRepository.createRoleTemplate({
        workspaceId: "workspace_a", areaId: source.id, name: "Caixa", description: null
      });
      const person = await bundle.companyRepository.createTeamMember({
        workspaceId: "workspace_a", name: "Ana", email: null, role: "employee", areaId: source.id,
        roleTemplateId: role.id, status: "active", createdByProfileId: "owner_1"
      });
      await bundle.processRepository.createProcess({
        workspaceId: "workspace_a", areaId: source.id, title: "Fechamento", summary: null, status: "draft",
        ownerProfileId: person.id, currentVersion: version("jsonb"), versions: [version("jsonb")],
        createdByProfileId: "owner_1", publishedAt: null, archivedAt: null
      });

      const result = await createAreaLifecycleService(bundle.areaLifecycleRepository)
        .archive("workspace_a", source.id, "owner_1", { strategy: "reassign", targetAreaId: target.id });
      expect(result.reassigned).toMatchObject({ processes: 1, roleTemplates: 1, people: 1 });
      expect((await bundle.processRepository.listProcesses("workspace_a"))[0]?.areaId).toBe(target.id);
      expect((await bundle.companyRepository.listRoleTemplates("workspace_a"))[0]?.areaId).toBe(target.id);
      expect((await bundle.companyRepository.listTeamMembers("workspace_a"))[0]?.areaId).toBe(target.id);
      expect(await bundle.companyRepository.findAreaById("workspace_a", source.id)).toBeNull();
      const archivedSource = await pool.query<{ data: { archivedAt?: string } }>(
        "SELECT data FROM baase_records WHERE kind='area' AND workspace_id='workspace_a' AND id=$1",
        [source.id]
      );
      expect(archivedSource.rows[0]?.data.archivedAt).toEqual(expect.any(String));
      await expect(bundle.processRepository.createProcess({
        workspaceId: "workspace_a", areaId: source.id, title: "Não pode", summary: null, status: "draft",
        ownerProfileId: null, currentVersion: version("archived_jsonb"), versions: [version("archived_jsonb")],
        createdByProfileId: "owner_1", publishedAt: null, archivedAt: null
      })).rejects.toThrow("AREA_NOT_FOUND");
      await expect(bundle.routineRepository.createTaskOccurrence({
        workspaceId: "workspace_a", origin: "manual", routineId: null, taskTemplateId: null,
        title: "Não pode", areaId: source.id, processId: null, assigneeProfileId: null,
        approvalMode: "direct", evidencePolicy: "optional", status: "pending", dueDate: "2026-07-11",
        evidence: null, submittedByProfileId: null, submittedAt: null, reviewedByProfileId: null,
        reviewedAt: null, reviewComment: null
      })).rejects.toThrow("AREA_NOT_FOUND");
      expect((await pool.query("SELECT id FROM baase_records WHERE kind='operational_audit' AND workspace_id='workspace_a'")).rows).toHaveLength(1);
    });
  });

  it("accepts JSONB invites atomically and idempotently", async () => {
    await withPostgresSchema(async (pool) => {
      const bundle = createPostgresRepositoryBundle(pool);
      const company = createCompanyService(bundle.companyRepository);
      const area = await company.createArea("workspace_a", { name: "Operação" });
      const invite = await company.createTeamInvite("workspace_a", {
        name: "Bia", role: "employee", areaId: area.id, createdByProfileId: "owner_1"
      });

      const first = await company.acceptTeamInvite(invite.code, { acceptedByProfileId: "account_bia" });
      const second = await company.acceptTeamInvite(invite.code, { acceptedByProfileId: "account_bia" });

      expect(second.person.id).toBe(first.person.id);
      expect((await bundle.companyRepository.listTeamMembers("workspace_a"))).toHaveLength(1);
      expect((await bundle.companyRepository.findTeamInviteByCode(invite.code))?.status).toBe("accepted");
    });
  });

  it("rolls back all resolutions when audit persistence fails", async () => {
    await withPostgresSchema(async (pool) => {
      await seedLinkedArea(pool);
      const failing = failOnAudit(pool);
      const service = createAreaLifecycleService(createRelationalAreaLifecycleRepository(failing));
      await expect(service.archive("workspace_a", "area_source", "owner_1", { strategy: "unassign" }))
        .rejects.toThrow("INJECTED_AUDIT_FAILURE");

      const state = await pool.query<{ archived_at: Date | null; area_id: string | null }>(
        `SELECT a.archived_at,p.area_id FROM areas a JOIN processes p ON p.workspace_id=a.workspace_id
         WHERE a.workspace_id='workspace_a' AND a.id='area_source' AND p.id='process_1'`
      );
      expect(state.rows[0]).toMatchObject({ archived_at: null, area_id: "area_source" });
      expect((await pool.query("SELECT archived_at FROM role_templates WHERE workspace_id='workspace_a' AND id='role_1'")).rows[0]?.archived_at).toBeNull();
    });
  });

  it("rejects new manual task links to an archived area while retaining historical occurrences", async () => {
    await withPostgresSchema(async (pool) => {
      await seedAreas(pool);
      await pool.query("UPDATE areas SET archived_at=NOW() WHERE workspace_id='workspace_a' AND id='area_source'");
      const routines = createPostgresRoutineRepository(pool);

      await expect(routines.createTaskOccurrence({
        workspaceId: "workspace_a", origin: "manual", routineId: null, taskTemplateId: null,
        title: "Nova tarefa", areaId: "area_source", processId: null, assigneeProfileId: null,
        approvalMode: "direct", evidencePolicy: "optional", status: "pending", dueDate: "2026-07-11",
        evidence: null, submittedByProfileId: null, submittedAt: null, reviewedByProfileId: null,
        reviewedAt: null, reviewComment: null
      })).rejects.toThrow("AREA_NOT_FOUND");

      await pool.query(`INSERT INTO task_occurrences
        (id,workspace_id,origin,title,area_id,area_name_snapshot,step_title_snapshot,approval_mode,evidence_policy,status,due_date)
        VALUES ('task_historical','workspace_a','manual','Histórica','area_source','Operação','Histórica','direct','optional','pending','2026-07-10')`);
      const historical = await routines.findTaskOccurrence("workspace_a", "task_historical");
      expect(historical).toMatchObject({ areaId: "area_source", areaNameSnapshot: "Operação" });
    });
  });
});

async function withPostgresSchema<T>(run: (pool: Pool) => Promise<T>) {
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
  const admin = new Pool({ connectionString: testDatabaseUrl });
  const schema = `baase_area_lifecycle_${process.pid}_${Date.now()}_${schemaSequence++}`;
  let pool: Pool | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: testDatabaseUrl, options: `-c search_path=${schema}` });
    await ensurePostgresSchema(pool);
    await ensureOperationalSchema(pool);
    return await run(pool);
  } finally {
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}

async function seedAreas(pool: Pool) {
  await pool.query(`INSERT INTO areas (id,workspace_id,name,sort_order) VALUES
    ('area_source','workspace_a','Operacao',1),('area_target','workspace_a','Financeiro',2),
    ('area_other','workspace_b','Outra',1)`);
}

async function seedLinkedArea(pool: Pool) {
  await seedAreas(pool);
  await pool.query("INSERT INTO role_templates (id,workspace_id,area_id,name) VALUES ('role_1','workspace_a','area_source','Caixa')");
  await pool.query(`INSERT INTO people (id,workspace_id,name,email,role,area_id,role_template_id,status,created_by_profile_id)
    VALUES ('person_1','workspace_a','Ana','ana@example.com','employee','area_source','role_1','active','owner_1')`);
  await pool.query(`INSERT INTO processes
    (id,workspace_id,area_id,title,status,owner_role_template_id,current_version,created_by_profile_id)
    VALUES ('process_1','workspace_a','area_source','Fechamento','published','role_1',1,'owner_1')`);
  await pool.query(`INSERT INTO process_versions
    (id,workspace_id,process_id,version_number,title,body,change_note,editor_profile_id)
    VALUES ('version_1','workspace_a','process_1',1,'Fechamento','Passos','Criacao','owner_1')`);
  await pool.query(`INSERT INTO routines
    (id,workspace_id,area_id,title,status,frequency,weekdays,created_by_profile_id)
    VALUES ('routine_1','workspace_a','area_source','Abertura','active','on_demand',ARRAY[]::text[],'owner_1')`);
  await pool.query(`INSERT INTO routine_assignments (id,workspace_id,routine_id,role_template_id)
    VALUES ('assignment_1','workspace_a','routine_1','role_1')`);
  await pool.query(`INSERT INTO routine_occurrences
    (id,workspace_id,routine_id,due_date,audience_key,area_name_snapshot,routine_title_snapshot)
    VALUES ('occurrence_1','workspace_a','routine_1','2026-07-11','shared','Operacao','Abertura')`);
  const timestamp = "2026-07-10T00:00:00.000Z";
  const invite = {
    id: "invite_1", workspaceId: "workspace_a", name: "Bia", email: "bia@example.com", role: "employee",
    areaId: "area_source", roleTemplateId: "role_1", accessScope: "assigned_only", code: "BAASE-INVITE-1",
    status: "pending", createdByProfileId: "owner_1", createdAt: timestamp, updatedAt: timestamp
  };
  await pool.query(`INSERT INTO baase_records (kind,workspace_id,id,data,created_at,updated_at)
    VALUES ('team_invite','workspace_a','invite_1',$1::jsonb,$2,$2)`, [JSON.stringify(invite), timestamp]);
}

function version(processId: string) {
  return {
    id: `version_${processId}_1`, processId, workspaceId: "workspace_a", version: 1, title: "Racing",
    body: "Passos", changeNote: "Criacao", editorProfileId: "owner_1", createdAt: "2026-07-10T00:00:00.000Z"
  };
}

function pauseAfterSourceLock(
  pool: Pool,
  notifyLocked: () => void,
  release: Promise<void>,
  sourceAreaId = "area_source"
): OperationalPool {
  return {
    query: pool.query.bind(pool) as OperationalPool["query"],
    async connect() {
      const client = await pool.connect();
      return {
        async query(text, params) {
          const result = await client.query(text, params);
          if (text.includes("FROM areas") && text.includes("FOR UPDATE") && params?.[1] === sourceAreaId) {
            notifyLocked();
            await release;
          }
          return result as never;
        },
        release: () => client.release()
      };
    }
  };
}

function failOnAudit(pool: Pool): OperationalPool {
  return {
    query: pool.query.bind(pool) as OperationalPool["query"],
    async connect() {
      const client = await pool.connect();
      const wrapped: OperationalClient = {
        query(text, params) {
          if (text.includes("INSERT INTO operational_audit_log")) throw new Error("INJECTED_AUDIT_FAILURE");
          return client.query(text, params) as never;
        },
        release: () => client.release()
      };
      return wrapped;
    }
  };
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
