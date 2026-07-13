import { describe, expect, it } from "vitest";
import { canAdministerHubSeats, canExecuteTask, canManageAreaResource, canReadAreaResource, canReadTask } from "./access-policy";
import type { OperationalMembership } from "./company.types";

const member = (overrides: Partial<OperationalMembership>): OperationalMembership => ({
  person: { areaId: "area_ops" } as OperationalMembership["person"], personId: "person_ana", role: "manager",
  accessScope: "area", areaAccessIds: ["area_ops"], ...overrides
});

describe("Baase access policy", () => {
  it("limits an area manager to the areas granted to them", () => {
    const manager = member({});
    expect(canReadAreaResource(manager, "area_ops")).toBe(true);
    expect(canReadAreaResource(manager, "area_finance")).toBe(false);
    expect(canManageAreaResource(manager, "area_ops")).toBe(true);
    expect(canManageAreaResource(manager, "area_finance")).toBe(false);
    expect(canManageAreaResource(manager, null)).toBe(false);
  });

  it("keeps assigned-only employees on their own task", () => {
    const employee = member({ role: "employee", accessScope: "assigned_only", areaAccessIds: ["area_ops"] });
    expect(canReadAreaResource(employee, "area_ops")).toBe(true);
    expect(canReadAreaResource(employee, "area_finance")).toBe(false);
    expect(canReadTask(employee, { assigneeProfileId: "person_ana", areaId: "area_ops" })).toBe(true);
    expect(canExecuteTask(employee, { assigneeProfileId: "person_ana", areaId: "area_ops" })).toBe(true);
    expect(canExecuteTask(employee, { assigneeProfileId: "person_other", areaId: "area_ops" })).toBe(false);
  });

  it("keeps employees from reading another person's individual task in the same area", () => {
    const employee = member({ role: "employee", personId: "person_support", accessScope: "area", areaAccessIds: ["area_ops"] });
    const individualTask = { assigneeProfileId: "person_ana", areaId: "area_ops" };

    expect(canReadTask(employee, individualTask)).toBe(false);
    expect(canExecuteTask(employee, individualTask)).toBe(false);
  });

  it("never lets an employee read another person's assigned task, even with a legacy workspace scope", () => {
    const employee = member({
      role: "employee",
      personId: "person_finance",
      person: { areaId: "area_finance" } as OperationalMembership["person"],
      accessScope: "workspace",
      areaAccessIds: ["area_finance"]
    });

    expect(canReadTask(employee, { assigneeProfileId: "person_technical", areaId: "area_technical" })).toBe(false);
    expect(canReadTask(employee, { assigneeProfileId: "person_other_finance", areaId: "area_finance" })).toBe(false);
  });

  it("does not treat unscoped tasks as globally readable or executable", () => {
    const workspaceEmployee = member({ role: "employee", accessScope: "workspace", areaAccessIds: [] });

    expect(canReadTask(workspaceEmployee, { assigneeProfileId: null, areaId: null })).toBe(false);
    expect(canExecuteTask(workspaceEmployee, { assigneeProfileId: null, areaId: null })).toBe(false);
  });

  it("lets an owner inspect every execution without impersonating another assignee", () => {
    const owner = member({ role: "owner", personId: "person_owner", accessScope: "workspace", areaAccessIds: [] });

    expect(canReadTask(owner, { assigneeProfileId: "person_ana", areaId: "area_ops" })).toBe(true);
    expect(canExecuteTask(owner, { assigneeProfileId: "person_ana", areaId: "area_ops" })).toBe(false);
    expect(canExecuteTask(owner, { assigneeProfileId: "person_owner", areaId: "area_ops" })).toBe(true);
  });

  it("keeps Hub seat administration exclusive to workspace owners", () => {
    expect(canAdministerHubSeats(member({ role: "owner", accessScope: "workspace" }))).toBe(true);
    expect(canAdministerHubSeats(member({ role: "manager", accessScope: "workspace" }))).toBe(false);
  });
});
