import type { ParsedLegacyWorkspace } from "./legacy-parse";
import {
  emptyWorkspaceReferences,
  type JsonRecord,
  type OperationalBackfillClient,
  type PlannedRow,
  type WorkspaceReferences
} from "./types";

const REFERENCE_BATCH_SIZE = 500;

export type RoutineStepReferenceCursor = {
  sortOrder: number;
  id: string;
};

export type RoutineStepReferencePage = {
  steps: PlannedRow[];
  processIds: Set<string>;
  totalSteps: number;
  nextCursor: RoutineStepReferenceCursor | null;
};

export async function loadWorkspaceReferences(
  client: OperationalBackfillClient,
  workspaceId: string,
  parsed: ParsedLegacyWorkspace
): Promise<WorkspaceReferences> {
  const ids = collectReferenceIds(parsed);
  const references = emptyWorkspaceReferences();

  for (const row of await selectByIds(
    client,
    `select id from role_templates where workspace_id = $1 and id in (__IDS__)`,
    workspaceId,
    ids.roleTemplates
  )) references.roleTemplateIds.add(String(row.id));
  for (const row of await selectByIds(
    client,
    `select id from people where workspace_id = $1 and id in (__IDS__)`,
    workspaceId,
    ids.people
  )) references.peopleIds.add(String(row.id));
  const routineRows = await selectByIds(
    client,
    `select id, workspace_id, area_id, title, execution_mode, created_at, updated_at
     from routines where workspace_id = $1 and id in (__IDS__)`,
    workspaceId,
    ids.routines
  );
  for (const row of routineRows) {
    const id = String(row.id);
    references.routines.set(id, plannedReference("routines", "routine", id, row));
    addString(ids.areas, row.area_id);
  }
  const stepRows = await selectRoutineStepsByReference(client, workspaceId, ids.routineSteps);
  for (const row of stepRows) {
    const id = String(row.id);
    references.routineSteps.push(plannedReference("routine_steps", "routine_step", id, row));
    addString(ids.processes, row.process_id);
  }
  for (const row of await selectByIds(
    client,
    `select id, name from areas where workspace_id = $1 and id in (__IDS__)`,
    workspaceId,
    ids.areas
  )) references.areas.set(String(row.id), row);
  for (const row of await selectByIds(
    client,
    `select id from processes where workspace_id = $1 and id in (__IDS__)`,
    workspaceId,
    ids.processes
  )) references.processIds.add(String(row.id));
  return references;
}

export async function loadRoutineStepReferencePage(
  client: OperationalBackfillClient,
  workspaceId: string,
  routineId: string,
  cursor: RoutineStepReferenceCursor | null,
  knownTotalSteps?: number
): Promise<RoutineStepReferencePage> {
  let totalSteps = knownTotalSteps;
  if (totalSteps === undefined) {
    const count = await client.query<{ count: number }>(
      "select count(*)::int as count from routine_steps where workspace_id = $1 and routine_id = $2",
      [workspaceId, routineId]
    );
    totalSteps = Number(count.rows[0]?.count ?? 0);
  }
  const result = await client.query<JsonRecord>(
    `select id, workspace_id, routine_id, title, process_id, sort_order, created_at, updated_at
     from routine_steps
     where workspace_id = $1
       and routine_id = $2
       and ($3::integer is null or (sort_order, id) > ($3, $4::text))
     order by sort_order, id
     limit $5`,
    [workspaceId, routineId, cursor?.sortOrder ?? null, cursor?.id ?? null, REFERENCE_BATCH_SIZE]
  );
  const processReferences = new Set<string>();
  const steps = result.rows.map((row) => {
    addString(processReferences, row.process_id);
    const id = String(row.id);
    return plannedReference("routine_steps", "routine_step", id, row);
  });
  const processIds = new Set<string>();
  for (const row of await selectByIds(
    client,
    "select id from processes where workspace_id = $1 and id in (__IDS__)",
    workspaceId,
    processReferences
  )) processIds.add(String(row.id));
  const last = result.rows.at(-1);
  return {
    steps,
    processIds,
    totalSteps,
    nextCursor: last
      ? { sortOrder: Number(last.sort_order), id: String(last.id) }
      : null
  };
}

type ReferenceIds = {
  areas: Set<string>;
  roleTemplates: Set<string>;
  people: Set<string>;
  processes: Set<string>;
  routines: Set<string>;
  routineSteps: Array<{ routineId: string; stepId: string }>;
};

function collectReferenceIds(parsed: ParsedLegacyWorkspace): ReferenceIds {
  const ids: ReferenceIds = {
    areas: new Set(),
    roleTemplates: new Set(),
    people: new Set(),
    processes: new Set(),
    routines: new Set(),
    routineSteps: []
  };
  for (const row of parsed.validRows) {
    const data = row.data;
    addString(ids.areas, data.areaId);
    addString(ids.roleTemplates, data.roleTemplateId);
    addString(ids.roleTemplates, data.ownerRoleTemplateId);
    addString(ids.people, data.ownerProfileId);
    addString(ids.people, data.assigneeProfileId);
    addString(ids.people, data.submittedByProfileId);
    addString(ids.people, data.reviewedByProfileId);
    addString(ids.processes, data.processId);
    addString(ids.routines, data.routineId);
    const routineId = string(data.routineId);
    const routineStepId = string(data.taskTemplateId) ?? string(data.routineStepId);
    if (routineId && routineStepId) ids.routineSteps.push({ routineId, stepId: routineStepId });
    addStringArray(ids.people, data.assigneeProfileIds);
    addStringArray(ids.roleTemplates, data.assigneeRoleTemplateIds);
    for (const step of objectArray(data.taskTemplates)) {
      addString(ids.processes, step.processId);
      addString(ids.people, step.assigneeProfileId);
      addString(ids.roleTemplates, step.assigneeRoleTemplateId);
    }
    for (const item of objectArray(data.checklistItems)) addString(ids.people, item.completedByProfileId);
    for (const evidence of evidenceArray(data.evidence)) addString(ids.people, evidence.profileId);
  }
  return ids;
}

async function selectRoutineStepsByReference(
  client: OperationalBackfillClient,
  workspaceId: string,
  references: Array<{ routineId: string; stepId: string }>
) {
  const rows: JsonRecord[] = [];
  const uniqueReferences = [...new Map(references.map((item) => [
    `${item.routineId}\u0000${item.stepId}`,
    item
  ])).values()].sort((left, right) => left.routineId.localeCompare(right.routineId)
    || left.stepId.localeCompare(right.stepId));
  for (let offset = 0; offset < uniqueReferences.length; offset += REFERENCE_BATCH_SIZE) {
    const chunk = uniqueReferences.slice(offset, offset + REFERENCE_BATCH_SIZE);
    const params: unknown[] = [workspaceId];
    const pairs = chunk.map((item) => {
      params.push(item.routineId, item.stepId);
      return `(routine_id = $${params.length - 1} and id = $${params.length})`;
    });
    const result = await client.query<JsonRecord>(
      `select id, workspace_id, routine_id, title, process_id, sort_order, created_at, updated_at
       from routine_steps
       where workspace_id = $1 and (${pairs.join(" or ")})
       order by routine_id, sort_order, id`,
      params
    );
    rows.push(...result.rows);
  }
  return rows;
}

async function selectByIds(
  client: OperationalBackfillClient,
  sqlTemplate: string,
  workspaceId: string,
  ids: Set<string>
) {
  const rows: JsonRecord[] = [];
  const values = [...ids].sort();
  for (let offset = 0; offset < values.length; offset += REFERENCE_BATCH_SIZE) {
    const chunk = values.slice(offset, offset + REFERENCE_BATCH_SIZE);
    const placeholders = chunk.map((_, index) => `$${index + 2}`).join(", ");
    const result = await client.query<JsonRecord>(sqlTemplate.replace("__IDS__", placeholders), [
      workspaceId,
      ...chunk
    ]);
    rows.push(...result.rows);
  }
  return rows;
}

function plannedReference(
  table: "routines" | "routine_steps",
  entityType: "routine" | "routine_step",
  entityId: string,
  values: JsonRecord
): PlannedRow {
  return { table, entityType, entityId, values };
}

function addString(target: Set<string>, value: unknown) {
  if (typeof value === "string" && value.trim()) target.add(value);
}

function addStringArray(target: Set<string>, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const item of value) addString(target, item);
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function objectArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function evidenceArray(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return objectArray(value);
  return value && typeof value === "object" ? [value as JsonRecord] : [];
}
