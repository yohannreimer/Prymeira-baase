export const BAASE_PRODUCT_KEY = "base" as const;

export type BaaseRole = "owner" | "manager" | "employee";

const homeRouteByRole: Record<BaaseRole, string> = {
  owner: "/painel",
  manager: "/gestor",
  employee: "/hoje"
};

export function readHomeRouteForRole(role: BaaseRole) {
  return homeRouteByRole[role];
}

export function canApproveTask(role: BaaseRole) {
  return role === "owner" || role === "manager";
}

export function canEditCompanyBase(role: BaaseRole) {
  return role === "owner";
}

export function canExecuteTask(role: BaaseRole) {
  return role === "owner" || role === "manager" || role === "employee";
}

export function canManageKnowledge(role: BaaseRole) {
  return role === "owner" || role === "manager";
}
