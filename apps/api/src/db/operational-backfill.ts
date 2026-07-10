import { createHash } from "node:crypto";

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
  reconciled: boolean;
};

type QueryResult<T> = { rows: T[] };

export type OperationalBackfillClient = {
  query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  release(): void;
};

export type OperationalBackfillPool = {
  query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  connect(): Promise<OperationalBackfillClient>;
};

type LegacyKind = "area" | "role_template" | "team_member" | "process" | "routine" | "task_occurrence";

type LegacyRow = {
  kind: LegacyKind;
  workspace_id: string;
  id: string;
  data: unknown;
  created_at: string | Date;
  updated_at: string | Date;
};

type JsonRecord = Record<string, unknown>;

const entityTables = [
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

type EntityTable = typeof entityTables[number];
type EntityCounts = Record<EntityTable, number>;

type OrphanReference = OperationalBackfillReport["orphanReferences"][number] & {
  workspaceId: string;
};

type SkippedRecord = NonNullable<OperationalBackfillReport["skippedRecords"]>[number] & {
  workspaceId: string;
  table: EntityTable;
};

type AreaPlan = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type RoleTemplatePlan = {
  id: string;
  workspaceId: string;
  areaId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

type PersonPlan = {
  id: string;
  workspaceId: string;
  name: string;
  email: string | null;
  role: string;
  areaId: string | null;
  roleTemplateId: string | null;
  status: string;
  createdByProfileId: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProcessPlan = {
  id: string;
  workspaceId: string;
  areaId: string | null;
  title: string;
  summary: string | null;
  status: string;
  ownerProfileId: string | null;
  ownerRoleTemplateId: string | null;
  currentVersion: number;
  createdByProfileId: string;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProcessVersionPlan = {
  id: string;
  workspaceId: string;
  processId: string;
  versionNumber: number;
  title: string;
  body: string;
  changeNote: string;
  editorProfileId: string;
  createdAt: string;
};

type RoutinePlan = {
  id: string;
  workspaceId: string;
  areaId: string | null;
  title: string;
  status: string;
  frequency: string;
  weekdays: string[];
  monthDay: number | null;
  executionMode: string;
  approvalMode: string;
  evidencePolicy: string;
  evidenceReason: string | null;
  createdByProfileId: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type RoutineStepPlan = {
  id: string;
  workspaceId: string;
  routineId: string;
  title: string;
  processId: string | null;
  instructionTiming: string | null;
  deadlineTime: string | null;
  approvalMode: string;
  evidencePolicy: string;
  evidenceReason: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type RoutineAssignmentPlan = {
  id: string;
  workspaceId: string;
  routineId: string;
  routineStepId: string | null;
  profileId: string | null;
  roleTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
};

type RoutineOccurrencePlan = {
  id: string;
  workspaceId: string;
  routineId: string;
  dueDate: string;
  audienceKey: string;
  areaNameSnapshot: string | null;
  routineTitleSnapshot: string;
  status: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type TaskOccurrencePlan = {
  id: string;
  workspaceId: string;
  origin: string;
  routineId: string | null;
  routineStepId: string | null;
  areaId: string | null;
  processId: string | null;
  assigneeProfileId: string | null;
  audienceKey: string | null;
  title: string;
  areaNameSnapshot: string | null;
  routineTitleSnapshot: string | null;
  stepTitleSnapshot: string;
  approvalMode: string;
  evidencePolicy: string;
  evidenceReason: string | null;
  status: string;
  dueDate: string;
  dueTime: string | null;
  submittedByProfileId: string | null;
  submittedAt: string | null;
  reviewedByProfileId: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ChecklistPlan = {
  id: string;
  workspaceId: string;
  taskOccurrenceId: string;
  title: string;
  sortOrder: number;
  isCompleted: boolean;
  completedByProfileId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type EvidencePlan = {
  id: string;
  workspaceId: string;
  taskOccurrenceId: string;
  profileId: string;
  kind: "comment" | "photo";
  comment: string | null;
  photoUrl: string | null;
  objectKey: string | null;
  createdAt: string;
};

type WorkspacePlan = {
  workspaceId: string;
  counts: EntityCounts;
  skippedCounts: EntityCounts;
  areas: AreaPlan[];
  roleTemplates: RoleTemplatePlan[];
  people: PersonPlan[];
  processes: ProcessPlan[];
  processVersions: ProcessVersionPlan[];
  routines: RoutinePlan[];
  routineSteps: RoutineStepPlan[];
  routineAssignments: RoutineAssignmentPlan[];
  routineOccurrences: RoutineOccurrencePlan[];
  taskOccurrences: TaskOccurrencePlan[];
  checklistItems: ChecklistPlan[];
  evidence: EvidencePlan[];
  orphanReferences: OrphanReference[];
  skippedRecords: SkippedRecord[];
};

export async function backfillOperationalData(
  pool: OperationalBackfillPool
): Promise<OperationalBackfillReport> {
  const sourceRows = await pool.query<LegacyRow>(
    `select kind, workspace_id, id, data, created_at, updated_at
     from baase_records
     where kind in ($1, $2, $3, $4, $5, $6)
     order by workspace_id,
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
    ["area", "role_template", "team_member", "process", "routine", "task_occurrence"]
  );

  const rowsByWorkspace = new Map<string, LegacyRow[]>();
  for (const row of sourceRows.rows) {
    const workspaceRows = rowsByWorkspace.get(row.workspace_id) ?? [];
    workspaceRows.push(row);
    rowsByWorkspace.set(row.workspace_id, workspaceRows);
  }

  const plans = [...rowsByWorkspace.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([workspaceId, rows]) => buildWorkspacePlan(workspaceId, rows));

  let insertedTotal = 0;
  for (const plan of plans) insertedTotal += await insertWorkspacePlan(pool, plan);

  const sourceCounts = emptyCounts();
  const skippedCounts = emptyCounts();
  const orphanReferences: OrphanReference[] = [];
  const skippedRecords: SkippedRecord[] = [];
  for (const plan of plans) {
    addCounts(sourceCounts, plan.counts);
    addCounts(skippedCounts, plan.skippedCounts);
    orphanReferences.push(...plan.orphanReferences);
    skippedRecords.push(...plan.skippedRecords);
  }

  const targetCounts = await readTargetCounts(pool);
  const reconciled = entityTables.every((table) => (
    targetCounts[table] === sourceCounts[table] - skippedCounts[table]
  ));

  return {
    sourceCounts,
    targetCounts,
    insertedTotal,
    orphanReferences: sortOrphans(orphanReferences).map(({ workspaceId: _workspaceId, ...orphan }) => orphan),
    skippedRecords: sortSkipped(skippedRecords).map(({ workspaceId: _workspaceId, table: _table, ...record }) => record),
    reconciled
  };
}

function buildWorkspacePlan(workspaceId: string, rows: LegacyRow[]): WorkspacePlan {
  const plan: WorkspacePlan = {
    workspaceId,
    counts: emptyCounts(),
    skippedCounts: emptyCounts(),
    areas: [],
    roleTemplates: [],
    people: [],
    processes: [],
    processVersions: [],
    routines: [],
    routineSteps: [],
    routineAssignments: [],
    routineOccurrences: [],
    taskOccurrences: [],
    checklistItems: [],
    evidence: [],
    orphanReferences: [],
    skippedRecords: []
  };
  const byKind = new Map<LegacyKind, LegacyRow[]>();
  for (const row of rows) {
    const kindRows = byKind.get(row.kind) ?? [];
    kindRows.push(row);
    byKind.set(row.kind, kindRows);
  }

  const areaById = new Map<string, AreaPlan>();
  for (const [index, row] of (byKind.get("area") ?? []).entries()) {
    const data = readData(row.data);
    const area: AreaPlan = {
      id: row.id,
      workspaceId,
      name: requiredText(data.name, row.id),
      description: optionalText(data.description),
      sortOrder: nonNegativeInteger(data.sortOrder, index),
      createdAt: recordTimestamp(data.createdAt, row.created_at),
      updatedAt: recordTimestamp(data.updatedAt, row.updated_at)
    };
    plan.areas.push(area);
    areaById.set(area.id, area);
  }
  plan.counts.areas = plan.areas.length;

  const validRoleIds = new Set<string>();
  for (const row of byKind.get("role_template") ?? []) {
    const data = readData(row.data);
    plan.counts.role_templates += 1;
    const areaId = optionalText(data.areaId);
    if (!areaId || !areaById.has(areaId)) {
      if (areaId) addOrphan(plan, "role_template", row.id, "area_id", areaId);
      addSkipped(
        plan,
        "role_templates",
        "role_template",
        row.id,
        areaId ? `missing required area ${areaId}` : "missing required area"
      );
      continue;
    }

    plan.roleTemplates.push({
      id: row.id,
      workspaceId,
      areaId,
      name: requiredText(data.name, row.id),
      description: optionalText(data.description),
      createdAt: recordTimestamp(data.createdAt, row.created_at),
      updatedAt: recordTimestamp(data.updatedAt, row.updated_at)
    });
    validRoleIds.add(row.id);
  }

  const personIds = new Set((byKind.get("team_member") ?? []).map((row) => row.id));
  for (const row of byKind.get("team_member") ?? []) {
    const data = readData(row.data);
    const areaId = resolveReference(plan, areaById, {
      entityType: "person",
      entityId: row.id,
      field: "area_id",
      legacyValue: optionalText(data.areaId)
    });
    const roleTemplateId = resolveSetReference(plan, validRoleIds, {
      entityType: "person",
      entityId: row.id,
      field: "role_template_id",
      legacyValue: optionalText(data.roleTemplateId)
    });
    const status = oneOf(data.status, ["active", "inactive", "placeholder", "archived"], "active");
    plan.people.push({
      id: row.id,
      workspaceId,
      name: requiredText(data.name, row.id),
      email: optionalText(data.email),
      role: oneOf(data.role, ["owner", "manager", "employee"], "employee"),
      areaId,
      roleTemplateId,
      status,
      createdByProfileId: optionalText(data.createdByProfileId) ?? row.id,
      archivedAt: status === "archived"
        ? optionalText(data.archivedAt) ?? recordTimestamp(data.updatedAt, row.updated_at)
        : optionalText(data.archivedAt),
      createdAt: recordTimestamp(data.createdAt, row.created_at),
      updatedAt: recordTimestamp(data.updatedAt, row.updated_at)
    });
  }
  plan.counts.people = plan.people.length;

  const processIds = new Set((byKind.get("process") ?? []).map((row) => row.id));
  for (const row of byKind.get("process") ?? []) {
    const data = readData(row.data);
    const areaId = resolveReference(plan, areaById, {
      entityType: "process",
      entityId: row.id,
      field: "area_id",
      legacyValue: optionalText(data.areaId)
    });
    const ownerProfileId = resolveSetReference(plan, personIds, {
      entityType: "process",
      entityId: row.id,
      field: "owner_profile_id",
      legacyValue: optionalText(data.ownerProfileId)
    });
    let ownerRoleTemplateId = resolveSetReference(plan, validRoleIds, {
      entityType: "process",
      entityId: row.id,
      field: "owner_role_template_id",
      legacyValue: optionalText(data.ownerRoleTemplateId)
    });
    if (ownerProfileId) ownerRoleTemplateId = null;

    const versions = normalizedProcessVersions(row, data);
    const currentVersion = positiveInteger(readData(data.currentVersion).version)
      ?? versions.reduce((maximum, version) => Math.max(maximum, version.versionNumber), 1);
    const status = oneOf(data.status, ["draft", "published", "archived"], "draft");
    plan.processes.push({
      id: row.id,
      workspaceId,
      areaId,
      title: requiredText(data.title, versions.at(-1)?.title ?? row.id),
      summary: optionalText(data.summary),
      status,
      ownerProfileId,
      ownerRoleTemplateId,
      currentVersion,
      createdByProfileId: optionalText(data.createdByProfileId) ?? row.id,
      publishedAt: optionalText(data.publishedAt),
      archivedAt: status === "archived"
        ? optionalText(data.archivedAt) ?? recordTimestamp(data.updatedAt, row.updated_at)
        : optionalText(data.archivedAt),
      createdAt: recordTimestamp(data.createdAt, row.created_at),
      updatedAt: recordTimestamp(data.updatedAt, row.updated_at)
    });
    plan.processVersions.push(...versions);
  }
  plan.counts.processes = plan.processes.length;
  plan.counts.process_versions = plan.processVersions.length;

  const routineById = new Map<string, RoutinePlan>();
  const stepByRoutineAndId = new Map<string, RoutineStepPlan>();
  const routineDataById = new Map<string, JsonRecord>();
  for (const row of byKind.get("routine") ?? []) {
    const data = readData(row.data);
    const areaId = resolveReference(plan, areaById, {
      entityType: "routine",
      entityId: row.id,
      field: "area_id",
      legacyValue: optionalText(data.areaId)
    });
    const schedule = normalizeSchedule(data);
    const status = oneOf(data.status, ["active", "paused", "archived"], "active");
    const routine: RoutinePlan = {
      id: row.id,
      workspaceId,
      areaId,
      title: requiredText(data.title, row.id),
      status,
      frequency: schedule.frequency,
      weekdays: schedule.weekdays,
      monthDay: schedule.monthDay,
      executionMode: oneOf(
        data.executionMode,
        ["shared", "individual"],
        stringArray(data.assigneeProfileIds).length > 1 ? "individual" : "shared"
      ),
      approvalMode: approvalMode(data.approvalMode),
      evidencePolicy: evidencePolicy(data.evidencePolicy),
      evidenceReason: optionalText(data.evidenceReason),
      createdByProfileId: optionalText(data.createdByProfileId) ?? row.id,
      archivedAt: status === "archived"
        ? optionalText(data.archivedAt) ?? recordTimestamp(data.updatedAt, row.updated_at)
        : optionalText(data.archivedAt),
      createdAt: recordTimestamp(data.createdAt, row.created_at),
      updatedAt: recordTimestamp(data.updatedAt, row.updated_at)
    };
    plan.routines.push(routine);
    routineById.set(row.id, routine);
    routineDataById.set(row.id, data);

    const templates = recordArray(data.taskTemplates);
    for (const [index, template] of templates.entries()) {
      const sortOrder = positiveInteger(template.sortOrder) ?? index + 1;
      const stepId = optionalText(template.id) ?? deterministicId("legacy_step", workspaceId, row.id, String(sortOrder));
      const processId = resolveSetReference(plan, processIds, {
        entityType: "routine_step",
        entityId: stepId,
        field: "process_id",
        legacyValue: optionalText(template.processId)
      });
      const dueHint = optionalText(template.dueHint);
      const deadlineTime = readTime(dueHint);
      const step: RoutineStepPlan = {
        id: stepId,
        workspaceId,
        routineId: row.id,
        title: requiredText(template.title, stepId),
        processId,
        instructionTiming: deadlineTime ? null : dueHint,
        deadlineTime,
        approvalMode: approvalMode(template.approvalMode),
        evidencePolicy: evidencePolicy(template.evidencePolicy),
        evidenceReason: optionalText(template.evidenceReason),
        sortOrder,
        createdAt: recordTimestamp(template.createdAt, row.created_at),
        updatedAt: recordTimestamp(template.updatedAt, row.updated_at)
      };
      plan.routineSteps.push(step);
      stepByRoutineAndId.set(routineStepKey(row.id, step.id), step);
    }
  }
  plan.counts.routines = plan.routines.length;
  plan.counts.routine_steps = plan.routineSteps.length;

  for (const routine of plan.routines) {
    const data = routineDataById.get(routine.id) ?? {};
    const generalProfiles = uniqueStrings(stringArray(data.assigneeProfileIds));
    const generalRoles = uniqueStrings(stringArray(data.assigneeRoleTemplateIds));
    for (const profileId of generalProfiles) {
      addAssignment(plan, personIds, validRoleIds, routine, null, "profile", profileId);
    }
    for (const roleId of generalRoles) {
      addAssignment(plan, personIds, validRoleIds, routine, null, "role", roleId);
    }

    const templates = recordArray(data.taskTemplates);
    for (const [index, template] of templates.entries()) {
      const sortOrder = positiveInteger(template.sortOrder) ?? index + 1;
      const stepId = optionalText(template.id) ?? deterministicId(
        "legacy_step",
        workspaceId,
        routine.id,
        String(sortOrder)
      );
      const profileId = optionalText(template.assigneeProfileId);
      const roleId = optionalText(template.assigneeRoleTemplateId);
      if (profileId) addAssignment(plan, personIds, validRoleIds, routine, stepId, "profile", profileId);
      if (roleId) addAssignment(plan, personIds, validRoleIds, routine, stepId, "role", roleId);
    }
  }

  const occurrenceByKey = new Map<string, RoutineOccurrencePlan>();
  for (const row of byKind.get("task_occurrence") ?? []) {
    const data = readData(row.data);
    const legacyRoutineId = optionalText(data.routineId);
    const legacyStepId = optionalText(data.taskTemplateId) ?? optionalText(data.routineStepId);
    const requestedRoutineOrigin = data.origin === "routine"
      || (data.origin !== "manual" && Boolean(legacyRoutineId));
    const routine = legacyRoutineId ? routineById.get(legacyRoutineId) : undefined;
    const step = routine && legacyStepId
      ? stepByRoutineAndId.get(routineStepKey(routine.id, legacyStepId))
      : undefined;
    const unresolvedRoutineId = legacyRoutineId && !routine ? legacyRoutineId : null;
    const unresolvedStepId = legacyStepId && !step ? legacyStepId : null;
    if (requestedRoutineOrigin && legacyRoutineId && !routine) {
      addOrphan(plan, "task_occurrence", row.id, "routine_id", legacyRoutineId);
    }
    if (requestedRoutineOrigin && legacyStepId && !step) {
      addOrphan(plan, "task_occurrence", row.id, "routine_step_id", legacyStepId);
    }
    const isRoutineOrigin = requestedRoutineOrigin && Boolean(routine && step);

    const legacyAreaId = optionalText(data.areaId);
    let areaId = resolveReference(plan, areaById, {
      entityType: "task_occurrence",
      entityId: row.id,
      field: "area_id",
      legacyValue: legacyAreaId
    });
    const unresolvedAreaId = legacyAreaId && !areaId ? legacyAreaId : null;
    if (!areaId && !legacyAreaId && routine?.areaId) areaId = routine.areaId;
    const unresolvedVisibleIds = [unresolvedAreaId, unresolvedRoutineId, unresolvedStepId];
    const processId = resolveSetReference(plan, processIds, {
      entityType: "task_occurrence",
      entityId: row.id,
      field: "process_id",
      legacyValue: optionalText(data.processId)
    });
    const assigneeProfileId = resolveSetReference(plan, personIds, {
      entityType: "task_occurrence",
      entityId: row.id,
      field: "assignee_profile_id",
      legacyValue: optionalText(data.assigneeProfileId)
    });
    const submittedByProfileId = resolveSetReference(plan, personIds, {
      entityType: "task_occurrence",
      entityId: row.id,
      field: "submitted_by_profile_id",
      legacyValue: optionalText(data.submittedByProfileId)
    });
    const reviewedByProfileId = resolveSetReference(plan, personIds, {
      entityType: "task_occurrence",
      entityId: row.id,
      field: "reviewed_by_profile_id",
      legacyValue: optionalText(data.reviewedByProfileId)
    });
    const areaNameSnapshot = sanitizedVisibleSnapshot(data.areaNameSnapshot, unresolvedVisibleIds)
      ?? (areaId ? areaById.get(areaId)?.name ?? null : null);
    const routineTitle = sanitizedVisibleSnapshot(data.routineTitleSnapshot, unresolvedVisibleIds)
      ?? routine?.title
      ?? null;
    const stepTitle = sanitizedVisibleSnapshot(data.stepTitleSnapshot, unresolvedVisibleIds)
      ?? step?.title
      ?? sanitizedVisibleSnapshot(data.title, unresolvedVisibleIds)
      ?? "Etapa removida";
    const dueDate = readDate(data.dueDate)
      ?? recordTimestamp(data.createdAt, row.created_at).slice(0, 10);
    const dueTime = readTime(optionalText(data.dueTime) ?? optionalText(data.dueHint));
    const audienceKey = isRoutineOrigin
      ? optionalText(data.audienceKey) ?? (assigneeProfileId ? `profile:${assigneeProfileId}` : "all")
      : null;
    const status = taskStatus(data.status);
    const completedAt = optionalText(data.completedAt)
      ?? (status === "completed" ? optionalText(data.submittedAt) ?? recordTimestamp(data.updatedAt, row.updated_at) : null);
    const task: TaskOccurrencePlan = {
      id: row.id,
      workspaceId,
      origin: isRoutineOrigin ? "routine" : "manual",
      routineId: isRoutineOrigin ? routine?.id ?? null : null,
      routineStepId: isRoutineOrigin ? step?.id ?? null : null,
      areaId,
      processId,
      assigneeProfileId,
      audienceKey,
      title: requiredText(data.title, stepTitle),
      areaNameSnapshot,
      routineTitleSnapshot: requestedRoutineOrigin ? routineTitle : null,
      stepTitleSnapshot: stepTitle,
      approvalMode: approvalMode(data.approvalMode),
      evidencePolicy: evidencePolicy(data.evidencePolicy),
      evidenceReason: optionalText(data.evidenceReason),
      status,
      dueDate,
      dueTime,
      submittedByProfileId,
      submittedAt: optionalText(data.submittedAt),
      reviewedByProfileId,
      reviewedAt: optionalText(data.reviewedAt),
      reviewComment: optionalText(data.reviewComment),
      completedAt,
      createdAt: recordTimestamp(data.createdAt, row.created_at),
      updatedAt: recordTimestamp(data.updatedAt, row.updated_at)
    };
    plan.taskOccurrences.push(task);

    if (isRoutineOrigin && routine && audienceKey) {
      const occurrenceKey = `${routine.id}\u0000${dueDate}\u0000${audienceKey}`;
      const current = occurrenceByKey.get(occurrenceKey);
      const nextStatus = routineOccurrenceStatus(status);
      if (!current) {
        occurrenceByKey.set(occurrenceKey, {
          id: deterministicId("legacy_occurrence", workspaceId, routine.id, dueDate, audienceKey),
          workspaceId,
          routineId: routine.id,
          dueDate,
          audienceKey,
          areaNameSnapshot,
          routineTitleSnapshot: routineTitle ?? routine.title,
          status: nextStatus,
          completedAt: nextStatus === "completed" ? completedAt : null,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt
        });
      } else if (current.status === "completed" && nextStatus !== "completed") {
        current.status = nextStatus;
        current.completedAt = null;
      }
    }

    addChecklistPlans(plan, row, data, personIds);
    addEvidencePlans(plan, row, data, personIds, assigneeProfileId, submittedByProfileId);
  }
  plan.routineOccurrences.push(...occurrenceByKey.values());
  plan.counts.routine_occurrences = plan.routineOccurrences.length;
  plan.counts.task_occurrences = plan.taskOccurrences.length;
  plan.counts.task_checklist_items = plan.checklistItems.length + plan.skippedCounts.task_checklist_items;
  plan.counts.task_evidence = plan.evidence.length + plan.skippedCounts.task_evidence;
  plan.counts.operational_audit_log = plan.orphanReferences.length;

  return plan;
}

function normalizedProcessVersions(row: LegacyRow, processData: JsonRecord): ProcessVersionPlan[] {
  const versionsByNumber = new Map<number, JsonRecord>();
  for (const version of recordArray(processData.versions)) {
    const versionNumber = positiveInteger(version.version);
    if (versionNumber) versionsByNumber.set(versionNumber, version);
  }
  const currentVersion = readData(processData.currentVersion);
  const currentVersionNumber = positiveInteger(currentVersion.version);
  if (currentVersionNumber) versionsByNumber.set(currentVersionNumber, currentVersion);

  return [...versionsByNumber.entries()]
    .sort(([left], [right]) => left - right)
    .map(([versionNumber, version]) => ({
      id: optionalText(version.id)
        ?? deterministicId("legacy_process_version", row.workspace_id, row.id, String(versionNumber)),
      workspaceId: row.workspace_id,
      processId: row.id,
      versionNumber,
      title: requiredText(version.title, requiredText(processData.title, row.id)),
      body: textValue(version.body) ?? "",
      changeNote: textValue(version.changeNote) ?? "",
      editorProfileId: optionalText(version.editorProfileId)
        ?? optionalText(processData.createdByProfileId)
        ?? row.id,
      createdAt: recordTimestamp(version.createdAt, row.created_at)
    }));
}

function addAssignment(
  plan: WorkspacePlan,
  personIds: Set<string>,
  roleIds: Set<string>,
  routine: RoutinePlan,
  routineStepId: string | null,
  kind: "profile" | "role",
  legacyValue: string
) {
  const assignmentId = deterministicId(
    "legacy_assignment",
    plan.workspaceId,
    routine.id,
    routineStepId ?? "general",
    kind,
    legacyValue
  );
  plan.counts.routine_assignments += 1;
  const valid = kind === "profile" ? personIds.has(legacyValue) : roleIds.has(legacyValue);
  if (!valid) {
    const field = kind === "profile" ? "profile_id" : "role_template_id";
    addOrphan(plan, "routine_assignment", assignmentId, field, legacyValue);
    addSkipped(
      plan,
      "routine_assignments",
      "routine_assignment",
      assignmentId,
      kind === "profile" ? `missing profile ${legacyValue}` : `missing role template ${legacyValue}`
    );
    return;
  }

  plan.routineAssignments.push({
    id: assignmentId,
    workspaceId: plan.workspaceId,
    routineId: routine.id,
    routineStepId,
    profileId: kind === "profile" ? legacyValue : null,
    roleTemplateId: kind === "role" ? legacyValue : null,
    createdAt: routine.createdAt,
    updatedAt: routine.updatedAt
  });
}

function addChecklistPlans(
  plan: WorkspacePlan,
  row: LegacyRow,
  taskData: JsonRecord,
  personIds: Set<string>
) {
  for (const [index, item] of recordArray(taskData.checklistItems).entries()) {
    const sortOrder = positiveInteger(item.sortOrder) ?? index + 1;
    const itemId = optionalText(item.id)
      ?? deterministicId("legacy_checklist", plan.workspaceId, row.id, String(sortOrder));
    const legacyCompletedBy = optionalText(item.completedByProfileId);
    const completedByProfileId = resolveSetReference(plan, personIds, {
      entityType: "task_checklist_item",
      entityId: itemId,
      field: "completed_by_profile_id",
      legacyValue: legacyCompletedBy
    });
    plan.checklistItems.push({
      id: itemId,
      workspaceId: plan.workspaceId,
      taskOccurrenceId: row.id,
      title: textValue(item.title) ?? "",
      sortOrder,
      isCompleted: booleanValue(item.isCompleted ?? item.done),
      completedByProfileId,
      completedAt: optionalText(item.completedAt),
      createdAt: recordTimestamp(item.createdAt, row.created_at),
      updatedAt: recordTimestamp(item.updatedAt, row.updated_at)
    });
  }
}

function addEvidencePlans(
  plan: WorkspacePlan,
  row: LegacyRow,
  taskData: JsonRecord,
  personIds: Set<string>,
  assigneeProfileId: string | null,
  submittedByProfileId: string | null
) {
  const rawEvidence = Array.isArray(taskData.evidence)
    ? taskData.evidence.map(readData)
    : taskData.evidence && typeof taskData.evidence === "object"
      ? [readData(taskData.evidence)]
      : [];

  for (const [index, evidence] of rawEvidence.entries()) {
    const components: Array<{
      kind: "comment" | "photo";
      comment: string | null;
      photoUrl: string | null;
      objectKey: string | null;
    }> = [];
    const comment = optionalText(evidence.comment);
    const photoUrl = optionalText(evidence.photoUrl);
    const objectKey = optionalText(evidence.objectKey);
    if (comment) components.push({ kind: "comment", comment, photoUrl: null, objectKey: null });
    if (photoUrl || objectKey) components.push({ kind: "photo", comment: null, photoUrl, objectKey });

    for (const component of components) {
      const baseId = optionalText(evidence.id);
      const evidenceId = baseId && components.length === 1
        ? baseId
        : deterministicId(
          "legacy_evidence",
          plan.workspaceId,
          row.id,
          baseId ?? String(index + 1),
          component.kind
        );
      plan.counts.task_evidence += 1;
      const explicitProfileId = optionalText(evidence.profileId);
      if (explicitProfileId && !personIds.has(explicitProfileId)) {
        addOrphan(plan, "task_evidence", evidenceId, "profile_id", explicitProfileId);
        addSkipped(plan, "task_evidence", "task_evidence", evidenceId, "missing evidence profile");
        continue;
      }
      const profileId = explicitProfileId ?? submittedByProfileId ?? assigneeProfileId;
      if (!profileId) {
        addSkipped(plan, "task_evidence", "task_evidence", evidenceId, "missing evidence profile");
        continue;
      }

      plan.evidence.push({
        id: evidenceId,
        workspaceId: plan.workspaceId,
        taskOccurrenceId: row.id,
        profileId,
        ...component,
        createdAt: recordTimestamp(evidence.createdAt, row.updated_at)
      });
    }
  }
}

async function insertWorkspacePlan(pool: OperationalBackfillPool, plan: WorkspacePlan) {
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", workspaceLock(plan.workspaceId));
    for (const area of plan.areas) {
      inserted += await insert(client,
        `insert into areas
          (id, workspace_id, name, description, sort_order, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict do nothing
         returning id`,
        [area.id, area.workspaceId, area.name, area.description, area.sortOrder, area.createdAt, area.updatedAt]
      );
    }
    for (const role of plan.roleTemplates) {
      inserted += await insert(client,
        `insert into role_templates
          (id, workspace_id, area_id, name, description, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict do nothing
         returning id`,
        [role.id, role.workspaceId, role.areaId, role.name, role.description, role.createdAt, role.updatedAt]
      );
    }
    for (const person of plan.people) {
      inserted += await insert(client,
        `insert into people
          (id, workspace_id, name, email, role, area_id, role_template_id, status,
           created_by_profile_id, archived_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict do nothing
         returning id`,
        [
          person.id,
          person.workspaceId,
          person.name,
          person.email,
          person.role,
          person.areaId,
          person.roleTemplateId,
          person.status,
          person.createdByProfileId,
          person.archivedAt,
          person.createdAt,
          person.updatedAt
        ]
      );
    }
    for (const process of plan.processes) {
      inserted += await insert(client,
        `insert into processes
          (id, workspace_id, area_id, title, summary, status, owner_profile_id,
           owner_role_template_id, current_version, created_by_profile_id, published_at,
           archived_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         on conflict do nothing
         returning id`,
        [
          process.id,
          process.workspaceId,
          process.areaId,
          process.title,
          process.summary,
          process.status,
          process.ownerProfileId,
          process.ownerRoleTemplateId,
          process.currentVersion,
          process.createdByProfileId,
          process.publishedAt,
          process.archivedAt,
          process.createdAt,
          process.updatedAt
        ]
      );
    }
    for (const version of plan.processVersions) {
      inserted += await insert(client,
        `insert into process_versions
          (id, workspace_id, process_id, version_number, title, body, change_note,
           editor_profile_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict do nothing
         returning id`,
        [
          version.id,
          version.workspaceId,
          version.processId,
          version.versionNumber,
          version.title,
          version.body,
          version.changeNote,
          version.editorProfileId,
          version.createdAt
        ]
      );
    }
    for (const routine of plan.routines) {
      inserted += await insert(client,
        `insert into routines
          (id, workspace_id, area_id, title, status, frequency, weekdays, month_day,
           execution_mode, approval_mode, evidence_policy, evidence_reason,
           created_by_profile_id, archived_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10, $11, $12, $13, $14, $15, $16)
         on conflict (workspace_id, id) do nothing
         returning id`,
        [
          routine.id,
          routine.workspaceId,
          routine.areaId,
          routine.title,
          routine.status,
          routine.frequency,
          routine.weekdays,
          routine.monthDay,
          routine.executionMode,
          routine.approvalMode,
          routine.evidencePolicy,
          routine.evidenceReason,
          routine.createdByProfileId,
          routine.archivedAt,
          routine.createdAt,
          routine.updatedAt
        ]
      );
    }
    for (const step of plan.routineSteps) {
      inserted += await insert(client,
        `insert into routine_steps
          (id, workspace_id, routine_id, title, process_id, instruction_timing,
           deadline_time, approval_mode, evidence_policy, evidence_reason, sort_order,
           created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         on conflict do nothing
         returning id`,
        [
          step.id,
          step.workspaceId,
          step.routineId,
          step.title,
          step.processId,
          step.instructionTiming,
          step.deadlineTime,
          step.approvalMode,
          step.evidencePolicy,
          step.evidenceReason,
          step.sortOrder,
          step.createdAt,
          step.updatedAt
        ]
      );
    }
    for (const assignment of plan.routineAssignments) {
      inserted += await insert(client,
        `insert into routine_assignments
          (id, workspace_id, routine_id, routine_step_id, profile_id, role_template_id,
           created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict do nothing
         returning id`,
        [
          assignment.id,
          assignment.workspaceId,
          assignment.routineId,
          assignment.routineStepId,
          assignment.profileId,
          assignment.roleTemplateId,
          assignment.createdAt,
          assignment.updatedAt
        ]
      );
    }
    for (const occurrence of plan.routineOccurrences) {
      inserted += await insert(client,
        `insert into routine_occurrences
          (id, workspace_id, routine_id, due_date, audience_key, area_name_snapshot,
           routine_title_snapshot, status, completed_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict do nothing
         returning id`,
        [
          occurrence.id,
          occurrence.workspaceId,
          occurrence.routineId,
          occurrence.dueDate,
          occurrence.audienceKey,
          occurrence.areaNameSnapshot,
          occurrence.routineTitleSnapshot,
          occurrence.status,
          occurrence.completedAt,
          occurrence.createdAt,
          occurrence.updatedAt
        ]
      );
    }
    for (const task of plan.taskOccurrences) {
      inserted += await insert(client,
        `insert into task_occurrences
          (id, workspace_id, origin, routine_id, routine_step_id, area_id, process_id,
           assignee_profile_id, audience_key, title, area_name_snapshot,
           routine_title_snapshot, step_title_snapshot, approval_mode, evidence_policy,
           evidence_reason, status, due_date, due_time, submitted_by_profile_id,
           submitted_at, reviewed_by_profile_id, reviewed_at, review_comment, completed_at,
           created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
           $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
         on conflict do nothing
         returning id`,
        [
          task.id,
          task.workspaceId,
          task.origin,
          task.routineId,
          task.routineStepId,
          task.areaId,
          task.processId,
          task.assigneeProfileId,
          task.audienceKey,
          task.title,
          task.areaNameSnapshot,
          task.routineTitleSnapshot,
          task.stepTitleSnapshot,
          task.approvalMode,
          task.evidencePolicy,
          task.evidenceReason,
          task.status,
          task.dueDate,
          task.dueTime,
          task.submittedByProfileId,
          task.submittedAt,
          task.reviewedByProfileId,
          task.reviewedAt,
          task.reviewComment,
          task.completedAt,
          task.createdAt,
          task.updatedAt
        ]
      );
    }
    for (const item of plan.checklistItems) {
      inserted += await insert(client,
        `insert into task_checklist_items
          (id, workspace_id, task_occurrence_id, title, sort_order, is_completed,
           completed_by_profile_id, completed_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict do nothing
         returning id`,
        [
          item.id,
          item.workspaceId,
          item.taskOccurrenceId,
          item.title,
          item.sortOrder,
          item.isCompleted,
          item.completedByProfileId,
          item.completedAt,
          item.createdAt,
          item.updatedAt
        ]
      );
    }
    for (const evidence of plan.evidence) {
      inserted += await insert(client,
        `insert into task_evidence
          (id, workspace_id, task_occurrence_id, profile_id, kind, comment, photo_url,
           object_key, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict do nothing
         returning id`,
        [
          evidence.id,
          evidence.workspaceId,
          evidence.taskOccurrenceId,
          evidence.profileId,
          evidence.kind,
          evidence.comment,
          evidence.photoUrl,
          evidence.objectKey,
          evidence.createdAt
        ]
      );
    }
    for (const orphan of plan.orphanReferences) {
      const auditId = deterministicId(
        "legacy_unresolved",
        orphan.workspaceId,
        orphan.entityType,
        orphan.entityId,
        orphan.field,
        orphan.legacyValue
      );
      inserted += await insert(client,
        `insert into operational_audit_log
          (id, workspace_id, entity_type, entity_id, action, details)
         values ($1, $2, $3, $4, $5, $6::jsonb)
         on conflict do nothing
         returning id`,
        [
          auditId,
          orphan.workspaceId,
          orphan.entityType,
          orphan.entityId,
          "legacy_reference_unresolved",
          JSON.stringify({ field: orphan.field, legacyValue: orphan.legacyValue })
        ]
      );
    }
    await client.query("COMMIT");
    return inserted;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function insert(client: OperationalBackfillClient, sql: string, params: unknown[]) {
  const result = await client.query<{ id: string }>(sql, params);
  return result.rows.length;
}

async function readTargetCounts(pool: OperationalBackfillPool): Promise<EntityCounts> {
  const result = await pool.query<Record<EntityTable, number>>(
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
  const row = result.rows[0];
  const counts = emptyCounts();
  if (!row) return counts;
  for (const table of entityTables) counts[table] = Number(row[table] ?? 0);
  return counts;
}

function addOrphan(
  plan: WorkspacePlan,
  entityType: string,
  entityId: string,
  field: string,
  legacyValue: string
) {
  const duplicate = plan.orphanReferences.some((orphan) => (
    orphan.entityType === entityType
    && orphan.entityId === entityId
    && orphan.field === field
    && orphan.legacyValue === legacyValue
  ));
  if (duplicate) return;
  plan.orphanReferences.push({
    workspaceId: plan.workspaceId,
    entityType,
    entityId,
    field,
    legacyValue
  });
}

function addSkipped(
  plan: WorkspacePlan,
  table: EntityTable,
  entityType: string,
  entityId: string,
  reason: string
) {
  const duplicate = plan.skippedRecords.some((record) => (
    record.table === table && record.entityType === entityType && record.entityId === entityId
  ));
  if (duplicate) return;
  plan.skippedCounts[table] += 1;
  plan.skippedRecords.push({
    workspaceId: plan.workspaceId,
    table,
    entityType,
    entityId,
    reason
  });
}

function resolveReference<T>(
  plan: WorkspacePlan,
  records: Map<string, T>,
  reference: {
    entityType: string;
    entityId: string;
    field: string;
    legacyValue: string | null;
  }
) {
  if (!reference.legacyValue) return null;
  if (records.has(reference.legacyValue)) return reference.legacyValue;
  addOrphan(
    plan,
    reference.entityType,
    reference.entityId,
    reference.field,
    reference.legacyValue
  );
  return null;
}

function resolveSetReference(
  plan: WorkspacePlan,
  records: Set<string>,
  reference: {
    entityType: string;
    entityId: string;
    field: string;
    legacyValue: string | null;
  }
) {
  if (!reference.legacyValue) return null;
  if (records.has(reference.legacyValue)) return reference.legacyValue;
  addOrphan(
    plan,
    reference.entityType,
    reference.entityId,
    reference.field,
    reference.legacyValue
  );
  return null;
}

function emptyCounts(): EntityCounts {
  return {
    areas: 0,
    role_templates: 0,
    people: 0,
    processes: 0,
    process_versions: 0,
    routines: 0,
    routine_steps: 0,
    routine_assignments: 0,
    routine_occurrences: 0,
    task_occurrences: 0,
    task_checklist_items: 0,
    task_evidence: 0,
    operational_audit_log: 0
  };
}

function addCounts(target: EntityCounts, source: EntityCounts) {
  for (const table of entityTables) target[table] += source[table];
}

function readData(value: unknown): JsonRecord {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as JsonRecord
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(readData) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(optionalText).filter((item): item is string => Boolean(item))
    : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function optionalText(value: unknown) {
  const valueText = textValue(value)?.trim();
  return valueText ? valueText : null;
}

function sanitizedVisibleSnapshot(value: unknown, unresolvedIds: Array<string | null>) {
  const snapshot = optionalText(value);
  if (!snapshot) return null;
  const normalized = snapshot.toLowerCase();
  if (unresolvedIds.some((id) => id?.toLowerCase() === normalized)) return null;
  return snapshot;
}

function requiredText(value: unknown, fallback: string) {
  return optionalText(value) ?? fallback;
}

function booleanValue(value: unknown) {
  return value === true;
}

function positiveInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value: unknown, fallback: number) {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function recordTimestamp(value: unknown, fallback: string | Date) {
  const timestamp = optionalText(value);
  if (timestamp && !Number.isNaN(Date.parse(timestamp))) return timestamp;
  return fallback instanceof Date ? fallback.toISOString() : fallback;
}

function readDate(value: unknown) {
  const date = optionalText(value);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function readTime(value: string | null) {
  if (!value) return null;
  const match = value.match(/(?:^|\s)([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?:\s|$)/);
  return match ? `${match[1]}:${match[2]}:${match[3] ?? "00"}` : null;
}

function oneOf(value: unknown, options: readonly string[], fallback: string) {
  return typeof value === "string" && options.includes(value) ? value : fallback;
}

function approvalMode(value: unknown) {
  return oneOf(value, ["direct", "approval_required"], "direct");
}

function evidencePolicy(value: unknown) {
  return oneOf(
    value,
    ["optional", "comment_required", "photo_required", "photo_or_comment_required"],
    "optional"
  );
}

function taskStatus(value: unknown) {
  return oneOf(
    value,
    [
      "pending",
      "in_progress",
      "awaiting_approval",
      "completed",
      "needs_adjustment",
      "late",
      "dismissed"
    ],
    "pending"
  );
}

function routineOccurrenceStatus(taskStatusValue: string) {
  if (taskStatusValue === "completed" || taskStatusValue === "dismissed") return "completed";
  if (taskStatusValue === "pending" || taskStatusValue === "late") return "pending";
  return "in_progress";
}

function normalizeSchedule(data: JsonRecord) {
  const frequency = oneOf(data.frequency, ["daily", "weekly", "monthly", "on_demand"], "on_demand");
  const suppliedWeekdays = uniqueStrings(stringArray(data.weekdays))
    .filter((weekday) => ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(weekday));
  if (frequency === "daily") {
    return {
      frequency,
      weekdays: suppliedWeekdays.length > 0 ? suppliedWeekdays : ["mon", "tue", "wed", "thu", "fri"],
      monthDay: null
    };
  }
  if (frequency === "weekly") {
    return { frequency, weekdays: [suppliedWeekdays[0] ?? "mon"], monthDay: null };
  }
  if (frequency === "monthly") {
    const dueHintDay = Number(optionalText(data.dueHint)?.match(/\b([1-9]|[12]\d|3[01])\b/)?.[1]);
    return {
      frequency,
      weekdays: [],
      monthDay: positiveInteger(data.monthDay) ?? (dueHintDay >= 1 && dueHintDay <= 31 ? dueHintDay : 1)
    };
  }
  return { frequency, weekdays: [], monthDay: null };
}

function routineStepKey(routineId: string, stepId: string) {
  return `${routineId}\u0000${stepId}`;
}

function deterministicId(prefix: string, ...parts: string[]) {
  const digest = createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32);
  return `${prefix}_${digest}`;
}

function workspaceLock(workspaceId: string): [number, number] {
  const digest = createHash("sha256").update(workspaceId).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

function sortOrphans(orphanReferences: OrphanReference[]) {
  return [...orphanReferences].sort((left, right) => (
    left.workspaceId.localeCompare(right.workspaceId)
    || left.entityType.localeCompare(right.entityType)
    || left.entityId.localeCompare(right.entityId)
    || left.field.localeCompare(right.field)
    || left.legacyValue.localeCompare(right.legacyValue)
  ));
}

function sortSkipped(skippedRecords: SkippedRecord[]) {
  return [...skippedRecords].sort((left, right) => (
    left.workspaceId.localeCompare(right.workspaceId)
    || left.entityType.localeCompare(right.entityType)
    || left.entityId.localeCompare(right.entityId)
    || left.reason.localeCompare(right.reason)
  ));
}
