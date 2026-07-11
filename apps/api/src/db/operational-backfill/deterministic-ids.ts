import { createHash } from "node:crypto";

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | {
  [key: string]: CanonicalValue;
};

function canonicalize(value: unknown): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Deterministic ID input must contain finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  throw new Error(`Unsupported deterministic ID input type: ${typeof value}`);
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export type DeterministicIdentityByPrefix = {
  legacy_step: { entityKind: "routine_step"; workspaceId: string; routineId: string; sortOrder: number };
  legacy_unresolved: { entityKind: "operational_audit"; workspaceId: string; entityType: string; entityId: string; field: string; legacyValue: string };
  legacy_individual_execution_step: { entityKind: "task_occurrence"; workspaceId: string; sourceTaskOccurrenceId: string; routineId: string; routineStepId: string; assigneeProfileId: string };
  legacy_process_version: { entityKind: "process_version"; workspaceId: string; processId: string; versionNumber: number };
  legacy_occurrence: { entityKind: "routine_occurrence"; workspaceId: string; routineId: string; dueDate: string; audienceKey: string };
  legacy_checklist: { entityKind: "task_checklist_item"; workspaceId: string; taskOccurrenceId: string; sortOrder: number };
  legacy_evidence: { entityKind: "task_evidence"; workspaceId: string; taskOccurrenceId: string; sourceEvidenceId: string | null; sourceIndex: number; evidenceKind: string };
  legacy_assignment: { entityKind: "routine_assignment"; workspaceId: string; routineId: string; scope: { type: "general" } | { type: "step"; stepId: string }; assignee: { type: "profile" | "role"; id: string } };
};

export function deterministicBackfillId<P extends keyof DeterministicIdentityByPrefix>(
  prefix: P,
  identity: DeterministicIdentityByPrefix[P]
): `${P}_${string}` {
  const digest = createHash("sha256")
    .update(canonicalJson({ prefix, identity }))
    .digest("hex")
    .slice(0, 32);
  return `${prefix}_${digest}`;
}
