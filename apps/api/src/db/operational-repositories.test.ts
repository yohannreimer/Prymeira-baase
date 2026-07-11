import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createCompanyService } from "../modules/company/company.service";
import { createProcessService } from "../modules/processes/process.service";
import { createRoutineService } from "../modules/routines/routine.service";
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
        name: "Ana", role: "employee", areaId: area.id, roleTemplateId: role.id,
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
        title: "Fechamento", body: "Fechar o caixa", areaId: area.id
      });
      const versioned = await processes.createProcessVersion("workspace_a", process.id, "account_owner", {
        body: "Fechar e conferir o caixa", changeNote: "Inclui conferencia"
      });
      expect(versioned.versions.map((version) => version.version)).toEqual([1, 2]);
      expect(versioned.currentVersion.version).toBe(2);
      await expect(relational.processRepository!.updateProcess({
        ...versioned,
        versions: versioned.versions.map((version) => version.version === 1
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
        taskTemplates: [{ title: "Abrir unidade" }]
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

      await routines.deleteTask("workspace_a", manual.id);
      expect(await relational.routineRepository!.findTaskOccurrence("workspace_a", manual.id)).toBeNull();
      const history = await pool.query<{ archived_at: Date | null; checks: number; evidence: number }>(
        `SELECT t.archived_at,
          (SELECT COUNT(*)::int FROM task_checklist_items c WHERE c.workspace_id=t.workspace_id AND c.task_occurrence_id=t.id) checks,
          (SELECT COUNT(*)::int FROM task_evidence e WHERE e.workspace_id=t.workspace_id AND e.task_occurrence_id=t.id) evidence
         FROM task_occurrences t WHERE t.workspace_id=$1 AND t.id=$2`, ["workspace_a", manual.id]
      );
      expect(history.rows[0]).toMatchObject({ checks: 1, evidence: 1 });
      expect(history.rows[0]?.archived_at).not.toBeNull();
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
});
