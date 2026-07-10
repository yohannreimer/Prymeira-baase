import { attachCleanupError } from "./migration-cleanup-errors";
import { parseLegacyWorkspace } from "./operational-backfill/legacy-parse";
import { readTargetCounts, reconcileWorkspace } from "./operational-backfill/reconcile";
import {
  clearRoutineOccurrenceStage,
  finalizeRoutineOccurrenceStage,
  initializeRoutineOccurrenceStage,
  stageRoutineOccurrenceContributions
} from "./operational-backfill/routine-occurrence-stage";
import {
  emptyEntityCounts,
  emptyExpansionCounts,
  entityTables,
  type ConflictingRecord,
  type EntityCounts,
  type LegacyRow,
  type MalformedRecord,
  type OperationalBackfillPool,
  type OperationalBackfillReport,
  type OrphanReference,
  type QueryResult,
  type SkippedRecord
} from "./operational-backfill/types";
import { buildWorkspacePlan } from "./operational-backfill/workspace-plan";
import { persistWorkspacePlan } from "./operational-backfill/workspace-persist";
import { loadWorkspaceReferences } from "./operational-backfill/workspace-references";

export type {
  ConflictingRecord,
  MalformedRecord,
  OperationalBackfillClient,
  OperationalBackfillPool,
  OperationalBackfillReport
} from "./operational-backfill/types";

const coordinatorLock = [1111574853, 1869636979];
const SOURCE_PAGE_SIZE = 500;
const legacyKinds = [
  "area",
  "role_template",
  "team_member",
  "process",
  "routine",
  "task_occurrence"
] as const;

export async function backfillOperationalData(
  pool: OperationalBackfillPool
): Promise<OperationalBackfillReport> {
  const client = await pool.connect();
  let primaryError: unknown;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", coordinatorLock);
    await client.query("LOCK TABLE baase_records IN SHARE MODE");
    await initializeRoutineOccurrenceStage(client);
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
    const expansionCounts = emptyExpansionCounts();
    let insertedTotal = 0;

    for (const { workspace_id: workspaceId } of workspaceResult.rows) {
      await client.query("SAVEPOINT operational_workspace");
      try {
        await clearRoutineOccurrenceStage(client, workspaceId);
        for (const kind of legacyKinds) {
          let cursor: string | null = null;
          while (true) {
            const sourceRows: QueryResult<LegacyRow> = await client.query<LegacyRow>(
              `select kind, workspace_id, id, data, created_at, updated_at
               from baase_records
               where workspace_id = $1
                 and kind = $2
                 and ($3::text is null or id > $3)
               order by id
               limit $4`,
              [workspaceId, kind, cursor, SOURCE_PAGE_SIZE]
            );
            if (sourceRows.rows.length === 0) break;
            const parsed = parseLegacyWorkspace(workspaceId, sourceRows.rows);
            const references = await loadWorkspaceReferences(client, workspaceId, parsed);
            const plan = buildWorkspacePlan(workspaceId, parsed, references);
            if (kind === "task_occurrence") {
              await stageRoutineOccurrenceContributions(
                client,
                workspaceId,
                plan.routineOccurrenceContributions
              );
              plan.rows.routine_occurrences = [];
              plan.sourceCounts.routine_occurrences = 0;
              plan.conflictingRecords = plan.conflictingRecords.filter((item) => !isStagedConflict(item));
            }
            insertedTotal += await persistWorkspacePlan(client, plan);
            conflictingRecords.push(...plan.conflictingRecords, ...await reconcileWorkspace(client, plan));
            malformedRecords.push(...plan.malformedRecords);
            orphanReferences.push(...plan.orphanReferences);
            skippedRecords.push(...plan.skippedRecords);
            addCounts(sourceCounts, plan.sourceCounts);
            addExpansionCounts(expansionCounts, plan.expansionCounts);
            for (const table of entityTables) expectedCounts[table] += plan.rows[table].length;
            cursor = sourceRows.rows.at(-1)?.id ?? null;
            if (sourceRows.rows.length < SOURCE_PAGE_SIZE) break;
          }
        }
        const finalized = await finalizeRoutineOccurrenceStage(client, workspaceId, async (plan) => {
          insertedTotal += await persistWorkspacePlan(client, plan);
          conflictingRecords.push(...await reconcileWorkspace(client, plan));
          expectedCounts.routine_occurrences += plan.rows.routine_occurrences.length;
        });
        sourceCounts.routine_occurrences += finalized.sourceCount;
        conflictingRecords.push(...finalized.conflicts);
        await clearRoutineOccurrenceStage(client, workspaceId);
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
      expansionCounts,
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

function addExpansionCounts(
  target: ReturnType<typeof emptyExpansionCounts>,
  source: ReturnType<typeof emptyExpansionCounts>
) {
  target.individualRoutineAggregates += source.individualRoutineAggregates;
  target.generatedTaskOccurrences += source.generatedTaskOccurrences;
  target.checklistProgressDispositions += source.checklistProgressDispositions;
}

function isStagedConflict(item: ConflictingRecord) {
  return item.reason === "routine occurrence contributors disagree on parent fields"
    || item.reason === "duplicate source routine task semantic key";
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
