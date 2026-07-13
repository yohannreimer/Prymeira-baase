import type { OperationalMembership } from "./company.types";

export type TaskAccessInput = {
  assigneeProfileId: string | null;
  areaId?: string | null;
};

export function canReadAreaResource(member: OperationalMembership, areaId: string | null) {
  if (member.role === "owner") return true;
  if (member.role === "employee") {
    if (areaId === null) return true;
    return member.person.areaId === areaId;
  }
  if (member.accessScope === "workspace") return true;
  if (areaId === null) return member.accessScope !== "assigned_only";
  return member.accessScope === "area" && member.areaAccessIds.includes(areaId);
}

export function canManageAreaResource(member: OperationalMembership, areaId: string | null) {
  if (member.role === "owner") return true;
  if (member.role !== "manager") return false;
  if (member.accessScope === "workspace") return true;
  return areaId !== null && canReadAreaResource(member, areaId);
}

export function canExecuteTask(member: OperationalMembership, task: TaskAccessInput) {
  if (member.role === "owner") return task.assigneeProfileId === null || task.assigneeProfileId === member.personId;
  if (member.role === "employee") return task.assigneeProfileId === member.personId;
  if (task.assigneeProfileId) return task.assigneeProfileId === member.personId;
  return task.areaId != null && canReadAreaResource(member, task.areaId);
}

export function visibleAreaIds(member: OperationalMembership) {
  if (member.role === "owner" || member.accessScope === "workspace") return null;
  if (member.role === "employee") return member.person.areaId ? [member.person.areaId] : [];
  return member.areaAccessIds;
}

export function canReadTask(member: OperationalMembership, task: TaskAccessInput) {
  if (member.role === "owner") return true;
  if (member.role === "employee") return task.assigneeProfileId === member.personId;
  if (task.assigneeProfileId) {
    return task.assigneeProfileId === member.personId
      || (task.areaId != null && canReadAreaResource(member, task.areaId));
  }
  return task.areaId != null && canReadAreaResource(member, task.areaId);
}

export function canAdministerHubSeats(member: OperationalMembership) {
  return member.role === "owner" && member.accessScope === "workspace";
}
