export type QueryResult<T> = {
  rows: T[];
  rowCount?: number | null;
};

export type OperationalBackfillClient = {
  query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  release(): void;
};

export type OperationalBackfillPool = {
  query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  connect(): Promise<OperationalBackfillClient>;
};

export type LegacyKind =
  | "area"
  | "role_template"
  | "team_member"
  | "process"
  | "routine"
  | "task_occurrence";

export type LegacyRow = {
  kind: LegacyKind;
  workspace_id: string;
  id: string;
  data: unknown;
  created_at: string | Date;
  updated_at: string | Date;
};

export type MalformedRecord = {
  workspaceId: string;
  kind: string;
  entityId: string;
  path: string;
  reason: string;
};

export type ConflictingRecord = {
  workspaceId: string;
  entityType: string;
  entityId: string;
  key: string;
  reason: string;
  expected?: unknown;
  actual?: unknown;
};

export type OperationalBackfillReport = {
  sourceCounts: Record<string, number>;
  targetCounts: Record<string, number>;
  insertedTotal: number;
  orphanReferences: Array<{
    entityType: string;
    entityId: string;
    field: string;
    legacyValue: string;
  }>;
  skippedRecords?: Array<{
    entityType: string;
    entityId: string;
    reason: string;
  }>;
  conflictingRecords?: ConflictingRecord[];
  malformedRecords?: MalformedRecord[];
  expansionCounts?: ExpansionCounts;
  reconciled: boolean;
};

export type ExpansionCounts = {
  individualRoutineAggregates: number;
  generatedTaskOccurrences: number;
  checklistProgressDispositions: number;
};

export function emptyExpansionCounts(): ExpansionCounts {
  return {
    individualRoutineAggregates: 0,
    generatedTaskOccurrences: 0,
    checklistProgressDispositions: 0
  };
}

export type JsonRecord = Record<string, unknown>;

export const entityTables = [
  "areas",
  "role_templates",
  "people",
  "processes",
  "process_versions",
  "routines",
  "routine_steps",
  "routine_assignments",
  "routine_occurrences",
  "task_occurrences",
  "task_checklist_items",
  "task_evidence",
  "operational_audit_log"
] as const;

export type EntityTable = typeof entityTables[number];
/** `routine_occurrences` counts unique synthesized parent groups; `task_occurrences` counts source tasks. */
export type EntityCounts = Record<EntityTable, number>;

export function emptyEntityCounts(): EntityCounts {
  return Object.fromEntries(entityTables.map((table) => [table, 0])) as EntityCounts;
}

export type PlannedRow = {
  table: EntityTable;
  entityType: string;
  entityId: string;
  values: JsonRecord;
};

export type RoutineOccurrenceContribution = {
  parentId: string;
  parentKey: string;
  sourceTaskId: string;
  taskId: string;
  taskSemanticKey: string;
  routineId: string;
  dueDate: string;
  audienceKey: string;
  areaNameSnapshot: string | null;
  routineTitleSnapshot: string;
  status: "pending" | "in_progress" | "completed";
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceReferences = {
  areas: Map<string, JsonRecord>;
  roleTemplateIds: Set<string>;
  peopleIds: Set<string>;
  processIds: Set<string>;
  routines: Map<string, PlannedRow>;
  routineSteps: PlannedRow[];
};

export function emptyWorkspaceReferences(): WorkspaceReferences {
  return {
    areas: new Map(),
    roleTemplateIds: new Set(),
    peopleIds: new Set(),
    processIds: new Set(),
    routines: new Map(),
    routineSteps: []
  };
}

export type OrphanReference = OperationalBackfillReport["orphanReferences"][number] & {
  workspaceId: string;
};

export type SkippedRecord = NonNullable<OperationalBackfillReport["skippedRecords"]>[number] & {
  workspaceId: string;
  table: EntityTable;
};

export type WorkspacePlan = {
  workspaceId: string;
  sourceCounts: EntityCounts;
  rows: Record<EntityTable, PlannedRow[]>;
  orphanReferences: OrphanReference[];
  skippedRecords: SkippedRecord[];
  conflictingRecords: ConflictingRecord[];
  malformedRecords: MalformedRecord[];
  expansionCounts: ExpansionCounts;
  routineOccurrenceContributions: RoutineOccurrenceContribution[];
};

export function emptyPlannedRows(): Record<EntityTable, PlannedRow[]> {
  return Object.fromEntries(entityTables.map((table) => [table, []])) as unknown as Record<
    EntityTable,
    PlannedRow[]
  >;
}
