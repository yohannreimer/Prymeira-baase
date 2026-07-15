import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { STUDIO_DELETE_CONFIRMATION, type StudioPortabilityService } from "./studio-portability.service";
import { registerStudioPortabilityRoutes } from "./studio-portability.routes";

const owner = { "x-baase-workspace-id": "workspace_a", "x-baase-profile-id": "owner_a", "x-baase-role": "owner" };

describe("Studio portability routes", () => {
  it("keeps export and deletion owner-only and passes the authenticated profile to the recheck", async () => {
    const exportData = vi.fn(async () => ({
      exportId: "export_1", status: "pending" as const, expiresAt: "2026-07-14T15:15:00.000Z"
    }));
    const getExport = vi.fn(async () => ({
      exportId: "export_1", status: "ready" as const, downloadUrl: "https://private.test/export",
      expiresAt: "2026-07-14T15:15:00.000Z"
    }));
    const deleteData = vi.fn(async () => ({
      requestId: "delete_1", status: "completed" as const, pendingObjectCount: 0
    }));
    const app = Fastify({ logger: false });
    await registerStudioPortabilityRoutes(app, { exportData, getExport, deleteData } as unknown as StudioPortabilityService);

    const exported = await app.inject({ method: "POST", url: "/studio/export", headers: owner });
    expect(exported.statusCode).toBe(202);
    expect(exportData).toHaveBeenCalledWith({ workspaceId: "workspace_a", profileId: "owner_a", role: "owner" });
    const ready = await app.inject({ method: "GET", url: "/studio/export/export_1", headers: owner });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().export.downloadUrl).toBe("https://private.test/export");
    expect(getExport).toHaveBeenCalledWith(
      { workspaceId: "workspace_a", profileId: "owner_a", role: "owner" }, "export_1"
    );

    const deleted = await app.inject({
      method: "DELETE", url: "/studio/data", headers: owner,
      payload: { confirmation: STUDIO_DELETE_CONFIRMATION }
    });
    expect(deleted.statusCode).toBe(202);
    expect(deleteData).toHaveBeenCalledWith(
      { workspaceId: "workspace_a", profileId: "owner_a", role: "owner" },
      STUDIO_DELETE_CONFIRMATION
    );

    for (const role of ["manager", "employee"]) {
      const response = await app.inject({ method: "POST", url: "/studio/export", headers: { ...owner, "x-baase-role": role } });
      expect(response.statusCode).toBe(403);
    }
  });

  it("rejects weak confirmation before invoking deletion", async () => {
    const deleteData = vi.fn();
    const app = Fastify({ logger: false });
    await registerStudioPortabilityRoutes(app, { exportData: vi.fn(), deleteData } as unknown as StudioPortabilityService);

    const response = await app.inject({ method: "DELETE", url: "/studio/data", headers: owner, payload: { confirmation: "excluir" } });
    expect(response.statusCode).toBe(400);
    expect(deleteData).not.toHaveBeenCalled();
  });
});
