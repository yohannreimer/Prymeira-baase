import type { OperationalMembership } from "./company.types";

export function canReadAreaResource(member: OperationalMembership, areaId: string | null) {
  if (member.role === "owner" || member.accessScope === "workspace") return true;
  if (areaId === null) return member.accessScope !== "assigned_only";
  return member.accessScope === "area" && member.areaAccessIds.includes(areaId);
}

export function canManageAreaResource(member: OperationalMembership, areaId: string | null) {
  return member.role === "owner" || (member.role === "manager" && canReadAreaResource(member, areaId));
}

export function canExecuteTask(member: OperationalMembership, assigneeProfileId: string | null) {
  return member.role === "owner" || assigneeProfileId === member.personId;
}

export function canAdministerHubSeats(member: OperationalMembership) {
  return member.role === "owner" && member.accessScope === "workspace";
}
