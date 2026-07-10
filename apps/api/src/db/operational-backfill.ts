import { attachCleanupError } from "./migration-cleanup-errors";
import { parseLegacyWorkspace } from "./operational-backfill/legacy-parse";
import { readTargetCounts, reconcileWorkspace } from "./operational-backfill/reconcile";
import {
  emptyEntityCounts,
  entityTables,
  type ConflictingRecord,
  type EntityCounts,
  type LegacyRow,
  type MalformedRecord,
  type OperationalBackfillPool,
  type OperationalBackfillReport,
  type OrphanReference,
  type SkippedRecord
} from "./operational-backfill/types";
import { buildWorkspacePlan } from "./operational-backfill/workspace-plan";
import { persistWorkspacePlan } from "./operational-backfill/workspace-persist";

export type {
  ConflictingRecord,
  MalformedRecord,
  OperationalBackfillClient,
  OperationalBackfillPool,
  OperationalBackfillReport
} from "./operational-backfill/types";

const coordinatorLock = [1111574853, 1869636979];

export async function backfillOperationalData(
  pool: OperationalBackfillPool
): Promise<OperationalBackfillReport> {
  const client = await pool.connect();
  let primaryError: unknown;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", coordinatorLock);
    await client.query("LOCK TABLE baase_records IN SHARE MODE");
    const workspaceResult = await client.query<{ workspace_id: string }>(
      `select distinct workspace_id
       from baase_records
       where kind in ($1, $2, $3, $4, $5, $6)
       order by workspace_id`,
      ["area", "role_template", "team_member", "process", "routine", "task_occurrence"]
    );

    const sourceCounts = emptyEntityCounts();
    const expectedCounts = emptyEntityCounts();
    const orphanReferences: OrphanReference[] = [];
    const skippedRecords: SkippedRecord[] = [];
    const conflictingRecords: ConflictingRecord[] = [];
    const malformedRecords: MalformedRecord[] = [];
    let insertedTotal = 0;

    for (const { workspace_id: workspaceId } of workspaceResult.rows) {
      await client.query("SAVEPOINT operational_workspace");
      try {
        const sourceRows = await client.query<LegacyRow>(
          `select kind, workspace_id, id, data, created_at, updated_at
           from baase_records
           where workspace_id = $1
             and kind in ($2, $3, $4, $5, $6, $7)
           order by
             case kind
               when 'area' then 1
               when 'role_template' then 2
               when 'team_member' then 3
               when 'process' then 4
               when 'routine' then 5
               when 'task_occurrence' then 6
             end,
             created_at,
             id`,
          [workspaceId, "area", "role_template", "team_member", "process", "routine", "task_occurrence"]
        );
        const parsed = parseLegacyWorkspace(workspaceId, sourceRows.rows);
        const plan = buildWorkspacePlan(workspaceId, parsed);
        insertedTotal += await persistWorkspacePlan(client, plan);
        conflictingRecords.push(...plan.conflictingRecords, ...await reconcileWorkspace(client, plan));
        malformedRecords.push(...plan.malformedRecords);
        orphanReferences.push(...plan.orphanReferences);
        skippedRecords.push(...plan.skippedRecords);
        addCounts(sourceCounts, plan.sourceCounts);
        for (const table of entityTables) expectedCounts[table] += plan.rows[table].length;
        await client.query("RELEASE SAVEPOINT operational_workspace");
      } catch (error) {
        try {
          await client.query("ROLLBACK TO SAVEPOINT operational_workspace");
        } catch (cleanupError) {
          attachCleanupError(error, cleanupError);
        }
        throw error;
      }
    }

    const targetCounts = await readTargetCounts(client);
    const countsMatch = entityTables.every((table) => targetCounts[table] === expectedCounts[table]);
    const report: OperationalBackfillReport = {
      sourceCounts,
      targetCounts,
      insertedTotal,
      orphanReferences: sortOrphans(orphanReferences).map(({ workspaceId: _workspaceId, ...item }) => item),
      skippedRecords: sortSkipped(skippedRecords).map(({ workspaceId: _workspaceId, table: _table, ...item }) => item),
      conflictingRecords: sortConflicts(conflictingRecords),
      malformedRecords: sortMalformed(malformedRecords),
      reconciled: countsMatch && conflictingRecords.length === 0 && malformedRecords.length === 0
    };
    await client.query("COMMIT");
    return report;
  } catch (error) {
    primaryError = error;
    try {
      await client.query("ROLLBACK");
    } catch (cleanupError) {
      attachCleanupError(error, cleanupError);
    }
    throw error;
  } finally {
    try {
      client.release();
    } catch (cleanupError) {
      if (primaryError) attachCleanupError(primaryError, cleanupError);
      else throw cleanupError;
    }
  }
}

function addCounts(target: EntityCounts, source: EntityCounts) {
  for (const table of entityTables) target[table] += source[table];
}

function sortOrphans(items: OrphanReference[]) {
  return [...items].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId)
    || left.entityType.localeCompare(right.entityType)
    || left.entityId.localeCompare(right.entityId)
    || left.field.localeCompare(right.field)
    || left.legacyValue.localeCompare(right.legacyValue));
}

function sortSkipped(items: SkippedRecord[]) {
  return [...items].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId)
    || left.entityType.localeCompare(right.entityType)
    || left.entityId.localeCompare(right.entityId)
    || left.reason.localeCompare(right.reason));
}

function sortConflicts(items: ConflictingRecord[]) {
  return [...items].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId)
    || left.entityType.localeCompare(right.entityType)
    || left.key.localeCompare(right.key));
}

function sortMalformed(items: MalformedRecord[]) {
  return [...items].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId)
    || left.kind.localeCompare(right.kind)
    || left.entityId.localeCompare(right.entityId)
    || left.path.localeCompare(right.path));
}
