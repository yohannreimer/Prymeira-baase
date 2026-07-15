import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  createInMemoryStudioProactivityStore,
  createStudioProactivityService
} from "./studio-proactivity.service";
import { registerStudioProactivityRoutes } from "./studio-proactivity.routes";

const headers = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-profile-id": "owner_a",
  "x-baase-role": "owner"
};

describe("Studio proactivity routes", () => {
  it("keeps settings owner-only and exposes quiet signal actions", async () => {
    const now = new Date("2026-07-14T12:00:00.000Z");
    const store = createInMemoryStudioProactivityStore({
      now: () => now.toISOString(),
      dueRituals: [{
        workspaceId: "workspace_a", ownerProfileId: "owner_a", ritualId: "ritual_a",
        title: "Revisão semanal", scheduledFor: "2026-07-14T11:00:00.000Z"
      }]
    });
    const service = createStudioProactivityService({
      store,
      ritualService: { startSession: async () => ({ status: "ready" }) },
      now: () => now
    });
    const app = Fastify();
    await registerStudioProactivityRoutes(app, service);

    const denied = await app.inject({ method: "GET", url: "/studio/proactivity/settings", headers: { ...headers, "x-baase-role": "manager" } });
    expect(denied.statusCode).toBe(403);

    const updated = await app.inject({
      method: "PATCH", url: "/studio/proactivity/settings", headers,
      payload: { ritual_reminder: true, focused_content: true }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().settings).toMatchObject({ ritualReminder: true, focusedContent: true, staleGoal: false });

    await service.runDuePreparations(now, 10);
    const listed = await app.inject({ method: "GET", url: "/studio/proactivity/signals?limit=1", headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().signals).toHaveLength(1);
    const signalId = listed.json().signals[0].id as string;

    const snoozed = await app.inject({
      method: "POST", url: `/studio/proactivity/signals/${signalId}/snooze`, headers,
      payload: { until: "2026-07-15T12:00:00.000Z" }
    });
    expect(snoozed.statusCode).toBe(200);
    expect(snoozed.json().signal.nextReminderAt).toBe("2026-07-15T12:00:00.000Z");

    const dismissed = await app.inject({
      method: "POST", url: `/studio/proactivity/signals/${signalId}/dismiss`, headers,
      payload: {}
    });
    expect(dismissed.statusCode).toBe(200);
    expect(dismissed.json().signal.status).toBe("dismissed");
    await app.close();
  });
});
