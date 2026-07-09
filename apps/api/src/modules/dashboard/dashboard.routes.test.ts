import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";

const ownerHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-profile-id": "profile_owner",
  "x-baase-role": "owner"
};

const employeeHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-profile-id": "profile_employee",
  "x-baase-role": "employee"
};

describe("dashboard routes", () => {
  it("summarizes real operational metrics for owner and manager panels", async () => {
    const app = buildApp({ seedDemoData: true });

    const response = await app.inject({
      method: "GET",
      url: "/dashboard?date=2026-07-07",
      headers: ownerHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      date: "2026-07-07",
      role: "owner",
      metrics: {
        todayTotal: 4,
        todayCompleted: 1,
        executionRate: 25,
        awaitingApproval: 0,
        lateTasks: 0,
        incompleteProcesses: 1
      }
    });
    expect(response.json().areaMetrics).toEqual([
      expect.objectContaining({
        name: "Criacao",
        total: 4,
        completed: 1,
        completionRate: 25
      })
    ]);
    expect(response.json().attentionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "draft_process_process_4",
          title: "Processo \"Conciliacao financeira\" incompleto",
          targetScreen: "processos"
        })
      ])
    );
  });

  it("returns an employee Today summary scoped to assigned work", async () => {
    const app = buildApp({ seedDemoData: true });

    const response = await app.inject({
      method: "GET",
      url: "/dashboard?date=2026-07-07",
      headers: employeeHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      role: "employee",
      employeeToday: {
        total: 4,
        completed: 1,
        pending: 3,
        awaitingApproval: 0,
        late: 0
      }
    });
  });
});

