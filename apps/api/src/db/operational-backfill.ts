import { attachCleanupError } from "./migration-cleanup-errors";
import { DiagnosticCollector } from "./operational-backfill/diagnostics";
import { parseLegacyWorkspace, type ParsedLegacyWorkspace } from "./operational-backfill/legacy-parse";
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
  type SkippedRecord,
  type WorkspacePlan,
  type WorkspaceReferences
} from "./operational-backfill/types";
import { buildWorkspacePlan } from "./operational-backfill/workspace-plan";
import { persistWorkspacePlan } from "./operational-backfill/workspace-persist";
import {
  loadRoutineStepReferencePage,
  loadWorkspaceReferences
} from "./operational-backfill/workspace-references";

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
    const diagnostics = new DiagnosticCollector();
    const expansionCounts = emptyExpansionCounts();
    let insertedTotal = 0;

    for (const { workspace_id: workspaceId } of workspaceResult.rows) {
      await client.query("SAVEPOINT operational_workspace");
      try {
        await clearRoutineOccurrenceStage(client, workspaceId);
        const consumePlan = async (plan: WorkspacePlan, stageTaskContributions: boolean) => {
          if (stageTaskContributions) {
            await stageRoutineOccurrenceContributions(
              client,
              workspaceId,
              plan.routineOccurrenceContributions
            );
            plan.rows.routine_occurrences = [];
            plan.sourceCounts.routine_occurrences = 0;
            const retained = plan.conflictingRecords.filter((item) => !isStagedConflict(item));
            plan.diagnosticTotals.conflictingRecords -= plan.stagedConflictTotal;
            plan.conflictingRecords = retained;
          }
          insertedTotal += await persistWorkspacePlan(client, plan);
          diagnostics.add("conflictingRecords", conflictingRecords, plan.conflictingRecords,
            plan.diagnosticTotals.conflictingRecords);
          const reconcileConflicts = await reconcileWorkspace(client, plan);
          diagnostics.add("conflictingRecords", conflictingRecords, reconcileConflicts);
          diagnostics.add("malformedRecords", malformedRecords, plan.malformedRecords,
            plan.diagnosticTotals.malformedRecords);
          diagnostics.add("orphanReferences", orphanReferences, plan.orphanReferences,
            plan.diagnosticTotals.orphanReferences);
          diagnostics.add("skippedRecords", skippedRecords, plan.skippedRecords,
            plan.diagnosticTotals.skippedRecords);
          addCounts(sourceCounts, plan.sourceCounts);
          addExpansionCounts(expansionCounts, plan.expansionCounts);
          for (const table of entityTables) expectedCounts[table] += plan.rows[table].length;
        };
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
            if (kind !== "task_occurrence") {
              await consumePlan(buildWorkspacePlan(workspaceId, parsed, references), false);
            } else {
              const individualRows = parsed.validRows.filter((row) =>
                isIndividualAggregate(row, references));
              const regularParsed: ParsedLegacyWorkspace = {
                ...parsed,
                validRows: parsed.validRows.filter((row) => !individualRows.includes(row))
              };
              await consumePlan(buildWorkspacePlan(workspaceId, regularParsed, references), true);
              for (const row of individualRows) {
                await expandIndividualAggregate(
                  client,
                  workspaceId,
                  row,
                  references,
                  consumePlan
                );
              }
            }
            cursor = sourceRows.rows.at(-1)?.id ?? null;
            if (sourceRows.rows.length < SOURCE_PAGE_SIZE) break;
          }
        }
        const finalized = await finalizeRoutineOccurrenceStage(client, workspaceId, async (plan) => {
          insertedTotal += await persistWorkspacePlan(client, plan);
          diagnostics.add("conflictingRecords", conflictingRecords, await reconcileWorkspace(client, plan));
          expectedCounts.routine_occurrences += plan.rows.routine_occurrences.length;
        });
        sourceCounts.routine_occurrences += finalized.sourceCount;
        diagnostics.add("conflictingRecords", conflictingRecords, finalized.conflicts, finalized.conflictTotal);
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
    const diagnosticSamples = { orphanReferences, skippedRecords, conflictingRecords, malformedRecords };
    const report: OperationalBackfillReport = {
      sourceCounts,
      targetCounts,
      insertedTotal,
      orphanReferences: sortOrphans(orphanReferences).map(({ workspaceId: _workspaceId, ...item }) => item),
      skippedRecords: sortSkipped(skippedRecords).map(({ workspaceId: _workspaceId, table: _table, ...item }) => item),
      conflictingRecords: sortConflicts(conflictingRecords),
      malformedRecords: sortMalformed(malformedRecords),
      expansionCounts,
      diagnostics: diagnostics.metadata(diagnosticSamples),
      reconciled: countsMatch
        && diagnostics.totals.conflictingRecords === 0
        && diagnostics.totals.malformedRecords === 0
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

async function expandIndividualAggregate(
  client: Parameters<typeof loadRoutineStepReferencePage>[0],
  workspaceId: string,
  row: ParsedLegacyWorkspace["validRows"][number],
  baseReferences: WorkspaceReferences,
  consumePlan: (plan: WorkspacePlan, stageTaskContributions: boolean) => Promise<void>
) {
  const routineId = String(row.data.routineId);
  const parsed: ParsedLegacyWorkspace = {
    validRows: [row],
    malformedRecords: [],
    malformedTotal: 0,
    sourceCounts: emptyEntityCounts()
  };
  let cursor: Parameters<typeof loadRoutineStepReferencePage>[3] = null;
  let totalSteps: number | undefined;
  let stepOffset = 0;
  let matchedChecklistItems = 0;
  while (true) {
    const referencePage = await loadRoutineStepReferencePage(
      client,
      workspaceId,
      routineId,
      cursor,
      totalSteps
    );
    totalSteps = referencePage.totalSteps;
    if (referencePage.steps.length === 0) {
      if (stepOffset === 0) {
        await consumePlan(buildWorkspacePlan(workspaceId, parsed, {
          ...baseReferences,
          routineSteps: []
        }), true);
      }
      break;
    }
    const pageState = {
      stepOffset,
      totalSteps,
      isFirstPage: stepOffset === 0,
      isLastPage: stepOffset + referencePage.steps.length >= totalSteps,
      matchedChecklistItems
    };
    const plan = buildWorkspacePlan(workspaceId, parsed, {
      ...baseReferences,
      processIds: new Set([...baseReferences.processIds, ...referencePage.processIds]),
      routineSteps: referencePage.steps
    }, { individualExpansionPage: pageState });
    matchedChecklistItems = pageState.matchedChecklistItems;
    await consumePlan(plan, true);
    stepOffset += referencePage.steps.length;
    if (pageState.isLastPage) break;
    cursor = referencePage.nextCursor;
  }
}

function isIndividualAggregate(
  row: ParsedLegacyWorkspace["validRows"][number],
  references: WorkspaceReferences
) {
  const routineId = typeof row.data.routineId === "string" ? row.data.routineId : null;
  const assigneeProfileId = typeof row.data.assigneeProfileId === "string"
    ? row.data.assigneeProfileId
    : null;
  const stepId = typeof row.data.taskTemplateId === "string"
    ? row.data.taskTemplateId
    : typeof row.data.routineStepId === "string" ? row.data.routineStepId : null;
  const routine = routineId ? references.routines.get(routineId) : undefined;
  return Boolean(routineId
    && assigneeProfileId
    && routine?.values.execution_mode === "individual"
    && stepId === `${routineId}__execution__${assigneeProfileId}`);
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
