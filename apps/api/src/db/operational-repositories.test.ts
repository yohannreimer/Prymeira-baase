import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createCompanyService } from "../modules/company/company.service";
import { createAreaLifecycleService } from "../modules/company/area-lifecycle.service";
import { createProcessService } from "../modules/processes/process.service";
import type { ProcessRepository } from "../modules/processes/process.types";
import { createRoutineService } from "../modules/routines/routine.service";
import type { RoutineRepository } from "../modules/routines/routine.types";
import { createInMemoryRoutineRepository } from "../modules/routines/in-memory-routine.repository";
import { ensureOperationalSchema } from "./operational-schema";
import { createConfiguredPostgresRepositoryBundle, createPostgresRepositoryBundle, createRelationalOperationalRepositoryBundle, ensurePostgresSchema } from "./postgres";
import type { OperationalClient, OperationalPool } from "./operational-repository-support";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
let schemaSequence = 0;

async function withPostgresSchema<T>(run: (pool: Pool) => Promise<T>) {
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
  const admin = new Pool({ connectionString: testDatabaseUrl });
  const schema = `baase_repositories_${process.pid}_${Date.now()}_${schemaSequence++}`;
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

describe.skipIf(!testDatabaseUrl)("relational operational repositories on PostgreSQL 16", () => {
  it("selects relational operational data only through explicit configuration", async () => {
    await withPostgresSchema(async (pool) => {
      const jsonb = createConfiguredPostgresRepositoryBundle(pool, "jsonb");
      await jsonb.companyRepository.createArea({ workspaceId: "workspace_a", name: "JSONB", description: null });

      expect(await createConfiguredPostgresRepositoryBundle(pool, "jsonb").companyRepository.listAreas("workspace_a")).toHaveLength(1);
      expect(await createConfiguredPostgresRepositoryBundle(pool, "relational").companyRepository.listAreas("workspace_a")).toEqual([]);
    });
  });

  it("serializes concurrent generic schema initialization from an empty database", async () => {
    await withPostgresSchema(async (pool) => {
      await pool.query("DROP TABLE baase_postgres_schema_migrations");
      await pool.query("DROP TABLE baase_records");
      let advisoryLocks = 0;
      const tracked = trackPostgresSchemaLocks(pool, () => { advisoryLocks += 1; });

      await Promise.all([ensurePostgresSchema(tracked), ensurePostgresSchema(tracked)]);

      expect(advisoryLocks).toBe(2);
      const state = await pool.query<{ records: string | null; migrations: number }>(
        `SELECT to_regclass('baase_records')::text records,
          (SELECT COUNT(*)::int FROM baase_postgres_schema_migrations WHERE version=1) migrations`
      );
      expect(state.rows[0]).toEqual({ records: "baase_records", migrations: 1 });
    });
  });

  it("serializes and versions concurrent legacy invite-code migration", async () => {
    await withPostgresSchema(async (pool) => {
      await pool.query("DROP INDEX baase_records_team_invite_code_uidx");
      await pool.query(`CREATE TABLE IF NOT EXISTS baase_postgres_schema_migrations (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query("DELETE FROM baase_postgres_schema_migrations WHERE version=1");
      const legacyInvite = (workspaceId: string, id: string) => ({
        id,
        workspaceId,
        name: workspaceId,
        email: null,
        role: "employee",
        areaId: null,
        roleTemplateId: null,
        accessScope: "workspace",
        code: "BAASE-0001",
        status: "pending",
        createdByProfileId: "account_owner",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z"
      });
      for (const [workspaceId, id] of [["workspace_a", "invite_a"], ["workspace_b", "invite_b"]]) {
        const invite = legacyInvite(workspaceId!, id!);
        await pool.query(
          `INSERT INTO baase_records (kind,workspace_id,id,data,created_at,updated_at)
           VALUES ('team_invite',$1,$2,$3::jsonb,$4,$4)`,
          [workspaceId, id, JSON.stringify(invite), invite.createdAt]
        );
      }

      let advisoryLocks = 0;
      const tracked = trackPostgresSchemaLocks(pool, () => { advisoryLocks += 1; });
      await Promise.all([ensurePostgresSchema(tracked), ensurePostgresSchema(tracked)]);
      expect(advisoryLocks).toBe(2);
      const versions = await pool.query<{ version: number; count: number }>(
        `SELECT version,COUNT(*)::int count FROM baase_postgres_schema_migrations
         GROUP BY version ORDER BY version`
      );
      expect(versions.rows).toEqual([{ version: 1, count: 1 }]);
      const upgraded = await pool.query<{ code: string }>(
        "SELECT data ->> 'code' code FROM baase_records WHERE kind='team_invite' ORDER BY workspace_id"
      );
      expect(upgraded.rows.map((row) => row.code)).toEqual([
        expect.stringMatching(/^BAASE-[A-F0-9]{32}$/),
        expect.stringMatching(/^BAASE-[A-F0-9]{32}$/)
      ]);
      expect(new Set(upgraded.rows.map((row) => row.code)).size).toBe(2);
      await expect(pool.query(
        `INSERT INTO baase_records (kind,workspace_id,id,data)
         VALUES ('team_invite','workspace_c','invite_c',$1::jsonb)`,
        [JSON.stringify({ ...legacyInvite("workspace_c", "invite_c"), code: upgraded.rows[0]!.code })]
      )).rejects.toMatchObject({ code: "23505", constraint: "baase_records_team_invite_code_uidx" });
    });
  });

  it("locks invite rows during code migration and preserves a racing status mutation", async () => {
    await withPostgresSchema(async (pool) => {
      await pool.query("DROP INDEX baase_records_team_invite_code_uidx");
      await pool.query(`CREATE TABLE IF NOT EXISTS baase_postgres_schema_migrations (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query("DELETE FROM baase_postgres_schema_migrations WHERE version=1");
      const invite = {
        id: "invite_race", workspaceId: "workspace_race", name: "Corrida", email: null,
        role: "employee", areaId: null, roleTemplateId: null, accessScope: "workspace",
        code: "BAASE-0001", status: "pending", createdByProfileId: "account_owner",
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z"
      };
      await pool.query(
        `INSERT INTO baase_records (kind,workspace_id,id,data,created_at,updated_at)
         VALUES ('team_invite',$1,$2,$3::jsonb,$4,$4)`,
        [invite.workspaceId, invite.id, JSON.stringify(invite), invite.createdAt]
      );

      let migrationRead!: () => void;
      let releaseMigration!: () => void;
      const readObserved = new Promise<void>((resolve) => { migrationRead = resolve; });
      const migrationGate = new Promise<void>((resolve) => { releaseMigration = resolve; });
      const migrating = ensurePostgresSchema(barrierPostgresInviteMigration(
        pool,
        migrationRead,
        migrationGate
      ));
      await readObserved;

      const acceptedAt = "2030-07-02T00:00:00.000Z";
      let mutationSettled = false;
      const mutation = pool.query(
        `UPDATE baase_records
         SET data=jsonb_set(jsonb_set(data,'{status}','\"accepted\"'::jsonb),'{updatedAt}',$3::jsonb),
             updated_at=$4
         WHERE kind='team_invite' AND workspace_id=$1 AND id=$2`,
        [invite.workspaceId, invite.id, JSON.stringify(acceptedAt), acceptedAt]
      ).then(() => { mutationSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 30));
      const mutationWasBlocked = !mutationSettled;
      releaseMigration();
      await Promise.all([migrating, mutation]);
      expect(mutationWasBlocked).toBe(true);

      const persisted = await pool.query<{ code: string; status: string; updated_at: string }>(
        `SELECT data->>'code' code,data->>'status' status,data->>'updatedAt' updated_at
         FROM baase_records WHERE kind='team_invite' AND workspace_id=$1 AND id=$2`,
        [invite.workspaceId, invite.id]
      );
      expect(persisted.rows[0]).toEqual({
        code: expect.stringMatching(/^BAASE-[A-F0-9]{32}$/),
        status: "accepted",
        updated_at: acceptedAt
      });
    });
  });

  it("infers direct repository task origin consistently across storage modes", async () => {
    await withPostgresSchema(async (pool) => {
      const relational = createConfiguredPostgresRepositoryBundle(pool, "relational").routineRepository;
      const jsonb = createConfiguredPostgresRepositoryBundle(pool, "jsonb").routineRepository;
      const memory = createInMemoryRoutineRepository();
      const input = {
        workspaceId: "workspace_origin",
        routineId: null,
        taskTemplateId: null,
        title: "Origem inferida",
        areaId: null,
        processId: null,
        assigneeProfileId: "account_owner",
        approvalMode: "direct" as const,
        evidencePolicy: "optional" as const,
        status: "pending" as const,
        dueDate: "2026-07-21",
        evidence: null,
        submittedByProfileId: null,
        submittedAt: null,
        reviewedByProfileId: null,
        reviewedAt: null,
        reviewComment: null
      };
      const tasks = await Promise.all([
        relational.createTaskOccurrence(input),
        jsonb.createTaskOccurrence(input),
        memory.createTaskOccurrence(input)
      ]);
      expect(tasks.map((task) => task.origin)).toEqual(["manual", "manual", "manual"]);
    });
  });

  it("normalizes omitted direct routine recurrence consistently on create and update", async () => {
    await withPostgresSchema(async (pool) => {
      const repositories = [
        createConfiguredPostgresRepositoryBundle(pool, "relational").routineRepository,
        createConfiguredPostgresRepositoryBundle(pool, "jsonb").routineRepository,
        createInMemoryRoutineRepository()
      ];
      for (const [index, repository] of repositories.entries()) {
        const workspaceId = `workspace_recurrence_${index}`;
        const created = await repository.createRoutine({
          workspaceId,
          areaId: null,
          title: "Recorrencia padrao",
          status: "active",
          createdByProfileId: "account_owner",
          taskTemplates: [{
            id: `step_recurrence_${index}`,
            routineId: "__routine__",
            workspaceId,
            title: "Executar",
            processId: null,
            assigneeProfileId: null,
            approvalMode: "direct",
            evidencePolicy: "optional",
            sortOrder: 1
          }]
        });
        expect(created).toMatchObject({ frequency: "daily", weekdays: ["mon", "tue", "wed", "thu", "fri"] });

        const updated = await repository.updateRoutine({
          ...created,
          title: "Recorrencia atualizada",
          frequency: undefined,
          weekdays: []
        });
        expect(updated).toMatchObject({ frequency: "daily", weekdays: ["mon", "tue", "wed", "thu", "fri"] });
      }
    });
  });

  it("preserves scoped operational history while JSONB invites remain available", async () => {
    await withPostgresSchema(async (pool) => {
      const jsonb = createPostgresRepositoryBundle(pool);
      const relational = createRelationalOperationalRepositoryBundle(pool, jsonb.companyRepository);
      const company = createCompanyService(relational.companyRepository!);
      const processes = createProcessService(relational.processRepository!);
      const routines = createRoutineService(relational.routineRepository!);

      const area = await company.createArea("workspace_a", { name: "Operacoes" });
      const otherArea = await company.createArea("workspace_b", { name: "Outra" });
      const role = await company.createRoleTemplate("workspace_a", { areaId: area.id, name: "Analista" });
      const person = await company.createTeamMember("workspace_a", {
        name: "Ana", email: "ana@example.com", role: "employee", areaId: area.id, roleTemplateId: role.id,
        createdByProfileId: "account_owner"
      });
      const invite = await company.createTeamInvite("workspace_a", {
        name: "Bia", role: "employee", createdByProfileId: "account_owner"
      });
      expect(invite.id).toMatch(/^invite_/);
      expect(await jsonb.companyRepository.listTeamInvites("workspace_a")).toHaveLength(1);
      await expect(relational.companyRepository!.createRoleTemplate({
        workspaceId: "workspace_a", areaId: otherArea.id, name: "Invalido", description: null
      })).rejects.toThrow();

      const process = await processes.createProcess("workspace_a", "account_owner", {
        title: "Fechamento", body: "Fechar o caixa", areaId: area.id,
        owner: { type: "role", roleTemplateId: role.id },
        materials: [{ kind: "link", title: "Planilha", url: "https://example.com/caixa" }]
      });
      const versioned = await processes.createProcessVersion("workspace_a", process.id, "account_owner", {
        body: "Fechar e conferir o caixa", changeNote: "Inclui conferencia",
        materials: [{ kind: "link", title: "Planilha revisada", url: "https://example.com/caixa-revisada" }]
      });
      expect(versioned.versions.map((version) => version.version)).toEqual([1, 2]);
      expect(versioned.currentVersion.version).toBe(2);
      expect(versioned.owner).toEqual({ type: "role", roleTemplateId: role.id });
      expect(versioned.materials).toMatchObject([{ title: "Planilha revisada", url: "https://example.com/caixa-revisada" }]);
      const uploadedMaterial = await relational.processRepository!.addProcessMaterial({
        workspaceId: "workspace_a",
        processId: process.id,
        kind: "file",
        title: "comprovante.pdf",
        url: null,
        objectKey: "workspaces/workspace_a/processes/comprovante.pdf",
        contentType: "application/pdf",
        sizeBytes: 128
      });
      expect(await relational.processRepository!.findProcessMaterial("workspace_a", process.id, uploadedMaterial.id))
        .toMatchObject({ objectKey: "workspaces/workspace_a/processes/comprovante.pdf" });
      await relational.processRepository!.removeProcessMaterial("workspace_a", process.id, uploadedMaterial.id);
      expect(await relational.processRepository!.listProcessMaterials("workspace_a", process.id))
        .toMatchObject([{ kind: "link", title: "Planilha revisada" }]);
      const currentProcess = await relational.processRepository!.findProcess("workspace_a", process.id);
      await expect(relational.processRepository!.updateProcess({
        ...currentProcess!,
        versions: currentProcess!.versions.map((version) => version.version === 1
          ? { ...version, body: "Conflito retroativo" }
          : version)
      })).rejects.toThrow("PROCESS_VERSION_CONFLICT");

      const manual = await routines.createManualTask("workspace_a", "account_owner", {
        title: "Revisar caixa", dueDate: "2026-07-13", checklistItems: ["Conferir saldo"],
        evidencePolicy: "comment_required"
      });
      const checked = await routines.updateTaskChecklist("workspace_a", manual.id, "account_owner", {
        checklistItems: [{ title: "Conferir saldo", done: true }]
      });
      expect(checked.checklistItems).toEqual([{ title: "Conferir saldo", done: true }]);
      const submitted = await routines.submitTask("workspace_a", manual.id, "account_owner", { comment: "Conferido" });
      expect(submitted).toMatchObject({ status: "completed", evidence: { comment: "Conferido" } });

      const routine = await routines.createRoutine("workspace_a", "account_owner", {
        title: "Abertura", areaId: area.id, assigneeProfileIds: [person.id], executionMode: "individual",
        taskTemplates: [{ title: "Abrir portas" }, { title: "Ligar luzes" }]
      });
      const [first, second] = await Promise.all([
        routines.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-13"),
        routines.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-13")
      ]);
      expect(first[0]?.id).toBe(second[0]?.id);
      expect(first[0]).toMatchObject({ routineTitleSnapshot: "Abertura", areaNameSnapshot: "Operacoes" });

      await routines.updateRoutine("workspace_a", routine.id, {
        title: "Abertura atualizada", areaId: area.id, assigneeProfileIds: [person.id], executionMode: "individual",
        taskTemplates: [{ id: routine.taskTemplates[0]!.id, title: "Abrir unidade" }]
      });
      const preserved = await relational.routineRepository!.findTaskOccurrence("workspace_a", first[0]!.id);
      expect(preserved).toMatchObject({ title: "Abertura", routineTitleSnapshot: "Abertura" });
      const future = await routines.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-14");
      expect(future[0]).toMatchObject({ title: "Abertura atualizada", routineTitleSnapshot: "Abertura atualizada" });
      const routineHistory = await pool.query<{ archived_steps: number; old_parents: number }>(
        `SELECT
          (SELECT COUNT(*)::int FROM routine_steps WHERE workspace_id=$1 AND routine_id=$2 AND archived_at IS NOT NULL) archived_steps,
          (SELECT COUNT(*)::int FROM routine_occurrences WHERE workspace_id=$1 AND routine_id=$2 AND routine_title_snapshot='Abertura') old_parents`,
        ["workspace_a", routine.id]
      );
      expect(routineHistory.rows[0]).toEqual({ archived_steps: 1, old_parents: 1 });

      await expect(routines.deleteTask("workspace_a", manual.id)).rejects.toThrow("TASK_NOT_PENDING");
      expect(await relational.routineRepository!.findTaskOccurrence("workspace_a", manual.id))
        .toMatchObject({ status: "completed" });
      const history = await pool.query<{ archived_at: Date | null; checks: number; evidence: number }>(
        `SELECT t.archived_at,
          (SELECT COUNT(*)::int FROM task_checklist_items c WHERE c.workspace_id=t.workspace_id AND c.task_occurrence_id=t.id) checks,
          (SELECT COUNT(*)::int FROM task_evidence e WHERE e.workspace_id=t.workspace_id AND e.task_occurrence_id=t.id) evidence
         FROM task_occurrences t WHERE t.workspace_id=$1 AND t.id=$2`, ["workspace_a", manual.id]
      );
      expect(history.rows[0]).toMatchObject({ checks: 1, evidence: 1 });
      expect(history.rows[0]?.archived_at).toBeNull();
      await company.deleteTeamMember("workspace_a", person.id);
      await company.deleteRoleTemplate("workspace_a", role.id);
      await company.deleteArea("workspace_a", area.id);
      expect(await company.listTeamMembers("workspace_a")).toEqual([]);
      expect(await company.listRoleTemplates("workspace_a")).toEqual([]);
      expect(await company.listAreas("workspace_a")).toEqual([]);
      const audits = await pool.query<{ count: number }>("SELECT COUNT(*)::int count FROM operational_audit_log WHERE workspace_id=$1", ["workspace_a"]);
      expect(audits.rows[0]!.count).toBeGreaterThan(10);
    });
  });

  it("rolls back a mutation when audit persistence fails", async () => {
    await withPostgresSchema(async (pool) => {
      const failingPool: OperationalPool = {
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
      const jsonb = createPostgresRepositoryBundle(pool);
      const relational = createRelationalOperationalRepositoryBundle(failingPool, jsonb.companyRepository);
      await expect(relational.companyRepository!.createArea({ workspaceId: "workspace_a", name: "Rollback", description: null })).rejects.toThrow("INJECTED_AUDIT_FAILURE");
      const rows = await pool.query("SELECT id FROM areas WHERE workspace_id=$1", ["workspace_a"]);
      expect(rows.rows).toEqual([]);
    });
  });

  it("updates and archives scoped company records", async () => {
    await withPostgresSchema(async (pool) => {
      const bundle = createConfiguredPostgresRepositoryBundle(pool, "relational");
      const company = createCompanyService(bundle.companyRepository);
      const area = await company.createArea("workspace_a", { name: "Operacao" });
      const role = await company.createRoleTemplate("workspace_a", { areaId: area.id, name: "Caixa" });
      const person = await company.createTeamMember("workspace_a", {
        name: "Ana", email: "ana@example.com", role: "employee", areaId: area.id, roleTemplateId: role.id,
        createdByProfileId: "account_owner"
      });

      await company.updateArea("workspace_a", area.id, { name: "Operacao diaria", description: "Atualizada" });
      await company.updateTeamMember("workspace_a", person.id, {
        name: "Ana Silva", email: "ana@example.com", role: "manager",
        areaId: area.id, roleTemplateId: role.id, status: "active"
      });
      expect(await company.listAreas("workspace_b")).toEqual([]);
      expect(await bundle.companyRepository.findTeamMember("workspace_b", person.id)).toBeNull();
      expect(await company.listTeamMembers("workspace_a")).toEqual([
        expect.objectContaining({ id: person.id, name: "Ana Silva", role: "manager" })
      ]);

      await company.deleteTeamMember("workspace_a", person.id);
      await company.deleteRoleTemplate("workspace_a", role.id);
      await company.deleteArea("workspace_a", area.id);
      expect(await company.listTeamMembers("workspace_a")).toEqual([]);
      expect(await company.listRoleTemplates("workspace_a")).toEqual([]);
      expect(await company.listAreas("workspace_a")).toEqual([]);
      const history = await pool.query<{ people: number; roles: number; areas: number }>(
        `select
          (select count(*)::int from people where workspace_id='workspace_a' and archived_at is not null) people,
          (select count(*)::int from role_templates where workspace_id='workspace_a' and archived_at is not null) roles,
          (select count(*)::int from areas where workspace_id='workspace_a' and archived_at is not null) areas`
      );
      expect(history.rows[0]).toEqual({ people: 1, roles: 1, areas: 1 });

      const replacementArea = await company.createArea("workspace_a", { name: "Operacao diaria" });
      const replacementRole = await company.createRoleTemplate("workspace_a", { areaId: replacementArea.id, name: "Caixa" });
      const replacementPerson = await company.createTeamMember("workspace_a", {
        name: "Outra Ana", email: "ana@example.com", role: "employee",
        areaId: replacementArea.id, roleTemplateId: replacementRole.id,
        createdByProfileId: "account_owner"
      });
      expect(replacementPerson.email).toBe("ana@example.com");
    });
  });

  it("accepts delegated JSONB invites atomically with retry and concurrent idempotency", async () => {
    await withPostgresSchema(async (pool) => {
      const jsonb = createPostgresRepositoryBundle(pool);
      const normalRepository = createRelationalOperationalRepositoryBundle(pool, jsonb.companyRepository).companyRepository!;
      const normalService = createCompanyService(normalRepository);
      const invite = await normalService.createTeamInvite("workspace_a", {
        name: "Convidada", email: "invite@example.com", role: "employee",
        createdByProfileId: "account_owner"
      });

      const failingRepository = createRelationalOperationalRepositoryBundle(
        failOnQuery(pool, "UPDATE baase_records", "INJECTED_INVITE_UPDATE_FAILURE"),
        jsonb.companyRepository
      ).companyRepository!;
      await expect(createCompanyService(failingRepository).acceptTeamInvite(invite.code, {
        acceptedByProfileId: "account_acceptor"
      })).rejects.toThrow("INJECTED_INVITE_UPDATE_FAILURE");
      expect((await pool.query("SELECT id FROM people WHERE workspace_id=$1", ["workspace_a"])).rows).toEqual([]);
      expect((await jsonb.companyRepository.listTeamInvites("workspace_a"))[0]?.status).toBe("pending");

      const accepted = await Promise.all([
        normalService.acceptTeamInvite(invite.code, { acceptedByProfileId: "account_acceptor" }),
        normalService.acceptTeamInvite(invite.code, { acceptedByProfileId: "account_acceptor" })
      ]);
      expect(accepted[0].person.id).toBe(accepted[1].person.id);
      expect(accepted[0].invite.status).toBe("accepted");
      const retry = await normalService.acceptTeamInvite(invite.code, { acceptedByProfileId: "account_acceptor" });
      expect(retry.person.id).toBe(accepted[0].person.id);
      expect((await pool.query("SELECT id FROM people WHERE workspace_id=$1", ["workspace_a"])).rows).toHaveLength(1);
    });
  });

  it("uses globally unique invite codes and resolves lookup and acceptance across workspaces", async () => {
    await withPostgresSchema(async (pool) => {
      const bundle = createConfiguredPostgresRepositoryBundle(pool, "relational");
      const company = createCompanyService(bundle.companyRepository);
      const [inviteA, inviteB] = await Promise.all([
        company.createTeamInvite("workspace_a", {
          name: "Pessoa A", role: "employee", createdByProfileId: "account_owner_a"
        }),
        company.createTeamInvite("workspace_b", {
          name: "Pessoa B", role: "employee", createdByProfileId: "account_owner_b"
        })
      ]);

      expect(inviteA.code).toMatch(/^BAASE-[A-F0-9]{32}$/);
      expect(inviteB.code).toMatch(/^BAASE-[A-F0-9]{32}$/);
      expect(inviteA.code).not.toBe(inviteB.code);
      expect(await company.findTeamInviteByCode(inviteA.code)).toMatchObject({
        id: inviteA.id, workspaceId: "workspace_a"
      });
      expect(await company.findTeamInviteByCode(inviteB.code)).toMatchObject({
        id: inviteB.id, workspaceId: "workspace_b"
      });

      const accepted = await company.acceptTeamInvite(inviteB.code, {
        acceptedByProfileId: "account_acceptor_b"
      });
      expect(accepted.person.workspaceId).toBe("workspace_b");
      expect(await bundle.companyRepository.listTeamMembers("workspace_a")).toEqual([]);
      expect(await bundle.companyRepository.listTeamMembers("workspace_b")).toHaveLength(1);

      const jsonbCompany = createCompanyService(createConfiguredPostgresRepositoryBundle(pool, "jsonb").companyRepository);
      const jsonbInvite = await jsonbCompany.createTeamInvite("workspace_jsonb", {
        name: "Pessoa JSONB", role: "employee", createdByProfileId: "account_owner_jsonb"
      });
      await expect(jsonbCompany.acceptTeamInvite(jsonbInvite.code)).resolves.toMatchObject({
        invite: { status: "accepted" },
        person: { workspaceId: "workspace_jsonb" }
      });
    });
  });

  it("rejects invite code collisions deterministically at the database boundary", async () => {
    await withPostgresSchema(async (pool) => {
      const fixedCode = "BAASE-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      const repository = createPostgresRepositoryBundle(pool, {
        inviteCodeGenerator: () => fixedCode
      }).companyRepository;

      await repository.createTeamInvite({
        workspaceId: "workspace_a", name: "Pessoa A", email: null, role: "employee",
        areaId: null, roleTemplateId: null, accessScope: "workspace", createdByProfileId: "owner_a"
      });
      await expect(repository.createTeamInvite({
        workspaceId: "workspace_b", name: "Pessoa B", email: null, role: "employee",
        areaId: null, roleTemplateId: null, accessScope: "workspace", createdByProfileId: "owner_b"
      })).rejects.toThrow("INVITE_CODE_CONFLICT");
    });
  });

  it("keeps accepted invites accepted when delegated invite archive writers are stale", async () => {
    await withPostgresSchema(async (pool) => {
      const base = createConfiguredPostgresRepositoryBundle(pool, "relational").companyRepository;
      const setup = createCompanyService(base);
      const archiveInvite = await setup.createTeamInvite("workspace_a", {
        name: "Pessoa arquivo", role: "employee", createdByProfileId: "account_owner"
      });
      let releaseArchive!: () => void;
      let archiveStarted!: () => void;
      const archiveGate = new Promise<void>((resolve) => { releaseArchive = resolve; });
      const archiveObserved = new Promise<void>((resolve) => { archiveStarted = resolve; });
      const staleArchiveRepository = {
        ...base,
        async deleteTeamInvite(
          workspaceId: string,
          inviteId: string,
          expected?: { updatedAt: string; status: "pending" | "accepted" | "revoked" }
        ) {
          archiveStarted();
          await archiveGate;
          return base.deleteTeamInvite(workspaceId, inviteId, expected);
        }
      };
      const deletingInvite = createCompanyService(staleArchiveRepository)
        .deleteTeamInvite("workspace_a", archiveInvite.id);
      await archiveObserved;
      await setup.acceptTeamInvite(archiveInvite.code, { acceptedByProfileId: "account_acceptor" });
      releaseArchive();
      await expect(deletingInvite).rejects.toThrow("INVITE_STALE");
      expect(await base.findTeamInviteByCode(archiveInvite.code)).toMatchObject({ status: "accepted" });
    });
  });

  it("rejects an acceptance snapshot made stale by committed area archival and retries without archived refs", async () => {
    await withPostgresSchema(async (pool) => {
      const repository = createConfiguredPostgresRepositoryBundle(pool, "relational").companyRepository;
      const setup = createCompanyService(repository);
      const area = await setup.createArea("workspace_a", { name: "Area removida" });
      const role = await setup.createRoleTemplate("workspace_a", { areaId: area.id, name: "Cargo removido" });
      const invite = await setup.createTeamInvite("workspace_a", {
        name: "Pessoa", role: "employee", areaId: area.id, roleTemplateId: role.id,
        accessScope: "assigned_only", createdByProfileId: "account_owner"
      });

      let acceptanceStarted!: () => void;
      let releaseAcceptance!: () => void;
      const acceptanceObserved = new Promise<void>((resolve) => { acceptanceStarted = resolve; });
      const acceptanceGate = new Promise<void>((resolve) => { releaseAcceptance = resolve; });
      const delayedRepository = {
        ...repository,
        async acceptTeamInviteAtomically(
          snapshot: Parameters<NonNullable<typeof repository.acceptTeamInviteAtomically>>[0],
          member: Parameters<NonNullable<typeof repository.acceptTeamInviteAtomically>>[1]
        ) {
          acceptanceStarted();
          await acceptanceGate;
          return repository.acceptTeamInviteAtomically!(snapshot, member);
        }
      };
      const accepting = createCompanyService(delayedRepository).acceptTeamInvite(invite.code, {
        acceptedByProfileId: "account_acceptor"
      });
      await acceptanceObserved;
      await createAreaLifecycleService(createConfiguredPostgresRepositoryBundle(pool, "relational").areaLifecycleRepository)
        .archive("workspace_a", area.id, "account_owner", { strategy: "unassign" });
      releaseAcceptance();
      await expect(accepting).rejects.toThrow("INVITE_STALE");
      expect((await pool.query("SELECT id FROM people WHERE workspace_id=$1", ["workspace_a"])).rows).toEqual([]);

      const retried = await setup.acceptTeamInvite(invite.code, { acceptedByProfileId: "account_acceptor" });
      expect(retried.person).toMatchObject({ areaId: null, roleTemplateId: null });
      const archivedReferences = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::int count FROM people p
         LEFT JOIN areas a ON a.workspace_id=p.workspace_id AND a.id=p.area_id
         LEFT JOIN role_templates r ON r.workspace_id=p.workspace_id AND r.id=p.role_template_id
         WHERE p.workspace_id=$1 AND ((p.area_id IS NOT NULL AND a.archived_at IS NOT NULL)
           OR (p.role_template_id IS NOT NULL AND r.archived_at IS NOT NULL))`,
        ["workspace_a"]
      );
      expect(archivedReferences.rows[0]?.count).toBe(0);
    });
  });

  it("creates process history atomically and rolls back the whole create on audit failure", async () => {
    await withPostgresSchema(async (pool) => {
      const bundle = createConfiguredPostgresRepositoryBundle(pool, "relational");
      const service = createProcessService(bundle.processRepository);
      const process = await service.createProcess("workspace_a", "account_owner", {
        title: "Fechamento", body: "Conferir caixa"
      });
      expect(process.currentVersion).toMatchObject({ processId: process.id, version: 1 });
      const versioned = await service.createProcessVersion("workspace_a", process.id, "account_owner", {
        body: "Conferir caixa e comprovantes", changeNote: "Comprovantes"
      });
      expect(versioned.versions).toHaveLength(2);
      await service.deleteProcess("workspace_a", process.id);
      expect(await bundle.processRepository.findProcess("workspace_a", process.id)).toBeNull();
      expect((await pool.query("select id from process_versions where workspace_id=$1 and process_id=$2", ["workspace_a", process.id])).rows).toHaveLength(2);

      const failingPool = failOnQuery(pool, "INSERT INTO operational_audit_log", "PROCESS_AUDIT_FAILURE");
      const failingBundle = createRelationalOperationalRepositoryBundle(failingPool, createPostgresRepositoryBundle(pool).companyRepository);
      await expect(createProcessService(failingBundle.processRepository!).createProcess(
        "workspace_rollback", "account_owner", { title: "Rollback", body: "Nao persistir" }
      )).rejects.toThrow("PROCESS_AUDIT_FAILURE");
      const rolledBack = await pool.query<{ processes: number; versions: number }>(
        `select
          (select count(*)::int from processes where workspace_id='workspace_rollback') processes,
          (select count(*)::int from process_versions where workspace_id='workspace_rollback') versions`
      );
      expect(rolledBack.rows[0]).toEqual({ processes: 0, versions: 0 });
    });
  });

  it("round-trips task state and replaces active checklist and evidence projections", async () => {
    await withPostgresSchema(async (pool) => {
      const repository = createConfiguredPostgresRepositoryBundle(pool, "relational").routineRepository;
      const created = await repository.createTaskOccurrence({
        workspaceId: "workspace_a", origin: "manual", routineId: null, taskTemplateId: null,
        title: "Tarefa historica", areaNameSnapshot: "Area antiga", routineTitleSnapshot: "Rotina antiga",
        stepTitleSnapshot: "Etapa antiga", routineRevisionSnapshot: null, areaId: null, processId: null,
        assigneeProfileId: "account_owner", dueHint: "Ate 10h", approvalMode: "approval_required",
        evidencePolicy: "photo_or_comment_required", checklistItems: [{ title: "Primeiro", done: true }],
        status: "awaiting_approval", dueDate: "2026-07-15",
        evidence: { comment: "Comentario original", photoUrl: "https://example.com/original.jpg" },
        submittedByProfileId: "account_owner", submittedAt: "2026-07-15T12:00:00.000Z",
        reviewedByProfileId: "account_manager", reviewedAt: "2026-07-15T13:00:00.000Z",
        reviewComment: "Revisado"
      });
      expect(created).toMatchObject({
        areaNameSnapshot: "Area antiga", routineTitleSnapshot: "Rotina antiga", stepTitleSnapshot: "Etapa antiga",
        status: "awaiting_approval", submittedByProfileId: "account_owner", reviewedByProfileId: "account_manager",
        reviewComment: "Revisado", evidence: { comment: "Comentario original", photoUrl: "https://example.com/original.jpg" }
      });

      const replaced = await repository.updateTaskOccurrence({
        ...created,
        checklistItems: [{ title: "Substituido", done: false }],
        evidence: { comment: null, photoUrl: null },
        reviewComment: null
      });
      expect(replaced.checklistItems).toEqual([{ title: "Substituido", done: false }]);
      expect(replaced.evidence).toBeNull();
      expect(replaced.reviewComment).toBeNull();
      const evidenceRows = await pool.query<{ active: number; archived: number }>(
        `select count(*) filter (where archived_at is null)::int active,
          count(*) filter (where archived_at is not null)::int archived
         from task_evidence where workspace_id=$1 and task_occurrence_id=$2`,
        ["workspace_a", created.id]
      );
      expect(evidenceRows.rows[0]).toEqual({ active: 0, archived: 2 });
      expect(await repository.findTaskOccurrence("workspace_b", created.id)).toBeNull();
    });
  });

  it("preserves stable shared steps and per-step assignments through reorder and removal", async () => {
    await withPostgresSchema(async (pool) => {
      const bundle = createConfiguredPostgresRepositoryBundle(pool, "relational");
      const company = createCompanyService(bundle.companyRepository);
      const routines = createRoutineService(bundle.routineRepository);
      const firstPerson = await company.createTeamMember("workspace_a", { name: "Ana", role: "employee", createdByProfileId: "account_owner" });
      const secondPerson = await company.createTeamMember("workspace_a", { name: "Bia", role: "employee", createdByProfileId: "account_owner" });
      const routine = await routines.createRoutine("workspace_a", "account_owner", {
        title: "Abertura", executionMode: "shared", taskTemplates: [
          { title: "Portas", assigneeProfileId: firstPerson.id },
          { title: "Luzes", assigneeProfileId: secondPerson.id },
          { title: "Caixa", assigneeProfileId: firstPerson.id }
        ]
      });
      const byTitle = Object.fromEntries(routine.taskTemplates.map((step) => [step.title, step]));
      const caixa = byTitle.Caixa!;
      const portas = byTitle.Portas!;
      const luzes = byTitle.Luzes!;
      const updated = await routines.updateRoutine("workspace_a", routine.id, {
        title: "Abertura", executionMode: "shared", taskTemplates: [
          { id: caixa.id, title: "Caixa", assigneeProfileId: firstPerson.id },
          { id: portas.id, title: "Portas", assigneeProfileId: secondPerson.id }
        ]
      });
      expect(updated.taskTemplates.map((step) => step.id)).toEqual([caixa.id, portas.id]);
      expect(updated.taskTemplates.map((step) => step.assigneeProfileId)).toEqual([firstPerson.id, secondPerson.id]);
      const steps = await pool.query<{ id: string; archived_at: Date | null }>(
        "select id,archived_at from routine_steps where workspace_id=$1 and routine_id=$2 order by id", ["workspace_a", routine.id]
      );
      expect(steps.rows.find((step) => step.id === luzes.id)?.archived_at).not.toBeNull();
      expect(steps.rows.find((step) => step.id === caixa.id)?.archived_at).toBeNull();
      const generated = await routines.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-16");
      expect(generated.map((task) => task.taskTemplateId).sort()).toEqual([caixa.id, portas.id].sort());
    });
  });

  it("persists relational submit, return, resubmit, and approval state", async () => {
    await withPostgresSchema(async (pool) => {
      const repository = createConfiguredPostgresRepositoryBundle(pool, "relational").routineRepository;
      const service = createRoutineService(repository);
      const task = await service.createManualTask("workspace_a", "account_owner", {
        title: "Aprovar fechamento", dueDate: "2026-07-16",
        approvalMode: "approval_required", evidencePolicy: "comment_required"
      });
      expect((await service.submitTask("workspace_a", task.id, "account_owner", { comment: "Primeira" })).status).toBe("awaiting_approval");
      const returned = await service.returnTask("workspace_a", task.id, "account_manager", { comment: "Ajustar" });
      expect(returned).toMatchObject({ status: "needs_adjustment", reviewedByProfileId: "account_manager", reviewComment: "Ajustar" });
      expect((await service.submitTask("workspace_a", task.id, "account_owner", { comment: "Segunda" })).status).toBe("awaiting_approval");
      const approved = await service.approveTask("workspace_a", task.id, "account_manager");
      expect(approved).toMatchObject({ status: "completed", reviewedByProfileId: "account_manager", evidence: { comment: "Segunda" } });
      const evidence = await pool.query<{ active: number; archived: number }>(
        `select count(*) filter (where archived_at is null)::int active,
          count(*) filter (where archived_at is not null)::int archived
         from task_evidence where workspace_id=$1 and task_occurrence_id=$2`, ["workspace_a", task.id]
      );
      expect(evidence.rows[0]).toEqual({ active: 1, archived: 1 });
      const audits = await pool.query<{ action: string; actor_profile_id: string | null }>(
        `select action,actor_profile_id from operational_audit_log
         where workspace_id=$1 and entity_type='task_occurrence' and entity_id=$2
         order by created_at,id`, ["workspace_a", task.id]
      );
      expect(audits.rows).toEqual([
        { action: "create", actor_profile_id: null },
        { action: "submit", actor_profile_id: "account_owner" },
        { action: "return", actor_profile_id: "account_manager" },
        { action: "submit", actor_profile_id: "account_owner" },
        { action: "approve", actor_profile_id: "account_manager" }
      ]);
    });
  });

  it("rejects stale concurrent checklist/submit and approve/return task mutations", async () => {
    await withPostgresSchema(async (pool) => {
      const base = createConfiguredPostgresRepositoryBundle(pool, "relational").routineRepository;
      const setup = createRoutineService(base);
      const checklistTask = await setup.createManualTask("workspace_a", "account_owner", {
        title: "Concorrente", dueDate: "2026-07-22", checklistItems: ["Original"]
      });
      const concurrentService = createRoutineService(barrierRoutineRepository(base));
      const checklistSubmit = await Promise.allSettled([
        concurrentService.updateTaskChecklist("workspace_a", checklistTask.id, "account_owner", {
          checklistItems: [{ title: "Alterado", done: true }]
        }),
        concurrentService.submitTask("workspace_a", checklistTask.id, "account_owner", { comment: "Enviado" })
      ]);
      expect(checklistSubmit.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(rejectionMessages(checklistSubmit)).toEqual(["TASK_OCCURRENCE_STALE"]);
      const checklistFinal = await base.findTaskOccurrence("workspace_a", checklistTask.id);
      if (checklistFinal?.status === "completed") {
        expect(checklistFinal.checklistItems).toEqual([{ title: "Original", done: false }]);
      } else {
        expect(checklistFinal).toMatchObject({
          status: "pending",
          checklistItems: [{ title: "Alterado", done: true }],
          submittedByProfileId: null
        });
      }

      const reviewTask = await setup.createManualTask("workspace_a", "account_owner", {
        title: "Revisao concorrente", dueDate: "2026-07-22", approvalMode: "approval_required"
      });
      await setup.submitTask("workspace_a", reviewTask.id, "account_owner", {});
      const reviewService = createRoutineService(barrierRoutineRepository(base));
      const reviewResults = await Promise.allSettled([
        reviewService.approveTask("workspace_a", reviewTask.id, "reviewer_approve"),
        reviewService.returnTask("workspace_a", reviewTask.id, "reviewer_return", { comment: "Ajustar" })
      ]);
      expect(reviewResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(rejectionMessages(reviewResults)).toEqual(["TASK_OCCURRENCE_STALE"]);
      const reviewFinal = await base.findTaskOccurrence("workspace_a", reviewTask.id);
      expect(["completed", "needs_adjustment"]).toContain(reviewFinal?.status);
      expect(["reviewer_approve", "reviewer_return"]).toContain(reviewFinal?.reviewedByProfileId);
    });
  });

  it("serializes concurrent process versions and publish/version transitions", async () => {
    await withPostgresSchema(async (pool) => {
      const base = createConfiguredPostgresRepositoryBundle(pool, "relational").processRepository;
      const setup = createProcessService(base);
      const process = await setup.createProcess("workspace_a", "account_owner", {
        title: "Concorrencia", body: "Versao inicial"
      });
      const versionService = createProcessService(barrierProcessRepository(base));
      const versionResults = await Promise.allSettled([
        versionService.createProcessVersion("workspace_a", process.id, "editor_a", {
          body: "Versao A", changeNote: "A"
        }),
        versionService.createProcessVersion("workspace_a", process.id, "editor_b", {
          body: "Versao B", changeNote: "B"
        })
      ]);
      expect(versionResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(rejectionMessages(versionResults)).toEqual(["PROCESS_STALE"]);
      expect((await base.findProcess("workspace_a", process.id))?.versions).toHaveLength(2);

      const transition = await setup.createProcess("workspace_a", "account_owner", {
        title: "Publicacao", body: "Inicial"
      });
      const transitionService = createProcessService(barrierProcessRepository(base));
      const transitionResults = await Promise.allSettled([
        transitionService.publishProcess("workspace_a", transition.id),
        transitionService.createProcessVersion("workspace_a", transition.id, "editor", {
          body: "Nova versao", changeNote: "Mudanca"
        })
      ]);
      expect(transitionResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(rejectionMessages(transitionResults)).toEqual(["PROCESS_STALE"]);
      const final = await base.findProcess("workspace_a", transition.id);
      expect([
        { status: "published", version: 1 },
        { status: "draft", version: 2 }
      ]).toContainEqual({ status: final?.status, version: final?.currentVersion.version });
    });
  });

  it("rejects one concurrent whole-routine edit without mixing steps or assignments", async () => {
    await withPostgresSchema(async (pool) => {
      const bundle = createConfiguredPostgresRepositoryBundle(pool, "relational");
      const company = createCompanyService(bundle.companyRepository);
      const [personA, personB] = await Promise.all([
        company.createTeamMember("workspace_a", {
          name: "Pessoa A", role: "employee", createdByProfileId: "account_owner"
        }),
        company.createTeamMember("workspace_a", {
          name: "Pessoa B", role: "employee", createdByProfileId: "account_owner"
        })
      ]);
      const base = bundle.routineRepository;
      const setup = createRoutineService(base);
      const routine = await setup.createRoutine("workspace_a", "account_owner", {
        title: "Original", assigneeProfileIds: [personA.id],
        taskTemplates: [{ title: "Etapa original", assigneeProfileId: personA.id }]
      });
      const concurrent = createRoutineService(barrierRoutineAggregateRepository(base));
      const results = await Promise.allSettled([
        concurrent.updateRoutine("workspace_a", routine.id, {
          title: "Edicao A", assigneeProfileIds: [personA.id],
          taskTemplates: [{ id: routine.taskTemplates[0]!.id, title: "Etapa A", assigneeProfileId: personA.id }]
        }),
        concurrent.updateRoutine("workspace_a", routine.id, {
          title: "Edicao B", assigneeProfileIds: [personB.id],
          taskTemplates: [{ id: routine.taskTemplates[0]!.id, title: "Etapa B", assigneeProfileId: personB.id }]
        })
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(rejectionMessages(results)).toEqual(["ROUTINE_STALE"]);
      const final = await base.findRoutine("workspace_a", routine.id);
      expect([
        { title: "Edicao A", stepTitle: "Etapa A", generalAssignee: personA.id, stepAssignee: personA.id },
        { title: "Edicao B", stepTitle: "Etapa B", generalAssignee: personB.id, stepAssignee: personB.id }
      ]).toContainEqual({
        title: final?.title,
        stepTitle: final?.taskTemplates[0]?.title,
        generalAssignee: final?.assigneeProfileIds?.[0],
        stepAssignee: final?.taskTemplates[0]?.assigneeProfileId
      });
      expect(final?.taskTemplates).toHaveLength(1);
    });
  });

  it("rolls back failed atomic generation, remains concurrent-idempotent, and reconciles pending revisions", async () => {
    await withPostgresSchema(async (pool) => {
      const bundle = createConfiguredPostgresRepositoryBundle(pool, "relational");
      const base = bundle.routineRepository;
      const routineService = createRoutineService(base);
      const routine = await routineService.createRoutine("workspace_a", "account_owner", {
        title: "Checklist", taskTemplates: [{ title: "Um" }, { title: "Dois" }]
      });
      const failingBundle = createConfiguredPostgresRepositoryBundle(
        failOnQuery(pool, "INSERT INTO routine_occurrences", "INJECTED_ATOMIC_FAILURE"),
        "relational"
      );
      const failingService = createRoutineService(failingBundle.routineRepository);
      await expect(failingService.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-17"))
        .rejects.toThrow("INJECTED_ATOMIC_FAILURE");
      expect(await base.listTaskOccurrences("workspace_a", { dueDate: "2026-07-17" })).toEqual([]);
      const recovered = await routineService.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-17");
      expect(recovered).toHaveLength(2);
      expect(recovered.every((task) => task.routineRevisionSnapshot === routine.updatedAt)).toBe(true);

      const concurrent = await Promise.all([
        routineService.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-20"),
        routineService.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-20")
      ]);
      expect(new Set(concurrent.flat().map((task) => task.id)).size).toBe(2);
      const retained = concurrent[0]!.find((task) => task.title === "Um");
      expect(retained).toBeDefined();
      const revised = await routineService.updateRoutine("workspace_a", routine.id, {
        title: "Checklist novo", taskTemplates: [{ id: routine.taskTemplates[0]!.id, title: "Um novo" }]
      });
      const reconciled = await routineService.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-20");
      expect(reconciled).toEqual([expect.objectContaining({
        id: retained!.id,
        title: "Um novo",
        routineTitleSnapshot: "Checklist novo",
        routineRevisionSnapshot: revised.updatedAt,
        status: "pending"
      })]);
    });
  });
});

function failOnQuery(pool: Pool, needle: string, message: string): OperationalPool {
  return {
    query: pool.query.bind(pool) as OperationalPool["query"],
    async connect() {
      const client = await pool.connect();
      return {
        query(text, params) {
          if (text.includes(needle)) throw new Error(message);
          return client.query(text, params) as never;
        },
        release: () => client.release()
      };
    }
  };
}

function trackPostgresSchemaLocks(pool: Pool, onLock: () => void) {
  return {
    query: pool.query.bind(pool),
    async connect() {
      const client = await pool.connect();
      return {
        query<T = unknown>(query: string, params?: unknown[]) {
          if (query.includes("pg_advisory_xact_lock")) onLock();
          return client.query(query, params) as unknown as Promise<{ rows: T[] }>;
        },
        release: () => client.release()
      };
    }
  };
}

function barrierPostgresInviteMigration(
  pool: Pool,
  onRead: () => void,
  gate: Promise<void>
) {
  let intercepted = false;
  const intercept = async <T>(query: string, run: () => Promise<{ rows: T[] }>) => {
    const result = await run();
    if (!intercepted && query.includes("SELECT workspace_id, id, data FROM baase_records")) {
      intercepted = true;
      onRead();
      await gate;
    }
    return result;
  };
  return {
    query<T = unknown>(query: string, params?: unknown[]) {
      return intercept(query, () => pool.query(query, params) as unknown as Promise<{ rows: T[] }>);
    },
    async connect() {
      const client = await pool.connect();
      return {
        query<T = unknown>(query: string, params?: unknown[]) {
          return intercept(query, () => client.query(query, params) as unknown as Promise<{ rows: T[] }>);
        },
        release: () => client.release()
      };
    }
  };
}

function barrierRoutineRepository(base: RoutineRepository): RoutineRepository {
  let reads = 0;
  let releaseReads!: () => void;
  const gate = new Promise<void>((resolve) => { releaseReads = resolve; });
  return {
    ...base,
    async findTaskOccurrence(workspaceId, taskId) {
      const task = await base.findTaskOccurrence(workspaceId, taskId);
      reads += 1;
      if (reads === 2) releaseReads();
      await gate;
      return task;
    }
  };
}

function barrierRoutineAggregateRepository(base: RoutineRepository): RoutineRepository {
  let reads = 0;
  let releaseReads!: () => void;
  const gate = new Promise<void>((resolve) => { releaseReads = resolve; });
  return {
    ...base,
    async findRoutine(workspaceId, routineId) {
      const routine = await base.findRoutine(workspaceId, routineId);
      reads += 1;
      if (reads === 2) releaseReads();
      await gate;
      return routine;
    }
  };
}

function barrierProcessRepository(base: ProcessRepository): ProcessRepository {
  let reads = 0;
  let releaseReads!: () => void;
  const gate = new Promise<void>((resolve) => { releaseReads = resolve; });
  return {
    ...base,
    async findProcess(workspaceId, processId) {
      const process = await base.findProcess(workspaceId, processId);
      reads += 1;
      if (reads === 2) releaseReads();
      await gate;
      return process;
    }
  };
}

function rejectionMessages(results: PromiseSettledResult<unknown>[]) {
  return results.flatMap((result) => result.status === "rejected" && result.reason instanceof Error
    ? [result.reason.message]
    : []);
}
