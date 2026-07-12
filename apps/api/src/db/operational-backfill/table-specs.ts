import type { EntityTable } from "./types";

export type TableSpec = {
  table: EntityTable;
  columns: readonly string[];
  casts?: Readonly<Record<string, string>>;
  columnTypes?: Readonly<Record<string, "date" | "time" | "timestamp">>;
};

export const tableSpecs: Record<EntityTable, TableSpec> = {
  areas: spec("areas", [
    "id", "workspace_id", "name", "description", "sort_order", "archived_at", "created_at", "updated_at"
  ], undefined, temporal(
    ["archived_at", "timestamp"], ["created_at", "timestamp"], ["updated_at", "timestamp"]
  )),
  role_templates: spec("role_templates", [
    "id", "workspace_id", "area_id", "name", "description", "archived_at", "created_at", "updated_at"
  ], undefined, temporal(
    ["archived_at", "timestamp"], ["created_at", "timestamp"], ["updated_at", "timestamp"]
  )),
  people: spec("people", [
    "id", "workspace_id", "name", "email", "role", "area_id", "role_template_id", "status",
    "created_by_profile_id", "archived_at", "created_at", "updated_at"
  ], undefined, temporal(
    ["archived_at", "timestamp"], ["created_at", "timestamp"], ["updated_at", "timestamp"]
  )),
  processes: spec("processes", [
    "id", "workspace_id", "area_id", "title", "summary", "status", "owner_profile_id",
    "owner_role_template_id", "current_version", "created_by_profile_id", "published_at", "archived_at",
    "created_at", "updated_at"
  ], undefined, temporal(
    ["published_at", "timestamp"], ["archived_at", "timestamp"],
    ["created_at", "timestamp"], ["updated_at", "timestamp"]
  )),
  process_versions: spec("process_versions", [
    "id", "workspace_id", "process_id", "version_number", "title", "body", "change_note",
    "editor_profile_id", "created_at"
  ], undefined, temporal(["created_at", "timestamp"])),
  routines: spec("routines", [
    "id", "workspace_id", "area_id", "title", "status", "frequency", "weekdays", "month_day",
    "execution_mode", "approval_mode", "evidence_policy", "evidence_reason", "created_by_profile_id",
    "archived_at", "created_at", "updated_at"
  ], { weekdays: "::text[]" }, temporal(
    ["archived_at", "timestamp"], ["created_at", "timestamp"], ["updated_at", "timestamp"]
  )),
  routine_steps: spec("routine_steps", [
    "id", "workspace_id", "routine_id", "title", "process_id", "instruction_timing", "deadline_time",
    "approval_mode", "evidence_policy", "evidence_reason", "sort_order", "created_at", "updated_at"
  ], undefined, temporal(
    ["deadline_time", "time"], ["created_at", "timestamp"], ["updated_at", "timestamp"]
  )),
  routine_assignments: spec("routine_assignments", [
    "id", "workspace_id", "routine_id", "routine_step_id", "profile_id", "role_template_id",
    "created_at", "updated_at"
  ], undefined, temporal(["created_at", "timestamp"], ["updated_at", "timestamp"])),
  routine_occurrences: spec("routine_occurrences", [
    "id", "workspace_id", "routine_id", "due_date", "audience_key", "area_name_snapshot",
    "routine_title_snapshot", "status", "completed_at", "created_at", "updated_at"
  ], undefined, temporal(
    ["due_date", "date"], ["completed_at", "timestamp"],
    ["created_at", "timestamp"], ["updated_at", "timestamp"]
  )),
  task_occurrences: spec("task_occurrences", [
    "id", "workspace_id", "origin", "routine_id", "routine_step_id", "area_id", "process_id",
    "assignee_profile_id", "audience_key", "title", "area_name_snapshot", "routine_title_snapshot",
    "step_title_snapshot", "approval_mode", "evidence_policy", "evidence_reason", "status", "due_date",
    "due_time", "submitted_by_profile_id", "submitted_at", "reviewed_by_profile_id", "reviewed_at",
    "review_comment", "completed_at", "created_at", "updated_at"
  ], undefined, temporal(
    ["due_date", "date"], ["due_time", "time"], ["submitted_at", "timestamp"],
    ["reviewed_at", "timestamp"], ["completed_at", "timestamp"],
    ["created_at", "timestamp"], ["updated_at", "timestamp"]
  )),
  task_checklist_items: spec("task_checklist_items", [
    "id", "workspace_id", "task_occurrence_id", "title", "sort_order", "is_completed",
    "completed_by_profile_id", "completed_at", "created_at", "updated_at"
  ], undefined, temporal(
    ["completed_at", "timestamp"], ["created_at", "timestamp"], ["updated_at", "timestamp"]
  )),
  task_evidence: spec("task_evidence", [
    "id", "workspace_id", "task_occurrence_id", "profile_id", "kind", "comment", "photo_url",
    "object_key", "created_at"
  ], undefined, temporal(["created_at", "timestamp"])),
  operational_audit_log: spec("operational_audit_log", [
    "id", "workspace_id", "entity_type", "entity_id", "action", "actor_profile_id", "details"
  ], { details: "::jsonb" })
};

function spec(
  table: EntityTable,
  columns: readonly string[],
  casts?: Readonly<Record<string, string>>,
  columnTypes?: TableSpec["columnTypes"]
): TableSpec {
  return { table, columns, casts, columnTypes };
}

function temporal(
  ...entries: Array<[string, "date" | "time" | "timestamp"]>
): Readonly<Record<string, "date" | "time" | "timestamp">> {
  return Object.fromEntries(entries);
}
