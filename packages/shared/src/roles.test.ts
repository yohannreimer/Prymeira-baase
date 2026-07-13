import { describe, expect, it } from "vitest";
import {
  BAASE_PRODUCT_KEY,
  canAccessOwnerStudio,
  canApproveTask,
  canEditCompanyBase,
  canExecuteTask,
  canManageKnowledge,
  readHomeRouteForRole,
  type BaaseRole
} from "./roles";

describe("Baase roles", () => {
  it("uses the stable Prymeira Account product key", () => {
    expect(BAASE_PRODUCT_KEY).toBe("base");
  });

  it.each<[BaaseRole, string]>([
    ["owner", "/painel"],
    ["manager", "/gestor"],
    ["employee", "/hoje"]
  ])("routes %s to the correct role home", (role, route) => {
    expect(readHomeRouteForRole(role)).toBe(route);
  });

  it("lets owners and managers approve tasks, but not employees", () => {
    expect(canApproveTask("owner")).toBe(true);
    expect(canApproveTask("manager")).toBe(true);
    expect(canApproveTask("employee")).toBe(false);
  });

  it("lets owners edit the company base and keeps managers/ employees constrained", () => {
    expect(canEditCompanyBase("owner")).toBe(true);
    expect(canEditCompanyBase("manager")).toBe(false);
    expect(canEditCompanyBase("employee")).toBe(false);
  });

  it("lets all signed company members execute assigned tasks", () => {
    expect(canExecuteTask("owner")).toBe(true);
    expect(canExecuteTask("manager")).toBe(true);
    expect(canExecuteTask("employee")).toBe(true);
  });

  it("lets owners and managers manage operational knowledge", () => {
    expect(canManageKnowledge("owner")).toBe(true);
    expect(canManageKnowledge("manager")).toBe(true);
    expect(canManageKnowledge("employee")).toBe(false);
  });

  it.each([
    ["owner", true],
    ["manager", false],
    ["employee", false]
  ] as const)("returns Studio access for %s", (role, expected) => {
    expect(canAccessOwnerStudio(role)).toBe(expected);
  });
});
