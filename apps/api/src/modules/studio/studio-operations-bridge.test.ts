import { describe, expect, it, vi } from "vitest";
import { createInMemoryAnnouncementRepository } from "../announcements/in-memory-announcement.repository";
import { createInMemoryCompanyRepository } from "../company/in-memory-company.repository";
import { createInMemoryProcessRepository } from "../processes/in-memory-process.repository";
import { createInMemoryRoutineRepository } from "../routines/in-memory-routine.repository";
import type { RoutineRepository } from "../routines/routine.types";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import {
  createInMemoryStudioOperationsStore,
  createStudioOperationsBridge,
  type StudioOperationDraft
} from "./studio-operations-bridge";

const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
const ownerB = { workspaceId: "workspace_a", ownerProfileId: "owner_b" };
const IDEMPOTENCY_KEY = "11111111-1111-4111-8111-111111111111";

describe("Studio strategic-to-operational bridge", () => {
  it.each(["task", "routine", "process", "announcement"] as const)(
    "previews, edits, and confirms one %s through its domain service",
    async (resourceType) => {
      const fixture = await createFixture();
      const draft = draftFor(resourceType, fixture.areaId, fixture.personId);
      const preview = await fixture.bridge.preview(scope, scope.ownerProfileId, fixture.suggestionId, draft);

      expect(preview).toMatchObject({
        sourceSuggestionId: fixture.suggestionId,
        sourceDocumentId: fixture.documentId,
        resourceType,
        status: "preview",
        idempotencyKey: null,
        resultResourceId: null
      });
      await expect(fixture.operationalCount(resourceType)).resolves.toBe(0);

      const edited = editTitle(draft, `Editado ${resourceType}`);
      const first = await fixture.bridge.confirm(
        scope,
        scope.ownerProfileId,
        preview.id,
        IDEMPOTENCY_KEY,
        edited
      );
      const repeated = await fixture.bridge.confirm(
        scope,
        scope.ownerProfileId,
        preview.id,
        IDEMPOTENCY_KEY,
        editTitle(edited, "Esta repetição não pode alterar o resultado")
      );

      expect(repeated).toEqual(first);
      expect(first).toMatchObject({
        sourceSuggestionId: fixture.suggestionId,
        sourceDocumentId: fixture.documentId,
        resourceType,
        relationType: "created"
      });
      await expect(fixture.operationalCount(resourceType)).resolves.toBe(1);
      await expect(fixture.operationalRecord(resourceType, first.resourceId)).resolves.toMatchObject({
        id: first.resourceId,
        title: `Editado ${resourceType}`,
        ...(resourceType === "process" || resourceType === "announcement" ? { status: "draft" } : {})
      });
      await expect(fixture.bridge.getPreview(scope, preview.id)).resolves.toMatchObject({
        status: "confirmed",
        idempotencyKey: IDEMPOTENCY_KEY,
        resultResourceId: first.resourceId,
        confirmedPayload: edited
      });
    }
  );

  it("validates edited area and person references immediately before confirmation", async () => {
    const fixture = await createFixture();
    const badArea = draftFor("task", "missing_area", fixture.personId);
    const areaPreview = await fixture.bridge.preview(scope, scope.ownerProfileId, fixture.suggestionId, badArea);
    await expect(fixture.bridge.confirm(
      scope,
      scope.ownerProfileId,
      areaPreview.id,
      IDEMPOTENCY_KEY,
      badArea
    )).rejects.toThrow("STUDIO_OPERATION_AREA_NOT_FOUND");

    const badPerson = draftFor("routine", fixture.areaId, "missing_person");
    const personPreview = await fixture.bridge.preview(scope, scope.ownerProfileId, fixture.suggestionId, badPerson);
    await expect(fixture.bridge.confirm(
      scope,
      scope.ownerProfileId,
      personPreview.id,
      "22222222-2222-4222-8222-222222222222",
      badPerson
    )).rejects.toThrow("STUDIO_OPERATION_PERSON_NOT_FOUND");

    await expect(fixture.operationalCount("task")).resolves.toBe(0);
    await expect(fixture.operationalCount("routine")).resolves.toBe(0);
    await expect(fixture.bridge.getPreview(scope, areaPreview.id)).resolves.toMatchObject({ status: "preview" });
    await expect(fixture.bridge.getPreview(scope, personPreview.id)).resolves.toMatchObject({ status: "preview" });
  });

  it("does not reveal or confirm another owner's suggestion or preview", async () => {
    const fixture = await createFixture();
    const draft = draftFor("task", fixture.areaId, fixture.personId);
    const preview = await fixture.bridge.preview(scope, scope.ownerProfileId, fixture.suggestionId, draft);

    await expect(fixture.bridge.preview(ownerB, ownerB.ownerProfileId, fixture.suggestionId, draft))
      .rejects.toThrow("STUDIO_SUGGESTION_NOT_FOUND");
    await expect(fixture.bridge.getPreview(ownerB, preview.id))
      .rejects.toThrow("STUDIO_OPERATION_PREVIEW_NOT_FOUND");
    await expect(fixture.bridge.confirm(ownerB, ownerB.ownerProfileId, preview.id, IDEMPOTENCY_KEY, draft))
      .rejects.toThrow("STUDIO_OPERATION_PREVIEW_NOT_FOUND");
  });

  it("expires previews and never creates from an expired or decided suggestion", async () => {
    let now = new Date("2026-07-14T12:00:00.000Z");
    const fixture = await createFixture(() => now);
    const draft = draftFor("announcement", fixture.areaId, fixture.personId);
    const preview = await fixture.bridge.preview(scope, scope.ownerProfileId, fixture.suggestionId, draft);
    expect(preview.expiresAt).toBe("2026-07-15T12:00:00.000Z");

    now = new Date("2026-07-15T12:00:00.001Z");
    await expect(fixture.bridge.confirm(scope, scope.ownerProfileId, preview.id, IDEMPOTENCY_KEY, draft))
      .rejects.toThrow("STUDIO_OPERATION_PREVIEW_EXPIRED");
    await expect(fixture.bridge.getPreview(scope, preview.id)).resolves.toMatchObject({ status: "expired" });
    await expect(fixture.operationalCount("announcement")).resolves.toBe(0);

    await fixture.studioRepository.dismissSuggestion(scope, fixture.suggestionId);
    await expect(fixture.bridge.preview(scope, scope.ownerProfileId, fixture.suggestionId, draft))
      .rejects.toThrow("STUDIO_OPERATION_SOURCE_SUGGESTION_NOT_PENDING");
  });

  it("fences concurrent confirmation retries and invokes the domain service once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const baseRoutineRepository = createInMemoryRoutineRepository();
    const createTaskOccurrence = vi.fn(async (...args: Parameters<RoutineRepository["createTaskOccurrence"]>) => {
      await gate;
      return baseRoutineRepository.createTaskOccurrence(...args);
    });
    const routineRepository: RoutineRepository = { ...baseRoutineRepository, createTaskOccurrence };
    const fixture = await createFixture(undefined, routineRepository);
    const draft = draftFor("task", fixture.areaId, fixture.personId);
    const preview = await fixture.bridge.preview(scope, scope.ownerProfileId, fixture.suggestionId, draft);

    const first = fixture.bridge.confirm(scope, scope.ownerProfileId, preview.id, IDEMPOTENCY_KEY, draft);
    const second = fixture.bridge.confirm(scope, scope.ownerProfileId, preview.id, IDEMPOTENCY_KEY, draft);
    await vi.waitFor(() => expect(createTaskOccurrence).toHaveBeenCalledTimes(1));
    release();

    const [firstLink, secondLink] = await Promise.all([first, second]);
    expect(secondLink).toEqual(firstLink);
    expect(createTaskOccurrence).toHaveBeenCalledTimes(1);
    await expect(fixture.operationalCount("task")).resolves.toBe(1);
  });

  it("recovers the confirmed result before revalidating a source suggestion that later changed status", async () => {
    const fixture = await createFixture();
    const draft = draftFor("task", fixture.areaId, fixture.personId);
    const preview = await fixture.bridge.preview(scope, scope.ownerProfileId, fixture.suggestionId, draft);
    const first = await fixture.bridge.confirm(scope, scope.ownerProfileId, preview.id, IDEMPOTENCY_KEY, draft);
    await fixture.studioRepository.dismissSuggestion(scope, fixture.suggestionId);

    await expect(fixture.bridge.confirm(scope, scope.ownerProfileId, preview.id, IDEMPOTENCY_KEY, draft)).resolves.toEqual(first);
    await expect(fixture.operationalCount("task")).resolves.toBe(1);
  });

  it("never expires or reclaims an in-flight confirmation after the preview deadline", async () => {
    const fixture = await createFixture();
    const draft = draftFor("task", fixture.areaId, fixture.personId);
    const preview = await fixture.bridge.preview(scope, scope.ownerProfileId, fixture.suggestionId, draft);
    const claimed = await fixture.operationsStore.claimConfirmation({
      scope,
      actorProfileId: scope.ownerProfileId,
      previewId: preview.id,
      idempotencyKey: IDEMPOTENCY_KEY,
      payload: draft,
      claimToken: "claim_a",
      claimLeaseExpiresAt: "2026-07-16T13:00:00.000Z",
      now: "2026-07-14T12:00:00.000Z"
    });
    expect(claimed.type).toBe("claimed");

    await expect(fixture.operationsStore.claimConfirmation({
      scope,
      actorProfileId: scope.ownerProfileId,
      previewId: preview.id,
      idempotencyKey: IDEMPOTENCY_KEY,
      payload: draft,
      claimToken: "claim_b",
      claimLeaseExpiresAt: "2026-07-16T14:00:00.000Z",
      now: "2026-07-16T12:00:00.000Z"
    })).resolves.toEqual({ type: "busy" });
    await expect(fixture.operationsStore.findPreview(scope, preview.id)).resolves.toMatchObject({ status: "confirming" });
  });
});

async function createFixture(
  now: (() => Date) | undefined = undefined,
  routineRepository: RoutineRepository = createInMemoryRoutineRepository()
) {
  const isoNow = () => (now?.() ?? new Date("2026-07-14T12:00:00.000Z")).toISOString();
  const studioRepository = createInMemoryStudioRepository({ now: isoNow });
  const companyRepository = createInMemoryCompanyRepository({ now: isoNow });
  const processRepository = createInMemoryProcessRepository({ now: isoNow });
  const announcementRepository = createInMemoryAnnouncementRepository({ now: isoNow });
  const operationsStore = createInMemoryStudioOperationsStore({ now: isoNow });
  const area = await companyRepository.createArea({
    workspaceId: scope.workspaceId,
    name: "Operações",
    description: null
  });
  const person = await companyRepository.createTeamMember({
    workspaceId: scope.workspaceId,
    name: "Pessoa",
    email: null,
    role: "employee",
    areaId: area.id,
    roleTemplateId: null,
    createdByProfileId: scope.ownerProfileId
  });
  const document = await studioRepository.createDocument({
    ...scope,
    title: "Decisão estratégica",
    bodyJson: {},
    bodyText: "Transformar clareza em movimento.",
    captureMode: "text",
    inboxState: "reviewed",
    isFocused: true,
    status: "active"
  });
  const { suggestion } = await studioRepository.createAssistantSuggestion({
    ...scope,
    documentId: document.id,
    conversationId: null,
    aiRunId: "ai_run_operation",
    kind: "text",
    payloadJson: {
      facts: [],
      inferences: [],
      gaps: [],
      citations: [],
      proposal: {
        document_id: document.id,
        expected_revision: document.revision,
        title: document.title,
        body_json: document.bodyJson,
        body_text: document.bodyText
      }
    },
    citations: []
  });
  const bridge = createStudioOperationsBridge({
    studioRepository,
    operationsStore,
    companyRepository,
    routineRepository,
    processRepository,
    announcementRepository,
    now
  });

  return {
    bridge,
    operationsStore,
    studioRepository,
    areaId: area.id,
    personId: person.id,
    documentId: document.id,
    suggestionId: suggestion.id,
    async operationalCount(resourceType: StudioOperationDraft["resource_type"]) {
      if (resourceType === "task") return (await routineRepository.listTaskOccurrences(scope.workspaceId)).length;
      if (resourceType === "routine") return (await routineRepository.listRoutines(scope.workspaceId)).length;
      if (resourceType === "process") return (await processRepository.listProcesses(scope.workspaceId)).length;
      return (await announcementRepository.listAnnouncements(scope.workspaceId)).length;
    },
    async operationalRecord(resourceType: StudioOperationDraft["resource_type"], resourceId: string) {
      if (resourceType === "task") return routineRepository.findTaskOccurrence(scope.workspaceId, resourceId);
      if (resourceType === "routine") return routineRepository.findRoutine(scope.workspaceId, resourceId);
      if (resourceType === "process") return processRepository.findProcess(scope.workspaceId, resourceId);
      return announcementRepository.findAnnouncement(scope.workspaceId, resourceId);
    }
  };
}

function draftFor(
  resourceType: StudioOperationDraft["resource_type"],
  areaId: string,
  personId: string
): StudioOperationDraft {
  if (resourceType === "task") return {
    resource_type: "task",
    payload: {
      title: "Original task",
      area_id: areaId,
      assignee_profile_id: personId,
      due_date: "2026-07-20",
      due_hint: "Até 17h",
      approval_mode: "direct",
      evidence_policy: "optional",
      checklist_items: ["Revisar", "Concluir"]
    }
  };
  if (resourceType === "routine") return {
    resource_type: "routine",
    payload: {
      title: "Original routine",
      area_id: areaId,
      frequency: "weekly",
      weekdays: ["mon"],
      due_hint: "Primeira atividade",
      assignee_profile_ids: [personId],
      execution_mode: "individual",
      approval_mode: "direct",
      evidence_policy: "optional",
      task_templates: [{
        title: "Revisar o cenário",
        process_id: null,
        assignee_profile_id: personId,
        due_hint: null,
        approval_mode: "direct",
        evidence_policy: "optional"
      }]
    }
  };
  if (resourceType === "process") return {
    resource_type: "process",
    payload: {
      title: "Original process",
      body: "Contexto e modo de executar.",
      area_id: areaId,
      summary: "Resumo",
      owner: { type: "person", person_id: personId }
    }
  };
  return {
    resource_type: "announcement",
    payload: {
      title: "Original announcement",
      body: "Mensagem para a área.",
      type: "simple",
      requirement: "read_confirmation",
      audience: { type: "area", area_id: areaId },
      related_process_id: null,
      related_training_id: null,
      quiz_questions: []
    }
  };
}

function editTitle<T extends StudioOperationDraft>(draft: T, title: string): T {
  return { ...draft, payload: { ...draft.payload, title } } as T;
}
