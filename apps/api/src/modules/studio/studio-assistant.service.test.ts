import { describe, expect, it } from "vitest";
import { createAiHarness } from "../ai/ai-harness";
import { createInMemoryAiRepository } from "../ai/in-memory-ai.repository";
import type { AiProvider, AiTextStreamRequest } from "../ai/ai.types";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";
import { createStudioAssistantService, type StudioSseEvent } from "./studio-assistant.service";
import type { StudioContextBuilder } from "./studio-context-builder";

const owner = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };

describe("Studio assistant service", () => {
  it("persists a grounded streamed turn and a separate reviewable text suggestion", async () => {
    const observed: AiTextStreamRequest[] = [];
    const repository = createInMemoryStudioRepository({ now: monotonicClock() });
    const document = await createDocument(repository);
    const aiRepository = createInMemoryAiRepository({ now: monotonicClock() });
    const provider = providerFor({
      observed,
      structured: suggestionOutput(document.id, document.revision, true),
      externalCitation: true
    });
    const service = createStudioAssistantService({
      repository,
      harness: createAiHarness({ repository: aiRepository, provider, citationResolver: async () => ["93.184.216.34"] }),
      contextBuilder: contextBuilder(),
      now: () => new Date("2026-07-14T12:00:00.000Z")
    });

    const events = await collect(await service.streamTurn(owner, {
      conversationId: null,
      documentId: document.id,
      message: "Compare este pensamento com a operação e proponha uma versão.",
      allowExternalResearch: true,
      requestTextSuggestion: true,
      context: { from: "2026-07-01", to: "2026-07-14", resourceTypes: ["dashboard"], personIds: [] }
    }));

    expect(events.map((event) => event.event)).toEqual([
      "run", "citation", "delta", "citation", "suggestion", "done"
    ]);
    expect(observed).toHaveLength(1);
    expect(observed[0]?.allowExternalResearch).toBe(true);
    const run = events[0] as Extract<StudioSseEvent, { event: "run" }>;
    const done = events.at(-1) as Extract<StudioSseEvent, { event: "done" }>;
    const messages = await repository.listConversationMessages(owner, run.data.conversation_id, 20);
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "Compare este pensamento com a operação e proponha uma versão."],
      ["assistant", "Resposta final fundamentada."]
    ]);
    expect(messages[1]?.id).toBe(done.data.message_id);
    expect(await aiRepository.listRuns(owner.workspaceId, owner.ownerProfileId)).toHaveLength(2);

    const suggestionEvent = events.find((event) => event.event === "suggestion") as Extract<StudioSseEvent, { event: "suggestion" }>;
    expect(suggestionEvent.data.payload_json).toMatchObject({
      facts: [{ statement: "A execução foi consultada.", citation_indexes: [0] }],
      inferences: [{ confidence: "medium" }],
      gaps: [{ question: "Qual é a prioridade?" }],
      citations: [{ source_type: "operational_metric", source_id: "dashboard:period" }],
      proposal: { document_id: document.id, expected_revision: document.revision }
    });
    expect(JSON.stringify(suggestionEvent.data)).not.toContain("workspace_a");
    expect(JSON.stringify(suggestionEvent.data)).not.toContain("owner_a");
    const replayed = await repository.findSuggestion(owner, suggestionEvent.data.id);
    expect(replayed?.payloadJson).toEqual(suggestionEvent.data.payload_json);
    const [first, repeated] = await Promise.all([
      service.acceptSuggestion(owner, suggestionEvent.data.id),
      service.acceptSuggestion(owner, suggestionEvent.data.id)
    ]);
    expect(first.version?.id).toBe(repeated.version?.id);
    expect(first.version).toMatchObject({ origin: "accepted_ai_suggestion", aiRunId: suggestionEvent.data.ai_run_id });
    expect(await repository.listIndexJobs(owner)).toHaveLength(2);
    expect((await repository.findDocument(owner, document.id))?.bodyText).toBe("Versão sugerida e revisável.");
    await expect(service.acceptSuggestion(
      { workspaceId: owner.workspaceId, ownerProfileId: "owner_b" }, suggestionEvent.data.id
    )).rejects.toThrow("STUDIO_SUGGESTION_NOT_FOUND");
  });

  it("never authorizes external research implicitly", async () => {
    const observed: AiTextStreamRequest[] = [];
    const repository = createInMemoryStudioRepository();
    const aiRepository = createInMemoryAiRepository();
    const service = createStudioAssistantService({
      repository,
      harness: createAiHarness({ repository: aiRepository, provider: providerFor({ observed }) })
    });
    const events = await collect(await service.streamTurn(owner, {
      conversationId: null, documentId: null, message: "Pense comigo.",
      allowExternalResearch: false, requestTextSuggestion: false, context: null
    }));
    expect(observed[0]?.allowExternalResearch).toBe(false);
    expect(events.some((event) => event.event === "citation")).toBe(false);
    expect(events.at(-1)?.event).toBe("done");
  });

  it("keeps the user message but no partial assistant or done when cancelled", async () => {
    const repository = createInMemoryStudioRepository({ now: monotonicClock() });
    const aiRepository = createInMemoryAiRepository({ now: monotonicClock() });
    const controller = new AbortController();
    const provider: AiProvider = {
      async generateStructured() { return {}; },
      async *streamText(request) {
        yield { type: "delta", text: "parcial" };
        await new Promise<void>((resolve) => request.signal?.addEventListener("abort", () => resolve(), { once: true }));
        throw new Error("provider private failure");
      },
      async createEmbeddings() { return []; },
      async transcribeAudio() { return { text: "", confidence: null, durationSeconds: null }; }
    };
    const service = createStudioAssistantService({
      repository,
      harness: createAiHarness({ repository: aiRepository, provider })
    });
    const iterable = await service.streamTurn(owner, {
      conversationId: null, documentId: null, message: "Salve antes de responder.",
      allowExternalResearch: false, requestTextSuggestion: false, context: null, signal: controller.signal
    });
    const iterator = iterable[Symbol.asyncIterator]();
    const run = await iterator.next();
    expect(run.value?.event).toBe("run");
    expect((await iterator.next()).value?.event).toBe("delta");
    controller.abort();
    await expect(iterator.next()).rejects.toThrow();
    const conversationId = (run.value as Extract<StudioSseEvent, { event: "run" }>).data.conversation_id;
    expect((await repository.listConversationMessages(owner, conversationId, 20)).map((message) => message.role)).toEqual(["user"]);
    expect((await aiRepository.listRuns(owner.workspaceId, owner.ownerProfileId))[0]).toMatchObject({ status: "failed" });
  });

  it("does not persist an acceptable suggestion when structured output is invalid", async () => {
    const repository = createInMemoryStudioRepository();
    const document = await createDocument(repository);
    const aiRepository = createInMemoryAiRepository();
    const service = createStudioAssistantService({
      repository,
      harness: createAiHarness({ repository: aiRepository, provider: providerFor({ structured: { invalid: true } }) })
    });
    const events = await collect(await service.streamTurn(owner, {
      conversationId: null, documentId: document.id, message: "Sugira uma revisão.",
      allowExternalResearch: false, requestTextSuggestion: true, context: null
    }));
    expect(events.some((event) => event.event === "suggestion")).toBe(false);
    expect(events.at(-1)?.event).toBe("done");
    expect((await aiRepository.listRuns(owner.workspaceId, owner.ownerProfileId)).map((run) => run.status)).toEqual([
      "completed", "failed"
    ]);
    expect(await repository.listVersions(owner, document.id)).toHaveLength(1);
  });

  it("dismisses once and keeps the decision idempotent", async () => {
    const repository = createInMemoryStudioRepository();
    const document = await createDocument(repository);
    const service = createStudioAssistantService({
      repository,
      harness: createAiHarness({
        repository: createInMemoryAiRepository(),
        provider: providerFor({ structured: suggestionOutput(document.id, document.revision) })
      })
    });
    const events = await collect(await service.streamTurn(owner, {
      conversationId: null, documentId: document.id, message: "Sugira.", allowExternalResearch: false,
      requestTextSuggestion: true, context: null
    }));
    const suggestion = events.find((event) => event.event === "suggestion") as Extract<StudioSseEvent, { event: "suggestion" }>;
    expect((await service.dismissSuggestion(owner, suggestion.data.id)).suggestion.status).toBe("dismissed");
    expect((await service.dismissSuggestion(owner, suggestion.data.id)).suggestion.status).toBe("dismissed");
    await expect(service.acceptSuggestion(owner, suggestion.data.id)).rejects.toThrow("STUDIO_SUGGESTION_ALREADY_DECIDED");
  });
});

async function createDocument(repository: ReturnType<typeof createInMemoryStudioRepository>) {
  return repository.createDocument({ ...owner, title: "Pensamento", bodyJson: {}, bodyText: "Original.",
    captureMode: "text", inboxState: "pending_review", isFocused: false, status: "active" });
}

function providerFor(options: { observed?: AiTextStreamRequest[]; structured?: unknown; externalCitation?: boolean } = {}): AiProvider {
  return {
    async generateStructured() { return options.structured ?? {}; },
    async *streamText(request) {
      options.observed?.push(request);
      yield { type: "delta", text: "Resposta final fundamentada." };
      if (options.externalCitation) yield { type: "citation", title: "Fonte pública", url: "https://example.com/fonte", publishedAt: "2026-07-01" };
      yield { type: "done", text: "Resposta final fundamentada." };
    },
    async createEmbeddings() { return []; },
    async transcribeAudio() { return { text: "", confidence: null, durationSeconds: null }; }
  };
}

function suggestionOutput(documentId: string, revision: number, grounded = false) {
  return {
    facts: grounded ? [{ statement: "A execução foi consultada.", citation_indexes: [0] }] : [],
    inferences: grounded ? [{ statement: "Há espaço para foco.", basis: "Execução consultada.", confidence: "medium" }] : [],
    gaps: grounded ? [{ question: "Qual é a prioridade?", reason: "A fonte não define intenção." }] : [],
    citations: grounded ? [{ source_type: "operational_metric", source_id: "dashboard:period", url: null,
      label: "Painel operacional", excerpt: "Execução no período", observed_at: "2026-07-14T12:00:00.000Z",
      period_from: "2026-07-01", period_to: "2026-07-14" }] : [],
    proposal: {
    document_id: documentId, expected_revision: revision, title: "Pensamento revisado",
    body_json: { type: "doc" }, body_text: "Versão sugerida e revisável."
  } };
}

function contextBuilder(): StudioContextBuilder {
  return { async buildStudioContext(scope) { return {
    period: { from: "2026-07-01", to: "2026-07-14" }, facts: [], serializedBytes: 100, truncated: false,
    citations: [{ ...scope, sourceType: "operational_metric", sourceId: "dashboard:period",
      url: null, label: "Painel operacional", excerpt: "Execução no período", observedAt: "2026-07-14T12:00:00.000Z",
      periodFrom: "2026-07-01", periodTo: "2026-07-14",
      metadata: { resourceType: "dashboard", personIds: [], contentTrust: "untrusted_data" } }]
  }; } };
}

async function collect(iterable: AsyncIterable<StudioSseEvent>) {
  const events: StudioSseEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

function monotonicClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 14, 12, 0, 0, tick++)).toISOString();
}
