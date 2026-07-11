import type { EntityTable, PlannedRow, WorkspacePlan } from "./types";

type PlannerIndexes = {
  rows: Record<EntityTable, Map<string, PlannedRow>>;
  orphans: Set<string>;
  operations: number;
};

const indexesByPlan = new WeakMap<WorkspacePlan, PlannerIndexes>();

function indexes(plan: WorkspacePlan) {
  let value = indexesByPlan.get(plan);
  if (!value) {
    value = {
      rows: Object.fromEntries(Object.entries(plan.rows).map(([table, rows]) => [
        table,
        new Map((rows as PlannedRow[]).map((row) => [row.entityId, row]))
      ])) as Record<EntityTable, Map<string, PlannedRow>>,
      orphans: new Set(plan.orphanReferences.map((item) =>
        `${item.entityType}\u0000${item.entityId}\u0000${item.field}\u0000${item.legacyValue}`)),
      operations: 0
    };
    indexesByPlan.set(plan, value);
  }
  return value;
}

export function indexedRow(plan: WorkspacePlan, table: EntityTable, id: string) {
  const value = indexes(plan);
  value.operations += 1;
  return value.rows[table].get(id);
}

export function indexRow(plan: WorkspacePlan, row: PlannedRow) {
  const value = indexes(plan);
  value.operations += 1;
  value.rows[row.table].set(row.entityId, row);
}

export function indexOrphan(plan: WorkspacePlan, key: string) {
  const value = indexes(plan);
  value.operations += 1;
  if (value.orphans.has(key)) return false;
  value.orphans.add(key);
  return true;
}

export function plannerIndexOperationCount(plan: WorkspacePlan) {
  return indexes(plan).operations;
}
