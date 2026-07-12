import { describe, expect, it } from "vitest";
import { canAdministerHubSeats, canExecuteTask, canManageAreaResource, canReadAreaResource, canReadTask } from "./access-policy";
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
    expect(canReadTask(employee, { assigneeProfileId: "person_ana", areaId: "area_ops" })).toBe(true);
    expect(canExecuteTask(employee, { assigneeProfileId: "person_ana", areaId: "area_ops" })).toBe(true);
    expect(canExecuteTask(employee, { assigneeProfileId: "person_other", areaId: "area_ops" })).toBe(false);
  });

  it("allows area members to read individual tasks without allowing execution", () => {
    const employee = member({ role: "employee", personId: "person_support", accessScope: "area", areaAccessIds: ["area_ops"] });
    const individualTask = { assigneeProfileId: "person_ana", areaId: "area_ops" };

    expect(canReadTask(employee, individualTask)).toBe(true);
    expect(canExecuteTask(employee, individualTask)).toBe(false);
  });

  it("does not treat unscoped tasks as globally readable or executable", () => {
    const workspaceEmployee = member({ role: "employee", accessScope: "workspace", areaAccessIds: [] });

    expect(canReadTask(workspaceEmployee, { assigneeProfileId: null, areaId: null })).toBe(false);
    expect(canExecuteTask(workspaceEmployee, { assigneeProfileId: null, areaId: null })).toBe(false);
  });

  it("keeps Hub seat administration exclusive to workspace owners", () => {
    expect(canAdministerHubSeats(member({ role: "owner", accessScope: "workspace" }))).toBe(true);
    expect(canAdministerHubSeats(member({ role: "manager", accessScope: "workspace" }))).toBe(false);
  });
});
