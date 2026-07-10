import { canonicalJson } from "./deterministic-ids";
import { BACKFILL_BATCH_SIZE } from "./workspace-persist";
import { tableSpecs } from "./table-specs";
import {
  emptyEntityCounts,
  entityTables,
  type ConflictingRecord,
  type EntityCounts,
  type EntityTable,
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
      const actualById = new Map(result.rows.map((row) => [
        String(row.id),
        normalizeRecordForTable(table, row, spec.columns)
      ]));
      for (const expected of chunk) {
        const actual = actualById.get(expected.entityId);
        const canonicalExpected = normalizeRecordForTable(table, expected.values, spec.columns);
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

export function normalizeRecordForTable(
  table: EntityTable,
  record: Record<string, unknown>,
  columns: readonly string[] = Object.keys(record)
) {
  const columnTypes = tableSpecs[table].columnTypes ?? {};
  return Object.fromEntries(columns.map((column) => [
    column,
    normalizeValue(record[column], columnTypes[column])
  ]));
}

function normalizeValue(value: unknown, columnType?: "date" | "time" | "timestamp"): unknown {
  if (columnType) return normalizeTemporalValue(value, columnType);
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeValue(item)]));
  }
  return value;
}

function normalizeTemporalValue(value: unknown, columnType: "date" | "time" | "timestamp") {
  if (value === null || value === undefined) return value;
  if (columnType === "timestamp") {
    const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : value;
  }
  if (columnType === "date") {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      if (value.getUTCHours() === 0 && value.getUTCMinutes() === 0
        && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0) {
        return value.toISOString().slice(0, 10);
      }
      return [value.getFullYear(), value.getMonth() + 1, value.getDate()]
        .map((part, index) => index === 0 ? String(part).padStart(4, "0") : String(part).padStart(2, "0"))
        .join("-");
    }
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(11, 19);
  }
  if (typeof value !== "string") return value;
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(value);
  if (!match) return value;
  const fraction = (match[4] ?? "").replace(/0+$/, "");
  return `${match[1]}:${match[2]}:${match[3] ?? "00"}${fraction ? `.${fraction}` : ""}`;
}
