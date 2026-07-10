import { canonicalJson } from "./deterministic-ids";
import { BACKFILL_BATCH_SIZE } from "./workspace-persist";
import { tableSpecs } from "./table-specs";
import {
  emptyEntityCounts,
  entityTables,
  type ConflictingRecord,
  type EntityCounts,
  type OperationalBackfillClient,
  type WorkspacePlan
} from "./types";

export async function reconcileWorkspace(
  client: OperationalBackfillClient,
  plan: WorkspacePlan
): Promise<ConflictingRecord[]> {
  const conflicts: ConflictingRecord[] = [];
  for (const table of entityTables) {
    const expectedRows = plan.rows[table];
    const spec = tableSpecs[table];
    for (let offset = 0; offset < expectedRows.length; offset += BACKFILL_BATCH_SIZE) {
      const chunk = expectedRows.slice(offset, offset + BACKFILL_BATCH_SIZE);
      const ids = chunk.map((row) => row.entityId);
      const idParams = ids.map((_, index) => `$${index + 2}`).join(", ");
      const result = await client.query<Record<string, unknown>>(
        `select ${spec.columns.join(", ")}
         from ${spec.table}
         where workspace_id = $1 and id in (${idParams})`,
        [plan.workspaceId, ...ids]
      );
      const actualById = new Map(result.rows.map((row) => [String(row.id), normalizeRecord(row, spec.columns)]));
      for (const expected of chunk) {
        const actual = actualById.get(expected.entityId);
        const canonicalExpected = normalizeRecord(expected.values, spec.columns);
        if (!actual) {
          conflicts.push({
            workspaceId: plan.workspaceId,
            entityType: expected.entityType,
            entityId: expected.entityId,
            key: `${table}:${expected.entityId}`,
            reason: "expected target row is missing",
            expected: canonicalExpected
          });
          continue;
        }
        if (canonicalJson(actual) !== canonicalJson(canonicalExpected)) {
          conflicts.push({
            workspaceId: plan.workspaceId,
            entityType: expected.entityType,
            entityId: expected.entityId,
            key: `${table}:${expected.entityId}`,
            reason: "persisted target payload differs from legacy source",
            expected: canonicalExpected,
            actual
          });
        }
      }
    }
  }
  return conflicts;
}

export async function readTargetCounts(client: OperationalBackfillClient): Promise<EntityCounts> {
  const result = await client.query<Record<string, number>>(
    `select
      (select count(*)::int from areas) as areas,
      (select count(*)::int from role_templates) as role_templates,
      (select count(*)::int from people) as people,
      (select count(*)::int from processes) as processes,
      (select count(*)::int from process_versions) as process_versions,
      (select count(*)::int from routines) as routines,
      (select count(*)::int from routine_steps) as routine_steps,
      (select count(*)::int from routine_assignments) as routine_assignments,
      (select count(*)::int from routine_occurrences) as routine_occurrences,
      (select count(*)::int from task_occurrences) as task_occurrences,
      (select count(*)::int from task_checklist_items) as task_checklist_items,
      (select count(*)::int from task_evidence) as task_evidence,
      (select count(*)::int from operational_audit_log
       where action = 'legacy_reference_unresolved') as operational_audit_log`
  );
  const counts = emptyEntityCounts();
  const row = result.rows[0] ?? {};
  for (const table of entityTables) counts[table] = Number(row[table] ?? 0);
  return counts;
}

export function expectedTargetCounts(plans: WorkspacePlan[]): EntityCounts {
  const counts = emptyEntityCounts();
  for (const plan of plans) {
    for (const table of entityTables) counts[table] += plan.rows[table].length;
  }
  return counts;
}

function normalizeRecord(record: Record<string, unknown>, columns: readonly string[]) {
  return Object.fromEntries(columns.map((column) => [column, normalizeValue(record[column], column)]));
}

function normalizeValue(value: unknown, column: string): unknown {
  if (value instanceof Date) {
    if (column === "due_date") return value.toISOString().slice(0, 10);
    return value.toISOString();
  }
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, column));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeValue(item, key)]));
  }
  return value;
}
