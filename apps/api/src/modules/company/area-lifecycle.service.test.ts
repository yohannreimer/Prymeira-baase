import { describe, expect, it } from "vitest";
import { createInMemoryCompanyRepository } from "./in-memory-company.repository";
import { createInMemoryProcessRepository } from "../processes/in-memory-process.repository";
import { createInMemoryRoutineRepository } from "../routines/in-memory-routine.repository";
import { createAreaLifecycleService, createInMemoryAreaLifecycleRepository } from "./area-lifecycle.service";

describe("area lifecycle service", () => {
  it("lists every active link in the area impact", async () => {
    const fixture = await createFixture();

    const impact = await fixture.service.getImpact("workspace_a", fixture.source.id);

    expect(impact.area).toMatchObject({ id: fixture.source.id, name: "Operacao" });
    expect(impact.processes).toEqual([{ id: "process_1", title: "Fechamento" }]);
    expect(impact.routines).toEqual([{ id: "routine_1", title: "Abertura" }]);
    expect(impact.roleTemplates).toEqual([{ id: fixture.role.id, name: "Caixa" }]);
    expect(impact.people).toEqual([{ id: fixture.person.id, name: "Ana" }]);
    expect(impact.pendingInvites).toEqual([{ id: fixture.invite.id, name: "Bia", email: "bia@example.com" }]);
  });

  it("refuses to archive linked areas without an explicit resolution", async () => {
    const fixture = await createFixture();

    await expect(fixture.service.archive("workspace_a", fixture.source.id, "owner_1"))
      .rejects.toThrow("AREA_ARCHIVE_RESOLUTION_REQUIRED");
    expect(await fixture.company.findAreaById("workspace_a", fixture.source.id)).not.toBeNull();
  });

  it("reassigns active links atomically and returns affected counts", async () => {
    const fixture = await createFixture();

    const result = await fixture.service.archive("workspace_a", fixture.source.id, "owner_1", {
      strategy: "reassign",
      targetAreaId: fixture.target.id
    });

    expect(result.reassigned).toEqual({ processes: 1, routines: 1, roleTemplates: 1, people: 1, pendingInvites: 1 });
    expect(result.unassigned).toEqual({ processes: 0, routines: 0, people: 0, pendingInvites: 0 });
    expect(result.archived).toEqual({ areas: 1, roleTemplates: 0 });
    expect((await fixture.processes.findProcess("workspace_a", "process_1"))?.areaId).toBe(fixture.target.id);
    expect((await fixture.routines.findRoutine("workspace_a", "routine_1"))?.areaId).toBe(fixture.target.id);
    expect((await fixture.company.findTeamMember("workspace_a", fixture.person.id))?.areaId).toBe(fixture.target.id);
    expect(await fixture.company.findAreaById("workspace_a", fixture.source.id)).toBeNull();
  });

  it("unassigns nullable links and archives role templates without changing history snapshots", async () => {
    const fixture = await createFixture();
    const result = await fixture.service.archive("workspace_a", fixture.source.id, "owner_1", { strategy: "unassign" });

    expect(result.unassigned).toEqual({ processes: 1, routines: 1, people: 1, pendingInvites: 1 });
    expect(result.archived).toEqual({ areas: 1, roleTemplates: 1 });
    expect((await fixture.processes.findProcess("workspace_a", "process_1"))?.areaId).toBeNull();
    expect((await fixture.routines.findRoutine("workspace_a", "routine_1"))?.areaId).toBeNull();
    expect((await fixture.company.findTeamMember("workspace_a", fixture.person.id))).toMatchObject({
      areaId: null,
      roleTemplateId: null
    });
    expect((await fixture.routines.findTaskOccurrence("workspace_a", "task_1"))).toMatchObject({
      areaId: fixture.source.id,
      areaNameSnapshot: "Operacao"
    });
  });
});

async function createFixture() {
  const company = createInMemoryCompanyRepository();
  const processes = createInMemoryProcessRepository();
  const routines = createInMemoryRoutineRepository();
  const source = await company.createArea({ workspaceId: "workspace_a", name: "Operacao", description: null });
  const target = await company.createArea({ workspaceId: "workspace_a", name: "Financeiro", description: null });
  const role = await company.createRoleTemplate({ workspaceId: "workspace_a", areaId: source.id, name: "Caixa", description: null });
  const person = await company.createTeamMember({
    workspaceId: "workspace_a", name: "Ana", email: "ana@example.com", role: "employee", areaId: source.id,
    roleTemplateId: role.id, status: "active", createdByProfileId: "owner_1"
  });
  const invite = await company.createTeamInvite({
    workspaceId: "workspace_a", name: "Bia", email: "bia@example.com", role: "employee", areaId: source.id,
    roleTemplateId: role.id, accessScope: "area", createdByProfileId: "owner_1"
  });
  await processes.createProcess({
    workspaceId: "workspace_a", areaId: source.id, title: "Fechamento", summary: null, status: "published",
    ownerProfileId: person.id, currentVersion: version(), versions: [version()], createdByProfileId: "owner_1",
    publishedAt: "2026-07-10T00:00:00.000Z", archivedAt: null
  });
  await routines.createRoutine({
    workspaceId: "workspace_a", areaId: source.id, title: "Abertura", status: "active", frequency: "daily",
    weekdays: ["mon", "tue", "wed", "thu", "fri"], executionMode: "shared", approvalMode: "direct",
    evidencePolicy: "optional", createdByProfileId: "owner_1", taskTemplates: [{
      id: "step_1", routineId: "routine_1", workspaceId: "workspace_a", title: "Abrir", processId: null,
      assigneeProfileId: null, approvalMode: "direct", evidencePolicy: "optional", sortOrder: 0
    }]
  });
  await routines.createTaskOccurrence({
    workspaceId: "workspace_a", origin: "routine", routineId: "routine_1", taskTemplateId: "step_1", title: "Abrir",
    areaId: source.id, areaNameSnapshot: "Operacao", routineTitleSnapshot: "Abertura", stepTitleSnapshot: "Abrir",
    processId: null, assigneeProfileId: null, approvalMode: "direct", evidencePolicy: "optional", status: "pending",
    dueDate: "2026-07-11", evidence: null, submittedByProfileId: null, submittedAt: null,
    reviewedByProfileId: null, reviewedAt: null, reviewComment: null
  });
  const repository = createInMemoryAreaLifecycleRepository({ companyRepository: company, processRepository: processes, routineRepository: routines });
  return { company, processes, routines, source, target, role, person, invite, service: createAreaLifecycleService(repository) };
}

function version() {
  return {
    id: "version_1", processId: "process_1", workspaceId: "workspace_a", version: 1, title: "Fechamento",
    body: "Passos", changeNote: "Criacao", editorProfileId: "owner_1", createdAt: "2026-07-10T00:00:00.000Z"
  };
}
