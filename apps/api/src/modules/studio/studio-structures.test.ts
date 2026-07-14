import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import { createStudioService } from "./studio.service";

const owner = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-role": "owner",
  "x-baase-profile-id": "owner_a"
};

async function setup(now = "2026-07-13T12:00:00.000Z") {
  const repository = createInMemoryStudioRepository({ now: () => now });
  const app = buildApp({
    studioRepository: repository,
    now: () => new Date(now)
  });
  const created = await app.inject({
    method: "POST", url: "/studio/documents", headers: owner,
    payload: { title: "Estratégia", body_json: {}, body_text: "Original", capture_mode: "text" }
  });
  return { app, document: created.json().document as { id: string; revision: number } };
}

describe("Studio strategic structures", () => {
  it("keeps a text-only goal free from fabricated progress and never changes its document", async () => {
    const { app, document } = await setup();
    const response = await app.inject({
      method: "POST", url: `/studio/documents/${document.id}/structures`, headers: owner,
      payload: { kind: "goal", properties_json: { desired_outcome: "Ser referência" } }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().structure).toMatchObject({
      documentId: document.id, kind: "goal", lifecycleStatus: "active",
      metricJson: null, nextRunAt: null, revision: 1
    });
    expect(response.json().structure).not.toHaveProperty("progress");
    const unchanged = await app.inject({ method: "GET", url: `/studio/documents/${document.id}`, headers: owner });
    expect(unchanged.json().document).toMatchObject({ revision: document.revision, bodyText: "Original" });
  });

  it("validates measurable goals, decisions, plans, and timezone-aware rituals", async () => {
    const { app, document } = await setup();
    const measurable = await app.inject({
      method: "POST", url: `/studio/documents/${document.id}/structures`, headers: owner,
      payload: {
        kind: "goal", horizon_at: "2026-12-31T23:59:59.000Z",
        metric_json: { label: "Receita", unit: "BRL", baseline: 100, current: 125, target: 200, direction: "increase" },
        properties_json: { desired_outcome: "Crescer" }
      }
    });
    expect(measurable.statusCode).toBe(201);
    expect(measurable.json().structure.metricJson).toMatchObject({ baseline: 100, target: 200, unit: "BRL" });

    for (const payload of [
      { kind: "decision", horizon_at: "2026-08-01T12:00:00.000Z", properties_json: { decision: "Contratar", review_date: "2026-08-01" } },
      { kind: "plan", properties_json: { direction: "Expandir", fronts: ["Produto", "Comercial"] } },
      { kind: "ritual", cadence_json: { frequency: "weekly", weekdays: [1], local_time: "09:00", timezone: "America/Sao_Paulo" }, properties_json: { intention: "Revisar a semana" } }
    ]) {
      const response = await app.inject({ method: "POST", url: `/studio/documents/${document.id}/structures`, headers: owner, payload });
      expect(response.statusCode).toBe(201);
      if (payload.kind === "ritual") expect(response.json().structure.nextRunAt).toBeTruthy();
    }
  });

  it("accepts the minimal measurable goal and its optional strategic state", async () => {
    const { app, document } = await setup();
    const response = await app.inject({
      method: "POST", url: `/studio/documents/${document.id}/structures`, headers: owner,
      payload: {
        kind: "goal",
        metric_json: { label: "Receita", target: 100 },
        properties_json: { desired_outcome: "Crescer", state: "in_focus" }
      }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().structure).toMatchObject({
      lifecycleStatus: "active",
      metricJson: { label: "Receita", target: 100 },
      propertiesJson: { state: "in_focus" }
    });
  });

  it("allows an unscheduled ritual and removing a configured cadence optimistically", async () => {
    const { app, document } = await setup();
    const created = await app.inject({
      method: "POST", url: `/studio/documents/${document.id}/structures`, headers: owner,
      payload: { kind: "ritual", properties_json: { intention: "Quando eu quiser" } }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().structure).toMatchObject({ cadenceJson: null, nextRunAt: null });
    const archived = await app.inject({ method: "DELETE", url: `/studio/structures/${created.json().structure.id}`, headers: owner });
    expect(archived.statusCode).toBe(200);
    const scheduled = await app.inject({
      method: "POST", url: `/studio/documents/${document.id}/structures`, headers: owner,
      payload: {
        kind: "ritual",
        cadence_json: { frequency: "daily", local_time: "09:00", timezone: "America/Sao_Paulo" },
        properties_json: { intention: "Diário" }
      }
    });
    expect(scheduled.json().structure.nextRunAt).toBeTruthy();
    const removed = await app.inject({
      method: "PATCH", url: `/studio/structures/${scheduled.json().structure.id}`, headers: owner,
      payload: { expected_revision: 1, cadence_json: null }
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().structure).toMatchObject({ revision: 2, cadenceJson: null, nextRunAt: null });
  });

  it("preserves an overdue ritual run on unrelated edits and recalculates only cadence patches", async () => {
    let clock = "2026-07-13T12:00:00.000Z";
    const repository = createInMemoryStudioRepository({ now: () => clock });
    const service = createStudioService(repository, { now: () => clock });
    const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
    const document = await service.createDocument(scope, "owner_a", {
      title: "Ritual", body_json: {}, body_text: "Original", capture_mode: "text"
    });
    const created = await service.createStructure(scope, "owner_a", document.id, {
      kind: "ritual",
      cadence_json: { frequency: "daily", local_time: "09:00", timezone: "America/Sao_Paulo" },
      properties_json: { intention: "Revisar" }
    });
    const originalNextRunAt = created.nextRunAt;
    clock = "2026-07-15T18:00:00.000Z";
    const edited = await service.updateStructure(scope, "owner_a", created.id, {
      expected_revision: created.revision,
      properties_json: { intention: "Revisar com calma" }
    });
    expect(edited.nextRunAt).toBe(originalNextRunAt);

    const changed = await service.updateStructure(scope, "owner_a", created.id, {
      expected_revision: edited.revision,
      cadence_json: { frequency: "daily", local_time: "10:00", timezone: "America/Sao_Paulo" }
    });
    expect(changed.nextRunAt).not.toBe(originalNextRunAt);
    expect(new Date(changed.nextRunAt!).getTime()).toBeGreaterThan(new Date(clock).getTime());

    const removed = await service.updateStructure(scope, "owner_a", created.id, {
      expected_revision: changed.revision,
      cadence_json: null
    });
    expect(removed).toMatchObject({ cadenceJson: null, nextRunAt: null });
  });

  it("stores an optional decision date separately from its review date", async () => {
    const { app, document } = await setup();
    const response = await app.inject({
      method: "POST", url: `/studio/documents/${document.id}/structures`, headers: owner,
      payload: {
        kind: "decision",
        properties_json: { decision: "Contratar", decision_date: "2026-07-01", review_date: "2026-08-01" }
      }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().structure.propertiesJson).toMatchObject({
      decision_date: "2026-07-01", review_date: "2026-08-01"
    });
    const invalid = await app.inject({
      method: "PATCH", url: `/studio/structures/${response.json().structure.id}`, headers: owner,
      payload: { expected_revision: 1, properties_json: { decision: "Contratar", decision_date: "01/07/2026" } }
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("prevents duplicate active structures, updates optimistically, archives idempotently, filters and isolates", async () => {
    const { app, document } = await setup();
    const request = {
      method: "POST" as const, url: `/studio/documents/${document.id}/structures`, headers: owner,
      payload: { kind: "plan", properties_json: { direction: "Executar", fronts: ["A"] } }
    };
    const [left, right] = await Promise.all([app.inject(request), app.inject(request)]);
    expect([left.statusCode, right.statusCode].sort()).toEqual([201, 409]);
    const structure = (left.statusCode === 201 ? left : right).json().structure;
    const updated = await app.inject({
      method: "PATCH", url: `/studio/structures/${structure.id}`, headers: owner,
      payload: { expected_revision: 1, properties_json: { direction: "Executar", fronts: ["A", "B"] } }
    });
    expect(updated.json().structure).toMatchObject({ revision: 2, propertiesJson: { fronts: ["A", "B"] } });
    const stale = await app.inject({ method: "PATCH", url: `/studio/structures/${structure.id}`, headers: owner,
      payload: { expected_revision: 1, properties_json: { direction: "Falhar" } } });
    expect(stale.statusCode).toBe(409);

    const foreign = await app.inject({ method: "PATCH", url: `/studio/structures/${structure.id}`,
      headers: { ...owner, "x-baase-profile-id": "owner_b" },
      payload: { expected_revision: 2, properties_json: { direction: "Invadir" } } });
    expect(foreign.statusCode).toBe(404);

    const listed = await app.inject({ method: "GET", url: "/studio/structures?kind=plan&lifecycle_status=active&limit=1", headers: owner });
    expect(listed.json().structures).toHaveLength(1);
    const documentScoped = await app.inject({
      method: "GET",
      url: `/studio/structures?document_id=${encodeURIComponent(document.id)}&lifecycle_status=active&limit=4`,
      headers: owner
    });
    expect(documentScoped.json().structures).toEqual([expect.objectContaining({ id: structure.id, documentId: document.id })]);
    const foreignDocument = await app.inject({
      method: "GET", url: "/studio/structures?document_id=owner_b_document&limit=4", headers: owner
    });
    expect(foreignDocument.json().structures).toEqual([]);
    const archived = await app.inject({ method: "DELETE", url: `/studio/structures/${structure.id}`, headers: owner });
    const archivedAgain = await app.inject({ method: "DELETE", url: `/studio/structures/${structure.id}`, headers: owner });
    expect(archived.statusCode).toBe(200);
    expect(archivedAgain.json().structure.archivedAt).toBe(archived.json().structure.archivedAt);
  });

  it("rejects malformed kind-specific data and non-owner access", async () => {
    const { app, document } = await setup();
    const invalid = await app.inject({ method: "POST", url: `/studio/documents/${document.id}/structures`, headers: owner,
      payload: { kind: "goal", metric_json: { label: "X", unit: "", baseline: 0, current: 1, target: 2, direction: "increase" }, properties_json: {} } });
    expect(invalid.statusCode).toBe(400);
    const manager = await app.inject({ method: "GET", url: "/studio/structures", headers: { ...owner, "x-baase-role": "manager" } });
    expect(manager.statusCode).toBe(403);
  });

  it.each([
    ["2026-03-08T06:00:00.000Z", "2026-03-09T06:30:00.000Z"],
    ["2026-11-01T04:00:00.000Z", "2026-11-01T07:30:00.000Z"]
  ])("calculates deterministic ritual runs across DST from %s", async (now, expected) => {
    const { app, document } = await setup(now);
    const response = await app.inject({
      method: "POST", url: `/studio/documents/${document.id}/structures`, headers: owner,
      payload: {
        kind: "ritual",
        cadence_json: { frequency: "daily", local_time: "02:30", timezone: "America/New_York" },
        properties_json: { intention: "Revisão" }
      }
    });
    expect(response.json().structure.nextRunAt).toBe(expected);
  });

  it("rejects malformed legacy JSON again after repository reads", async () => {
    const repository = createInMemoryStudioRepository();
    repository.listStructures = async () => ({
      nextCursor: null,
      items: [{
        workspaceId: "workspace_a", ownerProfileId: "owner_a", id: "legacy", documentId: "document_1",
        kind: "plan", lifecycleStatus: "active", revision: 1, horizonAt: null,
        metricJson: null, cadenceJson: null, nextRunAt: null,
        propertiesJson: { fronts: "not-an-array" }, createdAt: "2026-07-13T12:00:00.000Z",
        updatedAt: "2026-07-13T12:00:00.000Z", archivedAt: null
      }]
    });
    const service = createStudioService(repository);
    await expect(service.listStructures(
      { workspaceId: "workspace_a", ownerProfileId: "owner_a" }, { limit: 10 }
    )).rejects.toThrow("STUDIO_STRUCTURE_DATA_INVALID");
  });
});
