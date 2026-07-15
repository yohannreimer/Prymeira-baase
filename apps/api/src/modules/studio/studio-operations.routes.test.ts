import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createInMemoryCompanyRepository } from "../company/in-memory-company.repository";
import { createInMemoryRoutineRepository } from "../routines/in-memory-routine.repository";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";

const ownerA = { "x-baase-workspace-id": "workspace_a", "x-baase-role": "owner", "x-baase-profile-id": "owner_a" };
const ownerB = { ...ownerA, "x-baase-profile-id": "owner_b" };
const manager = { ...ownerA, "x-baase-role": "manager", "x-baase-profile-id": "manager_a" };
const KEY = "11111111-1111-4111-8111-111111111111";

describe("Studio operation preview routes", () => {
  it("previews with no side effect and confirms one edited resource on owner-only routes", async () => {
    const fixture = await routeFixture();
    const previewResponse = await fixture.app.inject({
      method: "POST",
      url: `/studio/suggestions/${fixture.suggestionId}/operation-preview`,
      headers: ownerA,
      payload: fixture.draft
    });
    expect(previewResponse.statusCode).toBe(201);
    expect(previewResponse.json().preview).toMatchObject({
      source_suggestion_id: fixture.suggestionId,
      source_document_id: fixture.documentId,
      resource_type: "task",
      status: "preview",
      idempotency_key: null,
      result_resource_id: null
    });
    await expect(fixture.routineRepository.listTaskOccurrences("workspace_a")).resolves.toHaveLength(0);

    const previewId = previewResponse.json().preview.id as string;
    const edited = { ...fixture.draft, payload: { ...fixture.draft.payload, title: "Revisado pelo dono" } };
    const first = await fixture.app.inject({
      method: "POST",
      url: `/studio/suggestions/${fixture.suggestionId}/operation-confirm`,
      headers: { ...ownerA, "idempotency-key": KEY },
      payload: { preview_id: previewId, draft: edited }
    });
    const repeated = await fixture.app.inject({
      method: "POST",
      url: `/studio/suggestions/${fixture.suggestionId}/operation-confirm`,
      headers: { ...ownerA, "idempotency-key": KEY },
      payload: { preview_id: previewId, draft: fixture.draft }
    });
    expect(first.statusCode).toBe(201);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().link.id).toBe(first.json().link.id);
    const tasks = await fixture.routineRepository.listTaskOccurrences("workspace_a");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "Revisado pelo dono", id: first.json().link.resource_id });
  });

  it("enforces owner scope and bounded strict request contracts", async () => {
    const fixture = await routeFixture();
    const path = `/studio/suggestions/${fixture.suggestionId}/operation-preview`;
    for (const headers of [manager, ownerB]) {
      const response = await fixture.app.inject({ method: "POST", url: path, headers, payload: fixture.draft });
      expect(response.statusCode).toBe(headers === manager ? 403 : 404);
    }
    const unknown = await fixture.app.inject({
      method: "POST", url: path, headers: ownerA,
      payload: { ...fixture.draft, unexpected_private_field: "x" }
    });
    expect(unknown.statusCode).toBe(400);
    const oversized = await fixture.app.inject({
      method: "POST", url: path, headers: ownerA,
      payload: { ...fixture.draft, payload: { ...fixture.draft.payload, checklist_items: Array.from({ length: 101 }, (_, index) => `Passo ${index}`) } }
    });
    expect(oversized.statusCode).toBe(400);
    const invalidRecurrence = await fixture.app.inject({
      method: "POST", url: path, headers: ownerA,
      payload: {
        resource_type: "routine",
        payload: {
          title: "Sem dia", area_id: null, frequency: "weekly", weekdays: [], due_hint: null,
          assignee_profile_ids: [], execution_mode: "shared", approval_mode: "direct",
          evidence_policy: "optional", task_templates: [{
            title: "Passo", process_id: null, assignee_profile_id: null, due_hint: null,
            approval_mode: "direct", evidence_policy: "optional"
          }]
        }
      }
    });
    expect(invalidRecurrence.statusCode).toBe(400);

    const preview = await fixture.app.inject({ method: "POST", url: path, headers: ownerA, payload: fixture.draft });
    const confirmPath = `/studio/suggestions/${fixture.suggestionId}/operation-confirm`;
    const missingKey = await fixture.app.inject({
      method: "POST", url: confirmPath, headers: ownerA,
      payload: { preview_id: preview.json().preview.id, draft: fixture.draft }
    });
    const malformedKey = await fixture.app.inject({
      method: "POST", url: confirmPath, headers: { ...ownerA, "idempotency-key": "not-a-uuid" },
      payload: { preview_id: preview.json().preview.id, draft: fixture.draft }
    });
    expect(missingKey.statusCode).toBe(400);
    expect(malformedKey.statusCode).toBe(400);
  });
});

async function routeFixture() {
  const now = () => "2026-07-14T12:00:00.000Z";
  const studioRepository = createInMemoryStudioRepository({ now });
  const companyRepository = createInMemoryCompanyRepository({ now });
  const routineRepository = createInMemoryRoutineRepository({ now });
  const area = await companyRepository.createArea({ workspaceId: "workspace_a", name: "Operações", description: null });
  const person = await companyRepository.createTeamMember({
    workspaceId: "workspace_a", name: "Pessoa", email: null, role: "employee", areaId: area.id,
    roleTemplateId: null, createdByProfileId: "owner_a"
  });
  const document = await studioRepository.createDocument({
    workspaceId: "workspace_a", ownerProfileId: "owner_a", title: "Origem", bodyJson: {}, bodyText: "Origem",
    captureMode: "text", inboxState: "reviewed", isFocused: false, status: "active"
  });
  const { suggestion } = await studioRepository.createAssistantSuggestion({
    workspaceId: "workspace_a", ownerProfileId: "owner_a", documentId: document.id, conversationId: null,
    aiRunId: "run", kind: "text", citations: [], payloadJson: {
      facts: [], inferences: [], gaps: [], citations: [],
      proposal: { document_id: document.id, expected_revision: document.revision, title: null, body_json: {}, body_text: "Origem" }
    }
  });
  const draft = {
    resource_type: "task" as const,
    payload: {
      title: "Original", area_id: area.id, assignee_profile_id: person.id, due_date: "2026-07-20",
      due_hint: null, approval_mode: "direct" as const, evidence_policy: "optional" as const,
      checklist_items: ["Passo"]
    }
  };
  return {
    app: buildApp({ studioRepository, companyRepository, routineRepository, now: () => new Date(now()) }),
    routineRepository,
    suggestionId: suggestion.id,
    documentId: document.id,
    draft
  };
}
