import { describe, expect, it } from "vitest";
import { createInMemoryAnnouncementRepository } from "../announcements/in-memory-announcement.repository";
import { createInMemoryCompanyRepository } from "../company/in-memory-company.repository";
import { createInMemoryProcessRepository } from "../processes/in-memory-process.repository";
import { createInMemoryRoutineRepository } from "../routines/in-memory-routine.repository";
import { createInMemoryTrainingRepository } from "../trainings/in-memory-training.repository";
import { createStudioContextBuilder } from "./studio-context-builder";

describe("StudioContextBuilder", () => {
  it("builds owner-scoped, bounded operational facts with durable citation inputs", async () => {
    const fixture = await createFixture();
    const context = await fixture.build({
      from: null,
      to: null,
      resourceTypes: ["people", "announcement", "training", "process", "routine", "task", "dashboard"],
      personIds: [fixture.personId]
    });

    expect(context.period).toEqual({ from: "2026-06-16", to: "2026-07-15" });
    expect(new Set(context.facts.map((fact) => fact.resourceType))).toEqual(new Set([
      "dashboard", "task", "routine", "process", "training", "announcement", "people"
    ]));
    expect(context.facts.every((fact) => fact.kind === "direct" || fact.kind === "inferred")).toBe(true);
    expect(context.facts.every((fact) => context.citations[fact.citationIndex])).toBe(true);
    expect(context.citations.every((citation) =>
      citation.workspaceId === fixture.scope.workspaceId
      && citation.ownerProfileId === fixture.scope.ownerProfileId
      && citation.periodFrom === context.period.from
      && citation.periodTo === context.period.to
    )).toBe(true);
    expect(JSON.stringify(context)).not.toContain("private announcement body");
    expect(JSON.stringify(context)).not.toContain("person@example.com");
    expect(context.citations.every((citation) => citation.metadata.contentTrust === "untrusted_data")).toBe(true);
    expect(context.serializedBytes).toBe(Buffer.byteLength(JSON.stringify({
      period: context.period, facts: context.facts, citations: context.citations
    }), "utf8"));
  });

  it("returns only requested types, applies per-type/byte caps, and stays deterministic", async () => {
    const fixture = await createFixture({ extraPeople: 12 });
    const builder = createStudioContextBuilder(fixture.repositories, {
      now: () => new Date("2026-07-15T15:00:00.000Z"),
      perTypeCaps: { people: 3 },
      maxSerializedBytes: 4_000
    });
    const request: Parameters<typeof builder.buildStudioContext>[1] = {
      from: "2026-07-01", to: "2026-07-15", resourceTypes: ["people"], personIds: []
    };
    const first = await builder.buildStudioContext(fixture.scope, request);
    const second = await builder.buildStudioContext(fixture.scope, request);

    expect(first).toEqual(second);
    expect(first.facts).toHaveLength(3);
    expect(first.facts.every((fact) => fact.resourceType === "people")).toBe(true);
    expect(first.serializedBytes).toBeLessThanOrEqual(4_000);
  });

  it("rejects invalid periods, cross-workspace people and non-owner scopes without leaking records", async () => {
    const fixture = await createFixture();
    await expect(fixture.build({ from: "2026-07-20", to: "2026-07-01", resourceTypes: ["dashboard"], personIds: [] }))
      .rejects.toMatchObject({ code: "STUDIO_CONTEXT_PERIOD_INVALID" });
    await expect(fixture.build({ from: "2026-07-01", to: null, resourceTypes: ["dashboard"], personIds: [] }))
      .rejects.toMatchObject({ code: "STUDIO_CONTEXT_PERIOD_INVALID" });
    await expect(fixture.build({ from: "2026-07-01", to: "2026-07-31", resourceTypes: ["people"], personIds: ["other-person"] }))
      .rejects.toMatchObject({ code: "STUDIO_CONTEXT_PERSON_NOT_FOUND" });
    await expect(fixture.builder.buildStudioContext({ ...fixture.scope, ownerProfileId: fixture.personId }, {
      from: "2026-07-01", to: "2026-07-31", resourceTypes: ["dashboard"], personIds: []
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

async function createFixture(options: { extraPeople?: number } = {}) {
  const now = () => "2026-07-15T15:00:00.000Z";
  const companyRepository = createInMemoryCompanyRepository({ now });
  const area = await companyRepository.createArea({ workspaceId: "workspace-a", name: "Operações", description: null });
  const owner = await companyRepository.createTeamMember({
    workspaceId: "workspace-a", name: "Owner", email: "owner@example.com", role: "owner", areaId: null,
    roleTemplateId: null, createdByProfileId: "seed", status: "active"
  });
  const person = await companyRepository.createTeamMember({
    workspaceId: "workspace-a", name: "Ana", email: "person@example.com", role: "employee", areaId: area.id,
    roleTemplateId: null, createdByProfileId: owner.id, status: "active"
  });
  for (let index = 0; index < (options.extraPeople ?? 0); index += 1) {
    await companyRepository.createTeamMember({
      workspaceId: "workspace-a", name: `Pessoa ${String(index).padStart(2, "0")}`, email: `p${index}@example.com`,
      role: "employee", areaId: area.id, roleTemplateId: null, createdByProfileId: owner.id, status: "active"
    });
  }

  const routineRepository = createInMemoryRoutineRepository({ now });
  const routine = await routineRepository.createRoutine({
    workspaceId: "workspace-a", areaId: area.id, title: "Revisão diária", status: "active", frequency: "daily",
    assigneeProfileIds: [person.id], executionMode: "individual", approvalMode: "direct", evidencePolicy: "optional",
    createdByProfileId: owner.id, taskTemplates: []
  });
  const processRepository = createInMemoryProcessRepository({ now });
  const process = await processRepository.createProcess({
    workspaceId: "workspace-a", areaId: area.id, title: "Fechamento", summary: "Resumo seguro", status: "published",
    ownerProfileId: person.id, owner: { type: "person", personId: person.id }, materials: [],
    currentVersion: { id: "v1", processId: "pending", workspaceId: "workspace-a", version: 1, title: "Fechamento", body: "full process body", changeNote: "", editorProfileId: owner.id, createdAt: now() },
    versions: [], createdByProfileId: owner.id, publishedAt: now(), archivedAt: null
  });
  await routineRepository.createTaskOccurrence({
    workspaceId: "workspace-a", origin: "routine", routineId: routine.id, taskTemplateId: null, title: "Conferir fechamento",
    areaId: area.id, processId: process.id, assigneeProfileId: person.id, approvalMode: "approval_required", evidencePolicy: "optional",
    status: "awaiting_approval", dueDate: "2026-07-10", evidence: null, submittedByProfileId: person.id,
    submittedAt: "2026-07-10T12:00:00.000Z", reviewedByProfileId: null, reviewedAt: null, reviewComment: null
  });

  const trainingRepository = createInMemoryTrainingRepository({ now, initialTrainings: [{
    id: "training-1", workspaceId: "workspace-a", title: "Treino seguro", description: "Descrição segura", status: "published",
    source: { type: "manual", processId: null, title: null }, audience: { type: "person", profileId: person.id }, dueDate: "2026-07-14",
    materials: [{ id: "m1", trainingId: "training-1", workspaceId: "workspace-a", kind: "lesson", title: "Segredo", body: "full training body", url: null, sortOrder: 0 }],
    quizQuestions: [], createdByProfileId: owner.id, publishedAt: "2026-07-01T12:00:00.000Z", archivedAt: null, createdAt: now(), updatedAt: now()
  }] });
  await trainingRepository.createTrainingAssignment({
    workspaceId: "workspace-a", trainingId: "training-1", audience: { type: "person", profileId: person.id },
    dueDate: "2026-07-14", createdByProfileId: owner.id
  });
  const announcementRepository = createInMemoryAnnouncementRepository({ now, initialAnnouncements: [{
    id: "announcement-1", workspaceId: "workspace-a", title: "Comunicado", body: "private announcement body", type: "simple",
    status: "published", requirement: "read_confirmation", audience: { type: "person", profileId: person.id }, relatedProcessId: null,
    relatedTrainingId: null, quizQuestions: [], createdByProfileId: owner.id, publishedAt: "2026-07-02T12:00:00.000Z",
    archivedAt: null, createdAt: now(), updatedAt: now()
  }] });
  const repositories = { companyRepository, routineRepository, processRepository, trainingRepository, announcementRepository };
  const scope = { workspaceId: "workspace-a", ownerProfileId: owner.id };
  const builder = createStudioContextBuilder(repositories, { now: () => new Date(now()) });
  return {
    repositories, builder, scope, personId: person.id,
    build: (request: Parameters<typeof builder.buildStudioContext>[1]) => builder.buildStudioContext(scope, request)
  };
}
