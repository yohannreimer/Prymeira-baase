import type { OperationalMembership } from "./company.types";

export type TaskAccessInput = {
  assigneeProfileId: string | null;
  areaId?: string | null;
};

export function canReadAreaResource(member: OperationalMembership, areaId: string | null) {
  if (member.role === "owner" || member.accessScope === "workspace") return true;
  if (areaId === null) return member.accessScope !== "assigned_only";
  return member.accessScope === "area" && member.areaAccessIds.includes(areaId);
}

export function canManageAreaResource(member: OperationalMembership, areaId: string | null) {
  return member.role === "owner" || (member.role === "manager" && canReadAreaResource(member, areaId));
}

export function canExecuteTask(member: OperationalMembership, input: TaskAccessInput | string | null) {
  const task = typeof input === "object" && input !== null
    ? input
    : { assigneeProfileId: input, areaId: null };

  if (member.role === "owner") return true;
  if (task.assigneeProfileId) return task.assigneeProfileId === member.personId;
  return task.areaId != null && canReadAreaResource(member, task.areaId);
}

export function canReadTask(member: OperationalMembership, input: TaskAccessInput) {
  if (member.role === "owner") return true;
  if (input.assigneeProfileId) {
    return input.assigneeProfileId === member.personId
      || (member.role === "manager" && input.areaId != null && canReadAreaResource(member, input.areaId));
  }
  return input.areaId != null && canReadAreaResource(member, input.areaId);
}

export function canAdministerHubSeats(member: OperationalMembership) {
  return member.role === "owner" && member.accessScope === "workspace";
}
