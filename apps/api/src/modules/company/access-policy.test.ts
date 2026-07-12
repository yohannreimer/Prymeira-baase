import { describe, expect, it } from "vitest";
import { canAdministerHubSeats, canExecuteTask, canManageAreaResource, canReadAreaResource } from "./access-policy";
import type { OperationalMembership } from "./company.types";

const member = (overrides: Partial<OperationalMembership>): OperationalMembership => ({
  person: {} as OperationalMembership["person"], personId: "person_ana", role: "manager",
  accessScope: "area", areaAccessIds: ["area_ops"], ...overrides
});

describe("Baase access policy", () => {
  it("limits an area manager to the areas granted to them", () => {
    const manager = member({});
    expect(canReadAreaResource(manager, "area_ops")).toBe(true);
    expect(canReadAreaResource(manager, "area_finance")).toBe(false);
    expect(canManageAreaResource(manager, "area_ops")).toBe(true);
    expect(canManageAreaResource(manager, "area_finance")).toBe(false);
  });

  it("keeps assigned-only employees on their own task", () => {
    const employee = member({ role: "employee", accessScope: "assigned_only", areaAccessIds: [] });
    expect(canReadAreaResource(employee, "area_ops")).toBe(false);
    expect(canExecuteTask(employee, "person_ana")).toBe(true);
    expect(canExecuteTask(employee, "person_other")).toBe(false);
  });

  it("keeps Hub seat administration exclusive to workspace owners", () => {
    expect(canAdministerHubSeats(member({ role: "owner", accessScope: "workspace" }))).toBe(true);
    expect(canAdministerHubSeats(member({ role: "manager", accessScope: "workspace" }))).toBe(false);
  });
});
