import { describe, expect, it, vi } from "vitest";
import { createAiHarness } from "../ai/ai-harness";
import { createInMemoryAiRepository } from "../ai/in-memory-ai.repository";
import { createMockAiProvider } from "../ai/providers/mock-ai.provider";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import { createStudioRitualService } from "./studio-ritual.service";
import { createStudioService } from "./studio.service";
import type { StudioContextBuilder } from "./studio-context-builder";
import type { StudioMemoryIndex } from "./studio-memory";

const scope = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
const now = "2026-07-13T12:00:00.000Z";

function preparedOutput(ritualId: string) {
  return {
    facts: [], inferences: [], gaps: [], citations: [],
    proposal: {
      ritual_id: ritualId, title: "Revisão semanal", intent: "Decidir com clareza",
      agenda: [{ prompt: "O que mudou?", purpose: "Separar fatos de impressão" }],
      preparation_notes: ["Revisar os sinais reunidos"], suggested_duration_minutes: 30
    }
  };
}

async function fixture(options: { failPreparation?: boolean } = {}) {
  const repository = createInMemoryStudioRepository({ now: () => now });
  const studio = createStudioService(repository, { now: () => now });
  const document = await studio.createDocument(scope, scope.ownerProfileId, {
    title: "Revisão", body_json: {}, body_text: "Revisar a empresa", capture_mode: "text"
  });
  const ritual = await studio.createStructure(scope, scope.ownerProfileId, document.id, {
    kind: "ritual",
    cadence_json: { frequency: "weekly", weekdays: [1], local_time: "09:00", timezone: "America/Sao_Paulo" },
    properties_json: {
      intention: "Decidir prioridades",
      guide_questions: ["O que mudou?"],
      allowed_internal_sources: ["dashboard", "task"]
    }
  });
  const buildStudioContext = vi.fn(async () => ({
    period: { from: "2026-06-13", to: "2026-07-13" }, facts: [], citations: [], serializedBytes: 64, truncated: false
  }));
  const findRelated = vi.fn(async () => [{
    documentId: document.id, versionId: "version_1", chunkIndex: 0, excerpt: "Prioridades",
    score: 0.8, vectorScore: 0.8, lexicalScore: 0.2, recencyScore: 1,
    updatedAt: now, cursor: "cursor"
  }]);
  const provider = options.failPreparation
    ? { ...createMockAiProvider(), generateStructured: vi.fn(async () => { throw new Error("PROVIDER_DOWN"); }) }
    : createMockAiProvider({ structuredOutput: preparedOutput(ritual.id) });
  const service = createStudioRitualService({
    repository,
    harness: createAiHarness({ repository: createInMemoryAiRepository(), provider }),
    contextBuilder: { buildStudioContext } as StudioContextBuilder,
    memoryIndex: { findRelated } as unknown as StudioMemoryIndex,
    now: () => new Date(now)
  });
  return { repository, ritual, document, service, buildStudioContext, findRelated };
}

describe("Studio ritual sessions", () => {
  it("creates one prepared owner-scoped session with deterministic bounded context", async () => {
    const setup = await fixture();
    const [left, right] = await Promise.all([
      setup.service.startSession(scope, setup.ritual.id),
      setup.service.startSession(scope, setup.ritual.id)
    ]);
    expect(left.id).toBe(right.id);
    expect(left).toMatchObject({ ritualId: setup.ritual.id, status: "ready", revision: expect.any(Number) });
    expect(left.contextJson).toMatchObject({
      ritual: { id: setup.ritual.id, nextRunAt: "2026-07-20T12:00:00.000Z" },
      operational: { period: { from: "2026-06-13", to: "2026-07-13" } }
    });
    expect(left.preparationJson).toMatchObject({ proposal: { ritual_id: setup.ritual.id } });
    expect(setup.buildStudioContext).toHaveBeenCalledWith(scope, {
      from: "2026-06-13", to: "2026-07-13", resourceTypes: ["dashboard", "task"], personIds: []
    });
    expect(setup.findRelated).toHaveBeenCalledWith(scope, {
      documentId: setup.document.id, query: "Decidir prioridades", limit: 12
    });
  });

  it("keeps preparation failures retryable and never blocks manual partial answers", async () => {
    const setup = await fixture({ failPreparation: true });
    const failed = await setup.service.startSession(scope, setup.ritual.id);
    expect(failed).toMatchObject({ status: "failed", failureCode: "STUDIO_RITUAL_PREPARATION_FAILED" });
    const answered = await setup.service.updateSession(scope, failed.id, {
      expectedRevision: failed.revision, answers: { "O que mudou?": "Contratamos uma pessoa." }
    });
    expect(answered).toMatchObject({ status: "in_progress", answersJson: { "O que mudou?": "Contratamos uma pessoa." } });
  });

  it("persists final answers before optional synthesis and prevents restarting a completed session", async () => {
    const setup = await fixture();
    const started = await setup.service.startSession(scope, setup.ritual.id);
    const completed = await setup.service.finishSession(scope, started.id, {
      expectedRevision: started.revision,
      answers: { "O que mudou?": "A margem melhorou." },
      requestSynthesis: false
    });
    expect(completed).toMatchObject({
      status: "completed", answersJson: { "O que mudou?": "A margem melhorou." }, completedAt: now
    });
    await expect(setup.service.updateSession(scope, completed.id, {
      expectedRevision: completed.revision, answers: { "O que mudou?": "Sobrescrever" }
    })).rejects.toThrow("STUDIO_RITUAL_SESSION_COMPLETED");
    const repeated = await setup.service.finishSession(scope, completed.id, {
      expectedRevision: completed.revision, answers: {}, requestSynthesis: false
    });
    expect(repeated).toEqual(completed);
  });

  it("isolates sessions by owner and only accepts active ritual structures", async () => {
    const setup = await fixture();
    const session = await setup.service.startSession(scope, setup.ritual.id);
    const foreign = { ...scope, ownerProfileId: "owner_b" };
    await expect(setup.service.listSessions(foreign, setup.ritual.id, { limit: 10 }))
      .rejects.toThrow("STUDIO_RITUAL_NOT_FOUND");
    await expect(setup.service.updateSession(foreign, session.id, {
      expectedRevision: session.revision, answers: { x: "y" }
    })).rejects.toThrow("STUDIO_RITUAL_SESSION_NOT_FOUND");

    const archived = await setup.repository.updateStructure({
      ...setup.ritual, lifecycleStatus: "archived", archivedAt: "2026-07-13T12:05:00.000Z"
    }, setup.ritual.revision);
    await expect(setup.service.startSession(scope, archived.id)).rejects.toThrow("STUDIO_RITUAL_NOT_FOUND");
    await expect(setup.service.listSessions(scope, archived.id, { limit: 10 }))
      .resolves.toMatchObject({ items: [{ id: session.id }] });
  });
});
