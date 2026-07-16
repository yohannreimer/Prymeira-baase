import { describe, expect, it, vi } from "vitest";
import { createAiHarness } from "../ai/ai-harness";
import { createInMemoryAiRepository } from "../ai/in-memory-ai.repository";
import { createMockAiProvider } from "../ai/providers/mock-ai.provider";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import { createStudioRitualService } from "./studio-ritual.service";
import { createStudioService } from "./studio.service";
import type { StudioContextBuilder } from "./studio-context-builder";
import type { StudioMemoryIndex } from "./studio-memory";
import type { AiProvider, AiStructuredProviderRequest } from "../ai/ai.types";

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

function synthesisOutput() {
  return {
    summary: "A margem melhorou.",
    decisions: ["Proteger a margem"],
    open_questions: [],
    suggested_next_steps: ["Revisar preços"]
  };
}

async function fixture(options: {
  failPreparation?: boolean;
  preparationTimeoutMs?: number;
  buildStudioContext?: StudioContextBuilder["buildStudioContext"];
  findRelated?: StudioMemoryIndex["findRelated"];
  generateStructured?: AiProvider["generateStructured"];
  title?: string | null;
  bodyText?: string;
  intention?: string;
} = {}) {
  const repository = createInMemoryStudioRepository({ now: () => now });
  const studio = createStudioService(repository, { now: () => now });
  const document = await studio.createDocument(scope, scope.ownerProfileId, {
    title: options.title === undefined ? "Revisão" : options.title,
    body_json: {}, body_text: options.bodyText ?? "Revisar a empresa", capture_mode: "text"
  });
  const ritual = await studio.createStructure(scope, scope.ownerProfileId, document.id, {
    kind: "ritual",
    cadence_json: { frequency: "weekly", weekdays: [1], local_time: "09:00", timezone: "America/Sao_Paulo" },
    properties_json: {
      ...(options.intention === undefined ? { intention: "Decidir prioridades" } : options.intention ? { intention: options.intention } : {}),
      guide_questions: ["O que mudou?"],
      allowed_internal_sources: ["dashboard", "task"]
    }
  });
  const buildStudioContext = vi.fn(options.buildStudioContext ?? (async () => ({
    period: { from: "2026-06-13", to: "2026-07-13" }, facts: [], citations: [], serializedBytes: 64, truncated: false
  })));
  const findRelated = vi.fn(options.findRelated ?? (async () => [{
    documentId: document.id, versionId: "version_1", chunkIndex: 0, excerpt: "Prioridades",
    score: 0.8, vectorScore: 0.8, lexicalScore: 0.2, recencyScore: 1,
    updatedAt: now, cursor: "cursor"
  }]));
  const providerBase = options.failPreparation
    ? { ...createMockAiProvider(), generateStructured: vi.fn(async () => { throw new Error("PROVIDER_DOWN"); }) }
    : options.generateStructured
      ? { ...createMockAiProvider(), generateStructured: options.generateStructured }
      : createMockAiProvider({ structuredOutput: preparedOutput(ritual.id) });
  const provider = {
    ...providerBase,
    generateStructured: vi.fn(providerBase.generateStructured.bind(providerBase))
  };
  const service = createStudioRitualService({
    repository,
    harness: createAiHarness({ repository: createInMemoryAiRepository(), provider }),
    contextBuilder: { buildStudioContext } as StudioContextBuilder,
    memoryIndex: { findRelated } as unknown as StudioMemoryIndex,
    model: "gpt-5.6-terra",
    now: () => new Date(now),
    preparationTimeoutMs: options.preparationTimeoutMs
  });
  return { repository, ritual, document, service, buildStudioContext, findRelated, provider };
}

describe("Studio ritual sessions", () => {
  it("persists a usable session immediately and prepares it only in maintenance", async () => {
    const setup = await fixture();

    const session = await setup.service.startSession(scope, setup.ritual.id);

    expect(session).toMatchObject({
      status: "preparing",
      answersJson: {},
      contextJson: { ritual: { guideQuestions: ["O que mudou?"] } }
    });
    expect(setup.provider.generateStructured).not.toHaveBeenCalled();

    await setup.service.processNextPreparation();

    expect(await setup.repository.findRitualSession(scope, session.id)).toMatchObject({
      status: "ready",
      preparationJson: { proposal: { ritual_id: setup.ritual.id } }
    });
  });

  it("merges background preparation over answers saved during the worker run", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const setup = await fixture({
      generateStructured: async (request) => {
        await blocked;
        return preparedOutput((request.input as { ritual: { id: string } }).ritual.id);
      }
    });
    const started = await setup.service.startSession(scope, setup.ritual.id);
    const processing = setup.service.processNextPreparation();
    await vi.waitFor(() => expect(setup.provider.generateStructured).toHaveBeenCalled());
    const answered = await setup.service.updateSession(scope, started.id, {
      expectedRevision: (await setup.repository.findRitualSession(scope, started.id))!.revision,
      answers: { "O que mudou?": "A margem melhorou." }
    });
    expect(answered.status).toBe("preparing");
    release();
    await processing;

    expect(await setup.repository.findRitualSession(scope, started.id)).toMatchObject({
      status: "in_progress",
      answersJson: { "O que mudou?": "A margem melhorou." },
      preparationJson: { proposal: { ritual_id: setup.ritual.id } }
    });
  });

  it("preserves answers saved before any worker claims the queued preparation", async () => {
    const setup = await fixture();
    const started = await setup.service.startSession(scope, setup.ritual.id);
    const answered = await setup.service.updateSession(scope, started.id, {
      expectedRevision: started.revision,
      answers: { "O que mudou?": "Resposta antes do worker." }
    });
    expect(answered).toMatchObject({ status: "preparing", preparationToken: null });

    await setup.service.processNextPreparation();

    expect(await setup.repository.findRitualSession(scope, started.id)).toMatchObject({
      status: "in_progress",
      answersJson: { "O que mudou?": "Resposta antes do worker." },
      preparationJson: { proposal: { ritual_id: setup.ritual.id } }
    });
  });

  it("keeps answers and exposes an honest state when a claimed provider fails", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const setup = await fixture({
      generateStructured: async () => {
        await blocked;
        throw new Error("PROVIDER_UNAVAILABLE");
      }
    });
    const started = await setup.service.startSession(scope, setup.ritual.id);
    const processing = setup.service.processNextPreparation();
    await vi.waitFor(() => expect(setup.provider.generateStructured).toHaveBeenCalledTimes(1));
    const claimed = (await setup.repository.findRitualSession(scope, started.id))!;
    await setup.service.updateSession(scope, started.id, {
      expectedRevision: claimed.revision,
      answers: { "O que mudou?": "Esta resposta não pode sumir." }
    });
    release();
    await processing;

    expect(await setup.repository.findRitualSession(scope, started.id)).toMatchObject({
      status: "in_progress",
      answersJson: { "O que mudou?": "Esta resposta não pode sumir." },
      failureCode: null,
      contextJson: { preparationFailureCode: "STUDIO_RITUAL_PREPARATION_FAILED" }
    });
  });

  it("fences a stale worker after its expired claim is reclaimed", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    const setup = await fixture({
      generateStructured: async (request) => {
        calls += 1;
        const callNumber = calls;
        if (callNumber === 1) await firstBlocked;
        const output = preparedOutput((request.input as { ritual: { id: string } }).ritual.id);
        output.proposal.title = `Worker ${callNumber}`;
        return output;
      }
    });
    const started = await setup.service.startSession(scope, setup.ritual.id);
    const staleWorker = setup.service.processNextPreparation();
    await vi.waitFor(() => expect(setup.provider.generateStructured).toHaveBeenCalledTimes(1));
    const firstClaim = (await setup.repository.findRitualSession(scope, started.id))!;
    await setup.repository.updateRitualSession({
      ...firstClaim,
      preparationLeaseExpiresAt: "2026-07-13T11:59:59.999Z"
    }, firstClaim.revision);

    await setup.service.processNextPreparation();
    releaseFirst();
    await staleWorker;

    expect(await setup.repository.findRitualSession(scope, started.id)).toMatchObject({
      status: "ready",
      preparationJson: { proposal: { title: "Worker 2" } }
    });
  });

  it("creates one prepared owner-scoped session with deterministic bounded context", async () => {
    const setup = await fixture();
    const [left, right] = await Promise.all([
      setup.service.startSession(scope, setup.ritual.id),
      setup.service.startSession(scope, setup.ritual.id)
    ]);
    expect(left.id).toBe(right.id);
    expect(left).toMatchObject({ ritualId: setup.ritual.id, status: "preparing", revision: expect.any(Number) });
    await setup.service.processNextPreparation();
    const prepared = (await setup.repository.findRitualSession(scope, left.id))!;
    expect(prepared.contextJson).toMatchObject({
      ritual: { id: setup.ritual.id, nextRunAt: "2026-07-20T12:00:00.000Z" },
      operational: { period: { from: "2026-06-13", to: "2026-07-13" } }
    });
    expect(prepared.preparationJson).toMatchObject({ proposal: { ritual_id: setup.ritual.id } });
    expect(setup.buildStudioContext).toHaveBeenCalledWith(scope, {
      from: "2026-06-13", to: "2026-07-13", resourceTypes: ["dashboard", "task"], personIds: []
    }, { signal: expect.any(AbortSignal) });
    expect(setup.findRelated).toHaveBeenCalledWith(scope, expect.objectContaining({
      documentId: setup.document.id, query: "Decidir prioridades", limit: 12,
      signal: expect.any(AbortSignal)
    }));
  });

  it("uses the configured model for preparation and synthesis", async () => {
    const observedModels: string[] = [];
    const setup = await fixture({
      generateStructured: async (request) => {
        observedModels.push(request.model);
        return request.taskKind === "studio_ritual_prepare"
          ? preparedOutput((request.input as { ritual: { id: string } }).ritual.id)
          : synthesisOutput();
      }
    });
    const started = await setup.service.startSession(scope, setup.ritual.id);
    await setup.service.processNextPreparation();
    const prepared = (await setup.repository.findRitualSession(scope, started.id))!;
    await setup.service.finishSession(scope, started.id, {
      expectedRevision: prepared.revision,
      answers: { "O que mudou?": "A margem melhorou." },
      requestSynthesis: true
    });
    expect(observedModels).toEqual(["gpt-5.6-terra", "gpt-5.6-terra"]);
  });

  it("keeps preparation failures retryable and never blocks manual partial answers", async () => {
    const setup = await fixture({ failPreparation: true });
    const started = await setup.service.startSession(scope, setup.ritual.id);
    await setup.service.processNextPreparation();
    const failed = (await setup.repository.findRitualSession(scope, started.id))!;
    expect(failed).toMatchObject({ status: "failed", failureCode: "STUDIO_RITUAL_PREPARATION_FAILED" });
    const answered = await setup.service.updateSession(scope, failed.id, {
      expectedRevision: failed.revision, answers: { "O que mudou?": "Contratamos uma pessoa." }
    });
    expect(answered).toMatchObject({ status: "preparing", answersJson: { "O que mudou?": "Contratamos uma pessoa." } });
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

  it("advances the configured cadence after a ritual session is completed", async () => {
    const setup = await fixture();
    const started = await setup.service.startSession(scope, setup.ritual.id);
    await setup.service.finishSession(scope, started.id, {
      expectedRevision: started.revision,
      answers: { "O que mudou?": "A margem melhorou." },
      requestSynthesis: false
    });

    expect(await setup.repository.findStructure(scope, setup.ritual.id)).toMatchObject({
      nextRunAt: "2026-07-27T12:00:00.000Z"
    });
  });

  it("reconciles one cadence occurrence after a partial finish failure without advancing it twice", async () => {
    const setup = await fixture();
    const started = await setup.service.startSession(scope, setup.ritual.id);
    const updateStructure = setup.repository.updateStructure.bind(setup.repository);
    let advanceAttempts = 0;
    setup.repository.updateStructure = async (input, expectedRevision) => {
      advanceAttempts += 1;
      if (advanceAttempts === 1) throw new Error("DB_DOWN");
      return updateStructure(input, expectedRevision);
    };

    await expect(setup.service.finishSession(scope, started.id, {
      expectedRevision: started.revision,
      answers: { "O que mudou?": "A margem melhorou." },
      requestSynthesis: false
    })).rejects.toThrow("DB_DOWN");
    expect(await setup.repository.findRitualSession(scope, started.id)).toMatchObject({
      status: "completed",
      answersJson: { "O que mudou?": "A margem melhorou." }
    });

    const recovered = await setup.service.finishSession(scope, started.id, {
      expectedRevision: started.revision,
      answers: { ignored: "não sobrescrever" },
      requestSynthesis: false
    });
    expect(recovered.status).toBe("completed");
    expect(await setup.repository.findStructure(scope, setup.ritual.id)).toMatchObject({
      nextRunAt: "2026-07-27T12:00:00.000Z"
    });

    await setup.service.finishSession(scope, started.id, {
      expectedRevision: recovered.revision,
      answers: {},
      requestSynthesis: false
    });
    expect(await setup.repository.findStructure(scope, setup.ritual.id)).toMatchObject({
      nextRunAt: "2026-07-27T12:00:00.000Z"
    });
    expect(advanceAttempts).toBe(2);
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

  it("aborts every preparation boundary before its lease and releases single-flight for retry", async () => {
    let calls = 0;
    let observedContextSignal: AbortSignal | undefined;
    const setup = await fixture({
      preparationTimeoutMs: 20,
      buildStudioContext: async (_scope, _request, operation) => {
        calls += 1;
        observedContextSignal = operation?.signal;
        if (calls === 1) return new Promise(() => undefined);
        return { period: { from: "2026-06-13", to: "2026-07-13" }, facts: [], citations: [], serializedBytes: 0, truncated: false };
      }
    });
    const startedAt = Date.now();
    const started = await setup.service.startSession(scope, setup.ritual.id);
    await setup.service.processNextPreparation();
    const failed = (await setup.repository.findRitualSession(scope, started.id))!;
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(failed).toMatchObject({ status: "failed", failureCode: "STUDIO_RITUAL_PREPARATION_TIMEOUT" });
    expect(observedContextSignal?.aborted).toBe(true);
    await setup.service.startSession(scope, setup.ritual.id);
    await setup.service.processNextPreparation();
    const retried = (await setup.repository.findRitualSession(scope, started.id))!;
    expect(retried.status).toBe("ready");
    expect(calls).toBe(2);
  });

  it("claims an expired preparation lease and propagates the operation signal to memory and harness", async () => {
    const seenSignals: AbortSignal[] = [];
    const setup = await fixture({
      findRelated: async (_scope, input) => {
        if (input.signal) seenSignals.push(input.signal);
        return [];
      },
      generateStructured: async (request) => {
        if (request.signal) seenSignals.push(request.signal);
        return preparedOutput((request.input as { ritual: { id: string } }).ritual.id);
      }
    });
    await setup.repository.createRitualSession({
      ...scope, ritualId: setup.ritual.id, preparationToken: "abandoned",
      preparationLeaseExpiresAt: "2026-07-13T11:59:59.000Z"
    });
    const started = await setup.service.startSession(scope, setup.ritual.id);
    await setup.service.processNextPreparation();
    const ready = (await setup.repository.findRitualSession(scope, started.id))!;
    expect(ready.status).toBe("ready");
    expect(seenSignals).toHaveLength(2);
    expect(seenSignals.every((signal) => !signal.aborted)).toBe(true);
  });

  it("retries a missing completed-session synthesis once, fenced and without changing persisted answers", async () => {
    let synthesisCalls = 0;
    const setup = await fixture({
      generateStructured: async (request: AiStructuredProviderRequest) => {
        if (request.taskKind === "studio_ritual_prepare") return preparedOutput((request.input as { ritual: { id: string } }).ritual.id);
        synthesisCalls += 1;
        if (synthesisCalls === 1) throw new Error("TRANSIENT_SYNTHESIS_FAILURE");
        return synthesisOutput();
      }
    });
    const started = await setup.service.startSession(scope, setup.ritual.id);
    const first = await setup.service.finishSession(scope, started.id, {
      expectedRevision: started.revision,
      answers: { "O que mudou?": "A margem melhorou." },
      requestSynthesis: true
    });
    expect(first).toMatchObject({
      status: "completed", synthesisJson: null,
      synthesisFailureCode: "STUDIO_RITUAL_SYNTHESIS_FAILED",
      answersJson: { "O que mudou?": "A margem melhorou." }
    });
    const [retried, duplicate] = await Promise.all([
      setup.service.finishSession(scope, started.id, {
        expectedRevision: started.revision, answers: { ignored: "must not overwrite" }, requestSynthesis: true
      }),
      setup.service.finishSession(scope, started.id, {
        expectedRevision: started.revision, answers: {}, requestSynthesis: true
      })
    ]);
    expect(retried.id).toBe(duplicate.id);
    expect(retried).toMatchObject({
      synthesisJson: synthesisOutput(), synthesisFailureCode: null,
      answersJson: { "O que mudou?": "A margem melhorou." }
    });
    expect(synthesisCalls).toBe(2);
  });

  it("bounds a multibyte body fallback before memory, snapshot, and model input", async () => {
    let memoryQuery = "";
    let modelInput: unknown;
    const setup = await fixture({
      title: null,
      bodyText: "🧠".repeat(180_000),
      intention: "",
      findRelated: async (_scope, input) => { memoryQuery = input.query; return []; },
      generateStructured: async (request) => {
        modelInput = request.input;
        return preparedOutput((request.input as { ritual: { id: string } }).ritual.id);
      }
    });
    const started = await setup.service.startSession(scope, setup.ritual.id);
    await setup.service.processNextPreparation();
    const session = (await setup.repository.findRitualSession(scope, started.id))!;
    const intention = (session.contextJson?.ritual as { intention: string }).intention;
    expect(Buffer.byteLength(intention, "utf8")).toBeLessThanOrEqual(24_000);
    expect(memoryQuery).toBe(intention);
    expect(Buffer.byteLength(JSON.stringify(session.contextJson), "utf8")).toBeLessThanOrEqual(512_000);
    expect(Buffer.byteLength(JSON.stringify(modelInput), "utf8")).toBeLessThanOrEqual(512_000);
  });

  it("rejects semantically corrupt legacy ready and completed rows with a controlled error", async () => {
    const setup = await fixture();
    const started = await setup.service.startSession(scope, setup.ritual.id);
    await setup.service.processNextPreparation();
    const ready = (await setup.repository.findRitualSession(scope, started.id))!;
    setup.repository.findRitualSession = async () => ({ ...ready, preparationJson: {} });
    await expect(setup.service.updateSession(scope, ready.id, {
      expectedRevision: ready.revision, answers: { a: "b" }
    })).rejects.toThrow("STUDIO_RITUAL_SESSION_DATA_INVALID");

    setup.repository.findRitualSession = async () => ({
      ...ready, status: "completed", completedAt: now,
      preparationToken: null, preparationLeaseExpiresAt: null,
      synthesisJson: { summary: 123 }, synthesisAiRunId: "run_bad"
    } as never);
    await expect(setup.service.finishSession(scope, ready.id, {
      expectedRevision: ready.revision, answers: {}, requestSynthesis: false
    })).rejects.toThrow("STUDIO_RITUAL_SESSION_DATA_INVALID");
  });
});
