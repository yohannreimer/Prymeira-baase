import { canonicalJson, deterministicBackfillId } from "./deterministic-ids";
import type { ParsedLegacyWorkspace } from "./legacy-parse";
import {
  emptyPlannedRows,
  type EntityTable,
  type JsonRecord,
  type PlannedRow,
  type WorkspacePlan
} from "./types";

type ValidRow = ParsedLegacyWorkspace["validRows"][number];

type RoutineOccurrenceParentFields = {
  routine_id: string;
  due_date: string;
  audience_key: string;
  area_name_snapshot: string | null;
  routine_title_snapshot: string;
};

type RoutineOccurrenceContribution = {
  status: "pending" | "in_progress" | "completed";
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type RoutineOccurrenceGroup = {
  row: PlannedRow;
  sourceTaskId: string;
  parentFields: RoutineOccurrenceParentFields;
  taskSourceBySemanticKey: Map<string, string>;
  contributions: RoutineOccurrenceContribution[];
};

export function buildWorkspacePlan(
  workspaceId: string,
  parsed: ParsedLegacyWorkspace
): WorkspacePlan {
  const plan: WorkspacePlan = {
    workspaceId,
    sourceCounts: parsed.sourceCounts,
    rows: emptyPlannedRows(),
    orphanReferences: [],
    skippedRecords: [],
    conflictingRecords: [],
    malformedRecords: [...parsed.malformedRecords]
  };
  const byKind = new Map<string, ValidRow[]>();
  for (const row of parsed.validRows) {
    const rows = byKind.get(row.kind) ?? [];
    rows.push(row);
    byKind.set(row.kind, rows);
  }

  const areaById = new Map<string, JsonRecord>();
  for (const [index, row] of (byKind.get("area") ?? []).entries()) {
    const data = row.data;
    const values = {
      id: row.id,
      workspace_id: workspaceId,
      name: requiredText(data.name),
      description: optionalText(data.description),
      sort_order: nonNegativeInteger(data.sortOrder, index),
      archived_at: optionalText(data.archivedAt),
      created_at: timestamp(data.createdAt, row.created_at),
      updated_at: timestamp(data.updatedAt, row.updated_at)
    };
    addRow(plan, "areas", "area", row.id, values);
    areaById.set(row.id, values);
  }

  const roleIds = new Set<string>();
  for (const row of byKind.get("role_template") ?? []) {
    const data = row.data;
    const areaId = optionalText(data.areaId);
    if (!areaId || !areaById.has(areaId)) {
      if (areaId) addOrphan(plan, "role_template", row.id, "area_id", areaId);
      addSkipped(plan, "role_templates", "role_template", row.id,
        areaId ? `missing required area ${areaId}` : "missing required area");
      continue;
    }
    addRow(plan, "role_templates", "role_template", row.id, {
      id: row.id,
      workspace_id: workspaceId,
      area_id: areaId,
      name: requiredText(data.name),
      description: optionalText(data.description),
      archived_at: optionalText(data.archivedAt),
      created_at: timestamp(data.createdAt, row.created_at),
      updated_at: timestamp(data.updatedAt, row.updated_at)
    });
    roleIds.add(row.id);
  }

  const peopleIds = new Set((byKind.get("team_member") ?? []).map((row) => row.id));
  for (const row of byKind.get("team_member") ?? []) {
    const data = row.data;
    const status = text(data.status) ?? "active";
    addRow(plan, "people", "person", row.id, {
      id: row.id,
      workspace_id: workspaceId,
      name: requiredText(data.name),
      email: optionalText(data.email),
      role: requiredText(data.role),
      area_id: resolveMap(plan, areaById, "person", row.id, "area_id", optionalText(data.areaId)),
      role_template_id: resolveSet(
        plan,
        roleIds,
        "person",
        row.id,
        "role_template_id",
        optionalText(data.roleTemplateId)
      ),
      status,
      created_by_profile_id: optionalText(data.createdByProfileId) ?? row.id,
      archived_at: status === "archived"
        ? optionalText(data.archivedAt) ?? timestamp(data.updatedAt, row.updated_at)
        : optionalText(data.archivedAt),
      created_at: timestamp(data.createdAt, row.created_at),
      updated_at: timestamp(data.updatedAt, row.updated_at)
    });
  }

  const processIds = new Set((byKind.get("process") ?? []).map((row) => row.id));
  for (const row of byKind.get("process") ?? []) {
    planProcess(plan, row, areaById, peopleIds, roleIds);
  }

  const routineById = new Map<string, PlannedRow>();
  const stepByKey = new Map<string, PlannedRow>();
  const routineData = new Map<string, JsonRecord>();
  for (const row of byKind.get("routine") ?? []) {
    const data = row.data;
    const schedule = normalizedSchedule(data);
    const status = requiredText(data.status);
    const routine = addRow(plan, "routines", "routine", row.id, {
      id: row.id,
      workspace_id: workspaceId,
      area_id: resolveMap(plan, areaById, "routine", row.id, "area_id", optionalText(data.areaId)),
      title: requiredText(data.title),
      status,
      frequency: schedule.frequency,
      weekdays: schedule.weekdays,
      month_day: schedule.monthDay,
      execution_mode: text(data.executionMode)
        ?? (stringArray(data.assigneeProfileIds).length > 1 ? "individual" : "shared"),
      approval_mode: text(data.approvalMode) ?? "direct",
      evidence_policy: text(data.evidencePolicy) ?? "optional",
      evidence_reason: optionalText(data.evidenceReason),
      created_by_profile_id: optionalText(data.createdByProfileId) ?? row.id,
      archived_at: status === "archived"
        ? optionalText(data.archivedAt) ?? timestamp(data.updatedAt, row.updated_at)
        : optionalText(data.archivedAt),
      created_at: timestamp(data.createdAt, row.created_at),
      updated_at: timestamp(data.updatedAt, row.updated_at)
    });
    routineById.set(row.id, routine);
    routineData.set(row.id, data);

    const seenIds = new Set<string>();
    const seenSortOrders = new Set<number>();
    for (const [index, template] of recordArray(data.taskTemplates).entries()) {
      const sortOrder = positiveInteger(template.sortOrder) ?? index + 1;
      const stepId = optionalText(template.id) ?? deterministicBackfillId("legacy_step", {
        entityKind: "routine_step",
        workspaceId,
        routineId: row.id,
        sortOrder
      });
      let duplicate = false;
      if (seenIds.has(stepId)) {
        addConflict(plan, "routine_step", stepId, `${row.id}:${stepId}`, "duplicate source routine step id");
        duplicate = true;
      }
      if (seenSortOrders.has(sortOrder)) {
        addConflict(plan, "routine_step", stepId, `${row.id}:${sortOrder}`, "duplicate source routine step sort order");
        duplicate = true;
      }
      if (duplicate) continue;
      seenIds.add(stepId);
      seenSortOrders.add(sortOrder);
      const dueHint = optionalText(template.dueHint);
      const deadlineTime = readTime(dueHint);
      const step = addRow(plan, "routine_steps", "routine_step", stepId, {
        id: stepId,
        workspace_id: workspaceId,
        routine_id: row.id,
        title: requiredText(template.title),
        process_id: resolveSet(
          plan,
          processIds,
          "routine_step",
          stepId,
          "process_id",
          optionalText(template.processId)
        ),
        instruction_timing: deadlineTime ? null : dueHint,
        deadline_time: deadlineTime,
        approval_mode: text(template.approvalMode) ?? "direct",
        evidence_policy: text(template.evidencePolicy) ?? "optional",
        evidence_reason: optionalText(template.evidenceReason),
        sort_order: sortOrder,
        created_at: timestamp(template.createdAt, row.created_at),
        updated_at: timestamp(template.updatedAt, row.updated_at)
      });
      stepByKey.set(stepKey(row.id, stepId), step);
    }
  }

  for (const routine of plan.rows.routines) {
    const data = routineData.get(routine.entityId) ?? {};
    for (const profileId of stringArray(data.assigneeProfileIds)) {
      addAssignment(plan, peopleIds, roleIds, routine, null, "profile", profileId);
    }
    for (const roleId of stringArray(data.assigneeRoleTemplateIds)) {
      addAssignment(plan, peopleIds, roleIds, routine, null, "role", roleId);
    }
    for (const [index, template] of recordArray(data.taskTemplates).entries()) {
      const sortOrder = positiveInteger(template.sortOrder) ?? index + 1;
      const stepId = optionalText(template.id) ?? deterministicBackfillId("legacy_step", {
        entityKind: "routine_step",
        workspaceId,
        routineId: routine.entityId,
        sortOrder
      });
      if (!stepByKey.has(stepKey(routine.entityId, stepId))) continue;
      const profileId = optionalText(template.assigneeProfileId);
      const roleId = optionalText(template.assigneeRoleTemplateId);
      if (profileId) addAssignment(plan, peopleIds, roleIds, routine, stepId, "profile", profileId);
      if (roleId) addAssignment(plan, peopleIds, roleIds, routine, stepId, "role", roleId);
    }
  }

  const occurrenceGroups = new Map<string, RoutineOccurrenceGroup>();
  for (const row of byKind.get("task_occurrence") ?? []) {
    planTask(plan, row, areaById, processIds, peopleIds, routineById, stepByKey, occurrenceGroups);
  }
  const uniqueRoutineOccurrenceGroups = occurrenceGroups.size;
  plan.sourceCounts.routine_occurrences = uniqueRoutineOccurrenceGroups;

  for (const orphan of plan.orphanReferences) {
    const id = deterministicBackfillId("legacy_unresolved", {
      entityKind: "operational_audit",
      workspaceId,
      entityType: orphan.entityType,
      entityId: orphan.entityId,
      field: orphan.field,
      legacyValue: orphan.legacyValue
    });
    addRow(plan, "operational_audit_log", "operational_audit", id, {
      id,
      workspace_id: workspaceId,
      entity_type: orphan.entityType,
      entity_id: orphan.entityId,
      action: "legacy_reference_unresolved",
      actor_profile_id: null,
      details: { field: orphan.field, legacyValue: orphan.legacyValue }
    });
  }
  plan.sourceCounts.operational_audit_log = plan.orphanReferences.length;
  return plan;
}

function planProcess(
  plan: WorkspacePlan,
  row: ValidRow,
  areaById: Map<string, JsonRecord>,
  peopleIds: Set<string>,
  roleIds: Set<string>
) {
  const data = row.data;
  const versions = recordArray(data.versions);
  const current = isRecord(data.currentVersion) ? data.currentVersion : null;
  const seenNumbers = new Map<number, JsonRecord>();
  const accepted: Array<[number, JsonRecord]> = [];
  for (const version of versions) {
    const number = positiveInteger(version.version);
    if (!number) continue;
    if (seenNumbers.has(number)) {
      addConflict(plan, "process_version", optionalText(version.id) ?? row.id,
        `${row.id}:${number}`, "duplicate source process version number");
      continue;
    }
    seenNumbers.set(number, version);
    accepted.push([number, version]);
  }
  const currentNumber = current ? positiveInteger(current.version) : null;
  if (current && currentNumber) {
    const historical = seenNumbers.get(currentNumber);
    if (!historical) {
      accepted.push([currentNumber, current]);
    } else if (canonicalVersion(historical) !== canonicalVersion(current)) {
      addConflict(plan, "process_version", optionalText(current.id) ?? row.id,
        `${row.id}:${currentNumber}`, "current process version differs from version history",
        canonicalVersion(historical), canonicalVersion(current));
    }
  }
  accepted.sort(([left], [right]) => left - right);

  const ownerProfileId = resolveSet(
    plan,
    peopleIds,
    "process",
    row.id,
    "owner_profile_id",
    optionalText(data.ownerProfileId)
  );
  const ownerRoleTemplateId = ownerProfileId
    ? null
    : resolveSet(
      plan,
      roleIds,
      "process",
      row.id,
      "owner_role_template_id",
      optionalText(data.ownerRoleTemplateId)
    );
  const status = text(data.status) ?? "draft";
  addRow(plan, "processes", "process", row.id, {
    id: row.id,
    workspace_id: plan.workspaceId,
    area_id: resolveMap(plan, areaById, "process", row.id, "area_id", optionalText(data.areaId)),
    title: requiredText(data.title),
    summary: optionalText(data.summary),
    status,
    owner_profile_id: ownerProfileId,
    owner_role_template_id: ownerRoleTemplateId,
    current_version: currentNumber ?? accepted.at(-1)?.[0] ?? 1,
    created_by_profile_id: optionalText(data.createdByProfileId) ?? row.id,
    published_at: optionalText(data.publishedAt),
    archived_at: status === "archived"
      ? optionalText(data.archivedAt) ?? timestamp(data.updatedAt, row.updated_at)
      : optionalText(data.archivedAt),
    created_at: timestamp(data.createdAt, row.created_at),
    updated_at: timestamp(data.updatedAt, row.updated_at)
  });

  for (const [versionNumber, version] of accepted) {
    const id = optionalText(version.id) ?? deterministicBackfillId("legacy_process_version", {
      entityKind: "process_version",
      workspaceId: plan.workspaceId,
      processId: row.id,
      versionNumber
    });
    addRow(plan, "process_versions", "process_version", id, {
      id,
      workspace_id: plan.workspaceId,
      process_id: row.id,
      version_number: versionNumber,
      title: requiredText(version.title),
      body: text(version.body) ?? "",
      change_note: text(version.changeNote) ?? "",
      editor_profile_id: optionalText(version.editorProfileId) ?? optionalText(data.createdByProfileId) ?? row.id,
      created_at: timestamp(version.createdAt, row.created_at)
    });
  }
}

function planTask(
  plan: WorkspacePlan,
  row: ValidRow,
  areaById: Map<string, JsonRecord>,
  processIds: Set<string>,
  peopleIds: Set<string>,
  routineById: Map<string, PlannedRow>,
  stepByKey: Map<string, PlannedRow>,
  occurrenceGroups: Map<string, RoutineOccurrenceGroup>
) {
  const data = row.data;
  const legacyRoutineId = optionalText(data.routineId);
  const legacyStepId = optionalText(data.taskTemplateId) ?? optionalText(data.routineStepId);
  const requestedRoutine = data.origin === "routine" || (data.origin !== "manual" && Boolean(legacyRoutineId));
  const routine = legacyRoutineId ? routineById.get(legacyRoutineId) : undefined;
  const step = routine && legacyStepId ? stepByKey.get(stepKey(routine.entityId, legacyStepId)) : undefined;
  const unresolvedRoutineId = legacyRoutineId && !routine ? legacyRoutineId : null;
  const unresolvedStepId = legacyStepId && !step ? legacyStepId : null;
  if (requestedRoutine && unresolvedRoutineId) addOrphan(plan, "task_occurrence", row.id, "routine_id", unresolvedRoutineId);
  if (requestedRoutine && unresolvedStepId) addOrphan(plan, "task_occurrence", row.id, "routine_step_id", unresolvedStepId);
  const routineOrigin = requestedRoutine && Boolean(routine && step);

  const legacyAreaId = optionalText(data.areaId);
  let areaId = resolveMap(plan, areaById, "task_occurrence", row.id, "area_id", legacyAreaId);
  const unresolvedAreaId = legacyAreaId && !areaId ? legacyAreaId : null;
  if (!areaId && !legacyAreaId && routine) areaId = optionalText(routine.values.area_id);
  const forbidden = [legacyAreaId, legacyRoutineId, legacyStepId];
  const areaSnapshot = visible(data.areaNameSnapshot, forbidden)
    ?? (areaId ? optionalText(areaById.get(areaId)?.name) : null);
  const routineSnapshot = visible(data.routineTitleSnapshot, forbidden)
    ?? optionalText(routine?.values.title);
  const stepSnapshot = visible(data.stepTitleSnapshot, forbidden)
    ?? optionalText(step?.values.title)
    ?? visible(data.title, forbidden)
    ?? "Etapa removida";
  const assignee = resolveSet(
    plan,
    peopleIds,
    "task_occurrence",
    row.id,
    "assignee_profile_id",
    optionalText(data.assigneeProfileId)
  );
  const submittedBy = resolveSet(
    plan,
    peopleIds,
    "task_occurrence",
    row.id,
    "submitted_by_profile_id",
    optionalText(data.submittedByProfileId)
  );
  const reviewedBy = resolveSet(
    plan,
    peopleIds,
    "task_occurrence",
    row.id,
    "reviewed_by_profile_id",
    optionalText(data.reviewedByProfileId)
  );
  const dueDate = requiredText(data.dueDate);
  const audienceKey = routineOrigin
    ? optionalText(data.audienceKey) ?? (assignee ? `profile:${assignee}` : "all")
    : null;
  const status = requiredText(data.status);
  const completedAt = optionalText(data.completedAt)
    ?? (status === "completed" ? optionalText(data.submittedAt) ?? timestamp(data.updatedAt, row.updated_at) : null);
  addRow(plan, "task_occurrences", "task_occurrence", row.id, {
    id: row.id,
    workspace_id: plan.workspaceId,
    origin: routineOrigin ? "routine" : "manual",
    routine_id: routineOrigin ? routine?.entityId ?? null : null,
    routine_step_id: routineOrigin ? step?.entityId ?? null : null,
    area_id: areaId,
    process_id: resolveSet(plan, processIds, "task_occurrence", row.id, "process_id", optionalText(data.processId)),
    assignee_profile_id: assignee,
    audience_key: audienceKey,
    title: requiredText(data.title),
    area_name_snapshot: areaSnapshot,
    routine_title_snapshot: requestedRoutine ? routineSnapshot : null,
    step_title_snapshot: stepSnapshot,
    approval_mode: requiredText(data.approvalMode),
    evidence_policy: requiredText(data.evidencePolicy),
    evidence_reason: optionalText(data.evidenceReason),
    status,
    due_date: dueDate,
    due_time: readTime(optionalText(data.dueTime) ?? optionalText(data.dueHint)),
    submitted_by_profile_id: submittedBy,
    submitted_at: optionalText(data.submittedAt),
    reviewed_by_profile_id: reviewedBy,
    reviewed_at: optionalText(data.reviewedAt),
    review_comment: optionalText(data.reviewComment),
    completed_at: completedAt,
    created_at: timestamp(data.createdAt, row.created_at),
    updated_at: timestamp(data.updatedAt, row.updated_at)
  });

  if (routineOrigin && routine && audienceKey) {
    const parentKey = canonicalJson({
      entityKind: "routine_occurrence",
      routineId: routine.entityId,
      dueDate,
      audienceKey
    });
    const parentFields: RoutineOccurrenceParentFields = {
      routine_id: routine.entityId,
      due_date: dueDate,
      audience_key: audienceKey,
      area_name_snapshot: areaSnapshot,
      routine_title_snapshot: routineSnapshot ?? requiredText(routine.values.title)
    };
    let group = occurrenceGroups.get(parentKey);
    if (!group) {
      const id = deterministicBackfillId("legacy_occurrence", {
        entityKind: "routine_occurrence",
        workspaceId: plan.workspaceId,
        routineId: routine.entityId,
        dueDate,
        audienceKey
      });
      const parentRow = addRow(plan, "routine_occurrences", "routine_occurrence", id, {
        id,
        workspace_id: plan.workspaceId,
        ...parentFields,
        status: "pending",
        completed_at: null,
        created_at: timestamp(data.createdAt, row.created_at),
        updated_at: timestamp(data.updatedAt, row.updated_at)
      });
      group = {
        row: parentRow,
        sourceTaskId: row.id,
        parentFields,
        taskSourceBySemanticKey: new Map(),
        contributions: []
      };
      occurrenceGroups.set(parentKey, group);
    } else {
      const paths = parentFieldDifferences(group.parentFields, parentFields);
      if (paths.length > 0) {
        addConflict(
          plan,
          "routine_occurrence",
          group.row.entityId,
          parentKey,
          "routine occurrence contributors disagree on parent fields",
          { sourceTaskId: group.sourceTaskId, values: group.parentFields },
          { sourceTaskId: row.id, paths, values: parentFields }
        );
      }
    }

    const taskSemanticKey = canonicalJson({
      entityKind: "routine_task_occurrence",
      routineId: routine.entityId,
      routineStepId: step?.entityId ?? null,
      dueDate,
      audienceKey
    });
    const existingTaskId = group.taskSourceBySemanticKey.get(taskSemanticKey);
    if (existingTaskId) {
      addConflict(
        plan,
        "task_occurrence",
        row.id,
        taskSemanticKey,
        "duplicate source routine task semantic key",
        { sourceTaskId: existingTaskId },
        { sourceTaskId: row.id }
      );
    } else {
      group.taskSourceBySemanticKey.set(taskSemanticKey, row.id);
    }
    group.contributions.push({
      status: occurrenceStatus(status),
      completedAt,
      createdAt: timestamp(data.createdAt, row.created_at),
      updatedAt: timestamp(data.updatedAt, row.updated_at)
    });
    applyRoutineOccurrenceSemantics(group);
  }

  const seenChecklistIds = new Set<string>();
  const seenChecklistOrders = new Set<number>();
  for (const [index, item] of recordArray(data.checklistItems).entries()) {
    const sortOrder = positiveInteger(item.sortOrder) ?? index + 1;
    const id = optionalText(item.id) ?? deterministicBackfillId("legacy_checklist", {
      entityKind: "task_checklist_item",
      workspaceId: plan.workspaceId,
      taskOccurrenceId: row.id,
      sortOrder
    });
    let duplicate = false;
    if (seenChecklistIds.has(id)) {
      addConflict(plan, "task_checklist_item", id, `${row.id}:${id}`, "duplicate source checklist id");
      duplicate = true;
    }
    if (seenChecklistOrders.has(sortOrder)) {
      addConflict(plan, "task_checklist_item", id, `${row.id}:${sortOrder}`, "duplicate source checklist sort order");
      duplicate = true;
    }
    if (duplicate) continue;
    seenChecklistIds.add(id);
    seenChecklistOrders.add(sortOrder);
    addRow(plan, "task_checklist_items", "task_checklist_item", id, {
      id,
      workspace_id: plan.workspaceId,
      task_occurrence_id: row.id,
      title: requiredText(item.title),
      sort_order: sortOrder,
      is_completed: item.isCompleted === true || item.done === true,
      completed_by_profile_id: resolveSet(
        plan,
        peopleIds,
        "task_checklist_item",
        id,
        "completed_by_profile_id",
        optionalText(item.completedByProfileId)
      ),
      completed_at: optionalText(item.completedAt),
      created_at: timestamp(item.createdAt, row.created_at),
      updated_at: timestamp(item.updatedAt, row.updated_at)
    });
  }
  addEvidence(plan, row, data, peopleIds, assignee, submittedBy);
}

function addEvidence(
  plan: WorkspacePlan,
  row: ValidRow,
  data: JsonRecord,
  peopleIds: Set<string>,
  assignee: string | null,
  submittedBy: string | null
) {
  const items = Array.isArray(data.evidence)
    ? data.evidence.filter(isRecord)
    : isRecord(data.evidence) ? [data.evidence] : [];
  for (const [index, evidence] of items.entries()) {
    const components = [
      optionalText(evidence.comment)
        ? { kind: "comment", comment: optionalText(evidence.comment), photo_url: null, object_key: null }
        : null,
      optionalText(evidence.photoUrl) || optionalText(evidence.objectKey)
        ? {
          kind: "photo",
          comment: null,
          photo_url: optionalText(evidence.photoUrl),
          object_key: optionalText(evidence.objectKey)
        }
        : null
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));
    for (const component of components) {
      const baseId = optionalText(evidence.id);
      const id = baseId && components.length === 1 ? baseId : deterministicBackfillId("legacy_evidence", {
        entityKind: "task_evidence",
        workspaceId: plan.workspaceId,
        taskOccurrenceId: row.id,
        sourceEvidenceId: baseId,
        sourceIndex: index,
        evidenceKind: component.kind
      });
      const explicitProfile = optionalText(evidence.profileId);
      if (explicitProfile && !peopleIds.has(explicitProfile)) {
        addOrphan(plan, "task_evidence", id, "profile_id", explicitProfile);
        addSkipped(plan, "task_evidence", "task_evidence", id, "missing evidence profile");
        continue;
      }
      const profileId = explicitProfile ?? submittedBy ?? assignee;
      if (!profileId) {
        addSkipped(plan, "task_evidence", "task_evidence", id, "missing evidence profile");
        continue;
      }
      addRow(plan, "task_evidence", "task_evidence", id, {
        id,
        workspace_id: plan.workspaceId,
        task_occurrence_id: row.id,
        profile_id: profileId,
        kind: component.kind,
        comment: component.comment,
        photo_url: component.photo_url,
        object_key: component.object_key,
        created_at: timestamp(evidence.createdAt, row.updated_at)
      });
    }
  }
}

function addAssignment(
  plan: WorkspacePlan,
  peopleIds: Set<string>,
  roleIds: Set<string>,
  routine: PlannedRow,
  stepId: string | null,
  kind: "profile" | "role",
  value: string
) {
  const id = deterministicBackfillId("legacy_assignment", {
    entityKind: "routine_assignment",
    workspaceId: plan.workspaceId,
    routineId: routine.entityId,
    scope: stepId === null ? { type: "general" } : { type: "step", stepId },
    assignee: { type: kind, id: value }
  });
  const valid = kind === "profile" ? peopleIds.has(value) : roleIds.has(value);
  if (!valid) {
    addOrphan(plan, "routine_assignment", id, kind === "profile" ? "profile_id" : "role_template_id", value);
    addSkipped(plan, "routine_assignments", "routine_assignment", id,
      kind === "profile" ? `missing profile ${value}` : `missing role template ${value}`);
    return;
  }
  addRow(plan, "routine_assignments", "routine_assignment", id, {
    id,
    workspace_id: plan.workspaceId,
    routine_id: routine.entityId,
    routine_step_id: stepId,
    profile_id: kind === "profile" ? value : null,
    role_template_id: kind === "role" ? value : null,
    created_at: routine.values.created_at,
    updated_at: routine.values.updated_at
  });
}

function addRow(
  plan: WorkspacePlan,
  table: EntityTable,
  entityType: string,
  entityId: string,
  values: JsonRecord
) {
  const existing = plan.rows[table].find((row) => row.entityId === entityId);
  if (existing) {
    addConflict(
      plan,
      entityType,
      entityId,
      `${table}:${entityId}`,
      "duplicate source target id",
      existing.values,
      values
    );
    return existing;
  }
  const row = { table, entityType, entityId, values };
  plan.rows[table].push(row);
  return row;
}

function addOrphan(plan: WorkspacePlan, entityType: string, entityId: string, field: string, legacyValue: string) {
  if (plan.orphanReferences.some((item) => item.entityType === entityType
    && item.entityId === entityId && item.field === field && item.legacyValue === legacyValue)) return;
  plan.orphanReferences.push({ workspaceId: plan.workspaceId, entityType, entityId, field, legacyValue });
}

function addSkipped(
  plan: WorkspacePlan,
  table: EntityTable,
  entityType: string,
  entityId: string,
  reason: string
) {
  plan.skippedRecords.push({ workspaceId: plan.workspaceId, table, entityType, entityId, reason });
}

function addConflict(
  plan: WorkspacePlan,
  entityType: string,
  entityId: string,
  key: string,
  reason: string,
  expected?: unknown,
  actual?: unknown
) {
  plan.conflictingRecords.push({
    workspaceId: plan.workspaceId,
    entityType,
    entityId,
    key,
    reason,
    expected,
    actual
  });
}

function resolveMap(
  plan: WorkspacePlan,
  records: Map<string, unknown>,
  entityType: string,
  entityId: string,
  field: string,
  value: string | null
) {
  if (!value) return null;
  if (records.has(value)) return value;
  addOrphan(plan, entityType, entityId, field, value);
  return null;
}

function resolveSet(
  plan: WorkspacePlan,
  records: Set<string>,
  entityType: string,
  entityId: string,
  field: string,
  value: string | null
) {
  if (!value) return null;
  if (records.has(value)) return value;
  addOrphan(plan, entityType, entityId, field, value);
  return null;
}

function canonicalVersion(version: JsonRecord) {
  return canonicalJson({
    version: version.version,
    title: version.title,
    body: version.body,
    changeNote: version.changeNote,
    editorProfileId: version.editorProfileId,
    createdAt: version.createdAt
  });
}

function normalizedSchedule(data: JsonRecord) {
  const frequency = text(data.frequency) ?? "on_demand";
  const weekdays = unique(stringArray(data.weekdays));
  if (frequency === "daily") {
    return { frequency, weekdays: weekdays.length ? weekdays : ["mon", "tue", "wed", "thu", "fri"], monthDay: null };
  }
  if (frequency === "weekly") return { frequency, weekdays: [weekdays[0] ?? "mon"], monthDay: null };
  if (frequency === "monthly") {
    const hinted = Number(optionalText(data.dueHint)?.match(/\b([1-9]|[12]\d|3[01])\b/)?.[1]);
    return { frequency, weekdays: [], monthDay: positiveInteger(data.monthDay) ?? (hinted || 1) };
  }
  return { frequency, weekdays: [], monthDay: null };
}

function occurrenceStatus(status: string) {
  if (status === "completed" || status === "dismissed") return "completed";
  if (status === "pending" || status === "late") return "pending";
  return "in_progress";
}

function parentFieldDifferences(
  expected: RoutineOccurrenceParentFields,
  actual: RoutineOccurrenceParentFields
) {
  return (Object.keys(expected) as Array<keyof RoutineOccurrenceParentFields>)
    .filter((field) => expected[field] !== actual[field])
    .sort();
}

function applyRoutineOccurrenceSemantics(group: RoutineOccurrenceGroup) {
  const statuses = group.contributions.map((item) => item.status);
  const allCompleted = statuses.every((status) => status === "completed");
  const allPending = statuses.every((status) => status === "pending");
  group.row.values.status = allCompleted ? "completed" : allPending ? "pending" : "in_progress";
  group.row.values.completed_at = allCompleted
    ? latestTimestamp(group.contributions.map((item) => item.completedAt).filter(isString))
    : null;
  group.row.values.created_at = earliestTimestamp(group.contributions.map((item) => item.createdAt));
  group.row.values.updated_at = latestTimestamp(group.contributions.map((item) => item.updatedAt));
}

function earliestTimestamp(values: string[]) {
  return [...values].sort(compareTimestamp)[0] ?? null;
}

function latestTimestamp(values: string[]) {
  return [...values].sort(compareTimestamp).at(-1) ?? null;
}

function compareTimestamp(left: string, right: string) {
  return Date.parse(left) - Date.parse(right);
}

function isString(value: string | null): value is string {
  return value !== null;
}

function visible(value: unknown, forbidden: Array<string | null>) {
  const result = optionalText(value);
  if (!result) return null;
  const normalized = result.toLowerCase();
  return forbidden.some((item) => item?.toLowerCase() === normalized) ? null : result;
}

function timestamp(value: unknown, fallback: string | Date) {
  return optionalText(value) ?? (fallback instanceof Date ? fallback.toISOString() : fallback);
}

function readTime(value: string | null) {
  if (!value) return null;
  const match = value.match(/(?:^|\s)([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?:\s|$)/);
  return match ? `${match[1]}:${match[2]}:${match[3] ?? "00"}` : null;
}

function stepKey(routineId: string, stepId: string) {
  return canonicalJson({ entityKind: "routine_step", routineId, stepId });
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordArray(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(optionalText).filter((item): item is string => Boolean(item)) : [];
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function text(value: unknown) {
  return typeof value === "string" ? value : null;
}

function optionalText(value: unknown) {
  const result = text(value)?.trim();
  return result || null;
}

function requiredText(value: unknown) {
  const result = optionalText(value);
  if (!result) throw new Error("Validated legacy text is unexpectedly missing");
  return result;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function nonNegativeInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}
