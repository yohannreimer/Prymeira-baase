import { BACKFILL_BATCH_SIZE } from "./workspace-persist";
import {
  emptyEntityCounts,
  emptyExpansionCounts,
  emptyPlannedRows,
  type ConflictingRecord,
  type JsonRecord,
  type OperationalBackfillClient,
  type QueryResult,
  type RoutineOccurrenceContribution,
  type WorkspacePlan
} from "./types";

const stageTable = "operational_backfill_occurrence_stage";

export async function initializeRoutineOccurrenceStage(client: OperationalBackfillClient) {
  await client.query(
    `create temporary table if not exists operational_backfill_occurrence_stage (
      workspace_id text not null,
      parent_id text not null,
      parent_key text not null,
      source_task_id text not null,
      task_id text not null,
      task_semantic_key text not null,
      routine_id text not null,
      due_date date not null,
      audience_key text not null,
      area_name_snapshot text,
      routine_title_snapshot text not null,
      status text not null,
      completed_at timestamptz,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      primary key (workspace_id, task_id)
    )`
  );
  await client.query(`delete from ${stageTable}`);
}

export async function clearRoutineOccurrenceStage(
  client: OperationalBackfillClient,
  workspaceId: string
) {
  await client.query(`delete from ${stageTable} where workspace_id = $1`, [workspaceId]);
}

export async function stageRoutineOccurrenceContributions(
  client: OperationalBackfillClient,
  workspaceId: string,
  contributions: RoutineOccurrenceContribution[]
) {
  for (let offset = 0; offset < contributions.length; offset += BACKFILL_BATCH_SIZE) {
    const chunk = contributions.slice(offset, offset + BACKFILL_BATCH_SIZE);
    const params: unknown[] = [];
    const values = chunk.map((item) => {
      const row = [
        workspaceId,
        item.parentId,
        item.parentKey,
        item.sourceTaskId,
        item.taskId,
        item.taskSemanticKey,
        item.routineId,
        item.dueDate,
        item.audienceKey,
        item.areaNameSnapshot,
        item.routineTitleSnapshot,
        item.status,
        item.completedAt,
        item.createdAt,
        item.updatedAt
      ];
      const placeholders = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    if (values.length === 0) continue;
    await client.query(
      `insert into operational_backfill_occurrence_stage (
        workspace_id, parent_id, parent_key, source_task_id, task_id, task_semantic_key,
        routine_id, due_date, audience_key, area_name_snapshot, routine_title_snapshot,
        status, completed_at, created_at, updated_at
      ) values ${values.join(", ")}`,
      params
    );
  }
}

export async function finalizeRoutineOccurrenceStage(
  client: OperationalBackfillClient,
  workspaceId: string,
  consume: (plan: WorkspacePlan) => Promise<void>
) {
  const conflicts = [
    ...await readParentFieldConflicts(client, workspaceId),
    ...await readDuplicateTaskConflicts(client, workspaceId)
  ];
  const countResult = await client.query<{ count: number }>(
    `select count(distinct parent_id)::int as count
     from operational_backfill_occurrence_stage where workspace_id = $1`,
    [workspaceId]
  );
  const sourceCount = Number(countResult.rows[0]?.count ?? 0);
  let cursor: string | null = null;
  while (true) {
    const result: QueryResult<JsonRecord> = await client.query<JsonRecord>(
      `select
        parent_id as id,
        $1::text as workspace_id,
        min(routine_id) as routine_id,
        min(due_date) as due_date,
        min(audience_key) as audience_key,
        min(area_name_snapshot) as area_name_snapshot,
        min(routine_title_snapshot) as routine_title_snapshot,
        case
          when min(status) = 'completed' and max(status) = 'completed' then 'completed'
          when min(status) = 'pending' and max(status) = 'pending' then 'pending'
          else 'in_progress'
        end as status,
        case
          when min(status) = 'completed' and max(status) = 'completed' then max(completed_at)
          else null
        end as completed_at,
        min(created_at) as created_at,
        max(updated_at) as updated_at
       from operational_backfill_occurrence_stage
       where workspace_id = $1 and ($2::text is null or parent_id > $2)
       group by parent_id
       order by parent_id
       limit $3`,
      [workspaceId, cursor, BACKFILL_BATCH_SIZE]
    );
    if (result.rows.length === 0) break;
    const plan = emptyStagePlan(workspaceId);
    for (const values of result.rows) {
      const id = String(values.id);
      plan.rows.routine_occurrences.push({
        table: "routine_occurrences",
        entityType: "routine_occurrence",
        entityId: id,
        values
      });
    }
    await consume(plan);
    cursor = String(result.rows.at(-1)?.id);
    if (result.rows.length < BACKFILL_BATCH_SIZE) break;
  }
  return { sourceCount, conflicts };
}

async function readParentFieldConflicts(client: OperationalBackfillClient, workspaceId: string) {
  const result = await client.query<JsonRecord>(
    `with inconsistent as (
      select parent_id
      from operational_backfill_occurrence_stage
      where workspace_id = $1
      group by parent_id
      having count(distinct routine_id) > 1
        or count(distinct due_date) > 1
        or count(distinct audience_key) > 1
        or count(distinct area_name_snapshot) > 1
        or (count(area_name_snapshot) > 0 and count(area_name_snapshot) < count(*))
        or count(distinct routine_title_snapshot) > 1
    )
    select stage.*
    from operational_backfill_occurrence_stage stage
    join inconsistent using (parent_id)
    where stage.workspace_id = $1
    order by stage.parent_id, stage.source_task_id, stage.task_id`,
    [workspaceId]
  );
  const byParent = groupRows(result.rows, "parent_id");
  const conflicts: ConflictingRecord[] = [];
  for (const [parentId, rows] of byParent) {
    const expected = rows[0];
    const actual = rows.find((row) => parentPaths(expected, row).length > 0);
    if (!expected || !actual) continue;
    conflicts.push({
      workspaceId,
      entityType: "routine_occurrence",
      entityId: parentId,
      key: String(expected.parent_key),
      reason: "routine occurrence contributors disagree on parent fields",
      expected: { sourceTaskId: expected.source_task_id, values: parentValues(expected) },
      actual: {
        sourceTaskId: actual.source_task_id,
        paths: parentPaths(expected, actual),
        values: parentValues(actual)
      }
    });
  }
  return conflicts;
}

async function readDuplicateTaskConflicts(client: OperationalBackfillClient, workspaceId: string) {
  const result = await client.query<JsonRecord>(
    `with duplicates as (
      select parent_id, task_semantic_key
      from operational_backfill_occurrence_stage
      where workspace_id = $1
      group by parent_id, task_semantic_key
      having count(*) > 1
    )
    select stage.parent_id, stage.task_semantic_key, stage.source_task_id, stage.task_id
    from operational_backfill_occurrence_stage stage
    join duplicates using (parent_id, task_semantic_key)
    where stage.workspace_id = $1
    order by stage.parent_id, stage.task_semantic_key, stage.source_task_id, stage.task_id`,
    [workspaceId]
  );
  const grouped = groupRows(result.rows, "task_semantic_key");
  const conflicts: ConflictingRecord[] = [];
  for (const [semanticKey, rows] of grouped) {
    const expected = rows[0];
    for (const actual of rows.slice(1)) {
      conflicts.push({
        workspaceId,
        entityType: "task_occurrence",
        entityId: String(actual?.task_id),
        key: semanticKey,
        reason: "duplicate source routine task semantic key",
        expected: { sourceTaskId: expected?.source_task_id },
        actual: { sourceTaskId: actual?.source_task_id }
      });
    }
  }
  return conflicts;
}

function emptyStagePlan(workspaceId: string): WorkspacePlan {
  return {
    workspaceId,
    sourceCounts: emptyEntityCounts(),
    rows: emptyPlannedRows(),
    orphanReferences: [],
    skippedRecords: [],
    conflictingRecords: [],
    malformedRecords: [],
    expansionCounts: emptyExpansionCounts(),
    routineOccurrenceContributions: []
  };
}

function groupRows(rows: JsonRecord[], key: string) {
  const grouped = new Map<string, JsonRecord[]>();
  for (const row of rows) {
    const value = String(row[key]);
    const items = grouped.get(value) ?? [];
    items.push(row);
    grouped.set(value, items);
  }
  return grouped;
}

function parentPaths(expected: JsonRecord | undefined, actual: JsonRecord) {
  if (!expected) return [];
  return [
    ["routine_id", "routine_id"],
    ["due_date", "due_date"],
    ["audience_key", "audience_key"],
    ["area_name_snapshot", "area_name_snapshot"],
    ["routine_title_snapshot", "routine_title_snapshot"]
  ].filter(([, field]) => String(expected[field!]) !== String(actual[field!]))
    .map(([path]) => path!);
}

function parentValues(row: JsonRecord) {
  return {
    routine_id: row.routine_id,
    due_date: row.due_date,
    audience_key: row.audience_key,
    area_name_snapshot: row.area_name_snapshot,
    routine_title_snapshot: row.routine_title_snapshot
  };
}
