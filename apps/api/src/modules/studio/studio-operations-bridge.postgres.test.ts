import { DataType, newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureOperationalSchema } from "../../db/operational-schema";
import { createInMemoryAnnouncementRepository } from "../announcements/in-memory-announcement.repository";
import { createInMemoryCompanyRepository } from "../company/in-memory-company.repository";
import { createInMemoryProcessRepository } from "../processes/in-memory-process.repository";
import { createInMemoryRoutineRepository } from "../routines/in-memory-routine.repository";
import { createPostgresStudioRepository } from "./postgres-studio.repository";
import { createPostgresStudioOperationsStore, createStudioOperationsBridge } from "./studio-operations-bridge";

let db: Pool;

beforeEach(() => {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({
    name: "pg_advisory_xact_lock", args: [DataType.integer, DataType.integer], returns: DataType.integer,
    implementation: () => 1
  });
  memoryDb.public.registerFunction({
    name: "cardinality", args: [memoryDb.public.getType(DataType.text).asArray()], returns: DataType.integer,
    implementation: (value: unknown[]) => value.length
  });
  memoryDb.public.registerFunction({
    name: "array_positions", args: [memoryDb.public.getType(DataType.text).asArray(), DataType.text],
    returns: memoryDb.public.getType(DataType.integer).asArray(),
    implementation: (values: string[], target: string) => values.flatMap((value, index) => value === target ? [index + 1] : [])
  });
  memoryDb.public.registerFunction({
    name: "date_bin", args: [DataType.interval, DataType.timestamptz, DataType.timestamptz],
    returns: DataType.timestamptz, implementation: (_interval: unknown, value: Date) => value
  });
  memoryDb.public.registerFunction({
    name: "jsonb_typeof", args: [DataType.jsonb], returns: DataType.text,
    implementation: (value: unknown) => Array.isArray(value) ? "array" : value === null ? "null" : typeof value
  });
  memoryDb.public.registerOperator({
    operator: "~", left: DataType.text, right: DataType.text, returns: DataType.bool,
    implementation: (value: string, pattern: string) => new RegExp(pattern).test(value)
  });
  const { Pool } = memoryDb.adapters.createPg();
  db = new Pool();
});

afterEach(async () => db.end());

describe("Postgres Studio operations store", () => {
  it("persists the claim, one durable link, result recovery, and audit around the domain call", async () => {
    await ensureOperationalSchema(db);
    const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
    const studioRepository = createPostgresStudioRepository(db);
    const documentId = "document_operation";
    const suggestionId = "suggestion_operation";
    await db.query(
      `insert into studio_documents
        (id,workspace_id,owner_profile_id,title,body_json,body_text,capture_mode,inbox_state,status)
       values ($1,$2,$3,'Origem','{}'::jsonb,'Origem','text','reviewed','active')`,
      [documentId, scope.workspaceId, scope.ownerProfileId]
    );
    await db.query(
      `insert into studio_suggestions
        (id,workspace_id,owner_profile_id,document_id,ai_run_id,kind,payload_json,status)
       values ($1,$2,$3,$4,'run_operation','text',$5::jsonb,'pending')`,
      [suggestionId, scope.workspaceId, scope.ownerProfileId, documentId, JSON.stringify({
        facts: [], inferences: [], gaps: [], citations: [],
        proposal: {
          document_id: documentId, expected_revision: 1, title: null, body_json: {}, body_text: "Origem"
        }
      })]
    );
    const companyRepository = createInMemoryCompanyRepository({ now: () => "2026-07-14T12:00:00.000Z" });
    const area = await companyRepository.createArea({ workspaceId: scope.workspaceId, name: "Área", description: null });
    const person = await companyRepository.createTeamMember({
      workspaceId: scope.workspaceId, name: "Pessoa", email: null, role: "employee", areaId: area.id,
      roleTemplateId: null, createdByProfileId: scope.ownerProfileId
    });
    const routineRepository = createInMemoryRoutineRepository();
    const bridge = createStudioOperationsBridge({
      studioRepository,
      operationsStore: createPostgresStudioOperationsStore(db),
      companyRepository,
      routineRepository,
      processRepository: createInMemoryProcessRepository(),
      announcementRepository: createInMemoryAnnouncementRepository(),
      now: () => new Date("2026-07-14T12:00:00.000Z")
    });
    const draft = {
      resource_type: "task" as const,
      payload: {
        title: "Executar", area_id: area.id, assignee_profile_id: person.id, due_date: "2026-07-20",
        due_hint: null, approval_mode: "direct" as const, evidence_policy: "optional" as const,
        checklist_items: ["Confirmar"]
      }
    };
    const preview = await bridge.preview(scope, scope.ownerProfileId, suggestionId, draft);
    expect(await routineRepository.listTaskOccurrences(scope.workspaceId)).toHaveLength(0);

    const key = "11111111-1111-4111-8111-111111111111";
    const first = await bridge.confirm(scope, scope.ownerProfileId, preview.id, key, draft);
    const recovered = await bridge.confirm(scope, scope.ownerProfileId, preview.id, key, draft);

    expect(recovered).toEqual(first);
    expect(await routineRepository.listTaskOccurrences(scope.workspaceId)).toHaveLength(1);
    expect((await db.query("select id from studio_operation_previews")).rows).toHaveLength(1);
    expect((await db.query("select id from studio_operational_links")).rows).toHaveLength(1);
    expect(await bridge.getPreview(scope, preview.id)).toMatchObject({
      status: "confirmed", idempotencyKey: key, resultResourceId: first.resourceId
    });
    const audit = await db.query<{ action: string }>(
      "select action from operational_audit_log where entity_type in ('studio_operation_preview','studio_operational_link') order by created_at,id"
    );
    expect(audit.rows.map((row) => row.action).sort()).toEqual(["confirm", "confirm_claim", "create", "create"]);
  });
});
