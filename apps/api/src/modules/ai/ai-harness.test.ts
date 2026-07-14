import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAiHarness } from "./ai-harness";
import type {
  AiProvider,
  AiStructuredProviderRequest,
  AiTextStreamEvent
} from "./ai.types";
import { createInMemoryAiRepository } from "./in-memory-ai.repository";
import { createMockAiProvider } from "./providers/mock-ai.provider";

const processDraftSchema = z.object({
  title: z.string(),
  steps: z.array(z.string()).min(1)
});

describe("AI harness", () => {
  it("runs a structured provider call, validates the output and stores an AiRun", async () => {
    const repository = createInMemoryAiRepository({ now: () => "2026-07-07T12:00:00.000Z" });
    const harness = createAiHarness({
      repository,
      provider: createMockAiProvider({
        structuredOutput: {
          title: "Responder mensagens pendentes",
          steps: ["Abrir WhatsApp Business", "Responder conversas pendentes"]
        }
      })
    });

    const result = await harness.runStructured({
      workspaceId: "workspace_a",
      actorProfileId: "profile_owner",
      source: "create_with_ai",
      inputMode: "text",
      taskKind: "process_draft",
      agentKey: "process_architect",
      promptKey: "agent/process-architect",
      promptVersion: "1",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      input: { text: "Todo dia precisamos responder mensagens pendentes ate 10h." },
      outputSchema: processDraftSchema
    });

    expect(result.output).toEqual({
      title: "Responder mensagens pendentes",
      steps: ["Abrir WhatsApp Business", "Responder conversas pendentes"]
    });
    expect(result.run).toMatchObject({
      workspaceId: "workspace_a",
      actorProfileId: "profile_owner",
      source: "create_with_ai",
      inputMode: "text",
      agentKey: "process_architect",
      promptVersion: "agent/process-architect@1",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      status: "completed",
      validationErrors: [],
      outputSummary: "Responder mensagens pendentes"
    });

    await expect(repository.listRuns("workspace_a")).resolves.toHaveLength(1);
  });

  it("derives a strict provider JSON schema from the Zod output schema", async () => {
    const providerRequests: AiStructuredProviderRequest[] = [];
    const repository = createInMemoryAiRepository({ now: () => "2026-07-07T12:00:00.000Z" });
    const provider: AiProvider = createProvider({
      async generateStructured(request) {
        providerRequests.push(request);
        return {
          title: "Responder mensagens pendentes",
          steps: ["Abrir WhatsApp Business"]
        };
      },
      async transcribeAudio() {
        throw new Error("NOT_EXPECTED");
      }
    });
    const harness = createAiHarness({ repository, provider });

    await harness.runStructured({
      workspaceId: "workspace_a",
      actorProfileId: "profile_owner",
      source: "create_with_ai",
      inputMode: "text",
      taskKind: "process_draft",
      agentKey: "process_architect",
      promptKey: "agent/process-architect",
      promptVersion: "1",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      input: { text: "Todo dia precisamos responder mensagens pendentes ate 10h." },
      outputSchema: processDraftSchema,
      schemaName: "process_draft"
    });

    expect(providerRequests[0]?.jsonSchema).toMatchObject({
      type: "object",
      required: ["title", "steps"],
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        steps: { type: "array" }
      }
    });
  });

  it("marks the AiRun as failed when structured output does not match the schema", async () => {
    const repository = createInMemoryAiRepository({ now: () => "2026-07-07T12:00:00.000Z" });
    const harness = createAiHarness({
      repository,
      provider: createMockAiProvider({
        structuredOutput: {
          title: "Sem etapas"
        }
      })
    });

    await expect(harness.runStructured({
      workspaceId: "workspace_a",
      actorProfileId: "profile_owner",
      source: "create_with_ai",
      inputMode: "text",
      taskKind: "process_draft",
      agentKey: "process_architect",
      promptKey: "agent/process-architect",
      promptVersion: "1",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      input: { text: "Crie um processo." },
      outputSchema: processDraftSchema
    })).rejects.toThrow("AI_OUTPUT_VALIDATION_FAILED");

    const [run] = await repository.listRuns("workspace_a");
    expect(run).toMatchObject({
      status: "failed",
      validationErrors: expect.arrayContaining([expect.stringContaining("steps")])
    });
  });

  it("transcribes audio through the provider and stores an audio AiRun", async () => {
    const repository = createInMemoryAiRepository({ now: () => "2026-07-07T12:00:00.000Z" });
    const harness = createAiHarness({
      repository,
      provider: createMockAiProvider({
        transcript: {
          text: "Todo dia a atendente responde mensagens pendentes.",
          confidence: 0.97,
          durationSeconds: 42
        }
      })
    });

    const result = await harness.transcribeAudio({
      workspaceId: "workspace_a",
      actorProfileId: "profile_owner",
      source: "onboarding",
      audioUrl: "https://storage.baase.local/audio.wav",
      language: "pt-BR",
      keyterms: ["Baase", "WhatsApp", "Atendimento"]
    });

    expect(result.text).toBe("Todo dia a atendente responde mensagens pendentes.");
    expect(result.confidence).toBe(0.97);

    const [run] = await repository.listRuns("workspace_a");
    expect(run).toMatchObject({
      source: "onboarding",
      inputMode: "audio",
      agentKey: "transcript_normalizer",
      model: "nova-3",
      status: "completed",
      outputSummary: "Todo dia a atendente responde mensagens pendentes."
    });
  });

  it("audits a successful private text stream without storing private input or output content", async () => {
    const repository = createInMemoryAiRepository({ now: () => "2026-07-07T12:00:00.000Z" });
    const updates: string[] = [];
    const auditedRepository = {
      ...repository,
      async updateRun(run: Parameters<typeof repository.updateRun>[0]) {
        updates.push(run.status);
        return repository.updateRun(run);
      }
    };
    const privateTail = "privado".repeat(80);
    const harness = createAiHarness({
      repository: auditedRepository,
      provider: createMockAiProvider({
        streamEvents: [
          { type: "delta", text: "Resumo " },
          { type: "delta", text: privateTail },
          { type: "done", text: `Resumo ${privateTail}` }
        ]
      })
    });

    const result = await harness.runTextStream(streamRunRequest());
    expect(result.run.status).toBe("running");
    expect(await collect(result.events)).toEqual([
      { type: "delta", text: "Resumo " },
      { type: "delta", text: privateTail },
      { type: "done", text: `Resumo ${privateTail}` }
    ]);

    const [run] = await repository.listRuns("workspace_a", "profile_owner");
    expect(run).toMatchObject({
      source: "owner_studio",
      taskKind: "studio_assist",
      status: "completed",
      validationErrors: []
    });
    expect(run?.inputSummary).toBe("[private owner studio input]");
    expect(run?.outputSummary).toBe("[private owner studio output]");
    expect(JSON.stringify(run)).not.toContain("privado");
    expect(updates).toEqual(["completed"]);
  });

  it("marks a provider stream failure exactly once and propagates the error", async () => {
    const repository = createInMemoryAiRepository({ now: () => "2026-07-07T12:00:00.000Z" });
    const updates: string[] = [];
    const provider = createProvider({
      async *streamText() {
        yield { type: "delta", text: "Parcial" } as const;
        throw new Error("PROVIDER_STREAM_FAILED");
      }
    });
    const harness = createAiHarness({
      repository: {
        ...repository,
        async updateRun(run) {
          updates.push(run.status);
          return repository.updateRun(run);
        }
      },
      provider
    });

    const { events } = await harness.runTextStream(streamRunRequest());
    await expect(collect(events)).rejects.toThrow("PROVIDER_STREAM_FAILED");

    const [run] = await repository.listRuns("workspace_a", "profile_owner");
    expect(run).toMatchObject({ status: "failed", validationErrors: ["AI_STREAM_FAILED"] });
    expect(updates).toEqual(["failed"]);
  });

  it("does not leave a run running when a provider rejects before returning an iterator", async () => {
    const repository = createInMemoryAiRepository({ now: () => "2026-07-07T12:00:00.000Z" });
    const provider = createProvider({
      streamText() {
        throw new Error("PROVIDER_START_FAILED");
      }
    });
    const harness = createAiHarness({ repository, provider });

    await expect(harness.runTextStream(streamRunRequest())).rejects.toThrow("PROVIDER_START_FAILED");
    await expect(repository.listRuns("workspace_a", "profile_owner")).resolves.toEqual([
      expect.objectContaining({ status: "failed", validationErrors: ["AI_STREAM_FAILED"] })
    ]);
  });

  it("marks a consumer-cancelled stream as failed exactly once and closes the provider iterator", async () => {
    const repository = createInMemoryAiRepository({ now: () => "2026-07-07T12:00:00.000Z" });
    const updates: string[] = [];
    let providerClosed = false;
    const provider = createProvider({
      async *streamText() {
        try {
          yield { type: "delta", text: "Primeiro" } as const;
          yield { type: "delta", text: "Segundo" } as const;
        } finally {
          providerClosed = true;
        }
      }
    });
    const harness = createAiHarness({
      repository: {
        ...repository,
        async updateRun(run) {
          updates.push(run.status);
          return repository.updateRun(run);
        }
      },
      provider
    });

    const { events } = await harness.runTextStream(streamRunRequest());
    const iterator = events[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "delta", text: "Primeiro" } });
    await iterator.return?.();

    const [run] = await repository.listRuns("workspace_a", "profile_owner");
    expect(providerClosed).toBe(true);
    expect(run).toMatchObject({ status: "failed", validationErrors: ["AI_STREAM_FAILED"] });
    expect(updates).toEqual(["failed"]);
  });

  it("completes an empty stream once and ignores events after the first provider done", async () => {
    const repository = createInMemoryAiRepository({ now: () => "2026-07-07T12:00:00.000Z" });
    const updates: string[] = [];
    const harness = createAiHarness({
      repository: {
        ...repository,
        async updateRun(run) {
          updates.push(run.status);
          return repository.updateRun(run);
        }
      },
      provider: createMockAiProvider({ streamEvents: [] })
    });

    const empty = await harness.runTextStream(streamRunRequest());
    expect(await collect(empty.events)).toEqual([]);
    expect(updates).toEqual(["completed"]);

    const duplicateRepository = createInMemoryAiRepository({ now: () => "2026-07-07T12:00:00.000Z" });
    const duplicateHarness = createAiHarness({
      repository: duplicateRepository,
      provider: createMockAiProvider({
        streamEvents: [
          { type: "delta", text: "Oi" },
          { type: "done", text: "Oi" },
          { type: "done", text: "Não deve sair" }
        ]
      })
    });
    const duplicate = await duplicateHarness.runTextStream(streamRunRequest());
    expect(await collect(duplicate.events)).toEqual([
      { type: "delta", text: "Oi" },
      { type: "done", text: "Oi" }
    ]);
    await expect(duplicateRepository.listRuns("workspace_a", "profile_owner")).resolves.toEqual([
      expect.objectContaining({ status: "completed", outputSummary: "[private owner studio output]" })
    ]);
  });

  it("finalizes an aborted or never-consumed stream without waiting for the first pull", async () => {
    const abortedRepository = createInMemoryAiRepository();
    const controller = new AbortController();
    const abortedHarness = createAiHarness({
      repository: abortedRepository,
      provider: createMockAiProvider(),
      streamStartTimeoutMs: 1_000
    });
    const aborted = await abortedHarness.runTextStream({ ...streamRunRequest(), signal: controller.signal });
    controller.abort();
    await vi.waitFor(async () => {
      await expect(abortedRepository.findRun(
        "workspace_a", aborted.run.id, "profile_owner"
      )).resolves.toMatchObject({ status: "failed", validationErrors: ["AI_STREAM_FAILED"] });
    });

    const idleRepository = createInMemoryAiRepository();
    const idleHarness = createAiHarness({
      repository: idleRepository,
      provider: createMockAiProvider(),
      streamStartTimeoutMs: 5
    });
    const idle = await idleHarness.runTextStream(streamRunRequest());
    await vi.waitFor(async () => {
      await expect(idleRepository.findRun(
        "workspace_a", idle.run.id, "profile_owner"
      )).resolves.toMatchObject({ status: "failed", validationErrors: ["AI_STREAM_FAILED"] });
    });
  });

  it("bounds an idle provider pull and closes it without leaving the run active", async () => {
    const repository = createInMemoryAiRepository();
    let returned = 0;
    const provider = createProvider({
      streamText() {
        return {
          [Symbol.asyncIterator]() {
            return {
              next: () => new Promise<IteratorResult<AiTextStreamEvent>>(() => undefined),
              async return() {
                returned += 1;
                return { done: true, value: undefined };
              }
            };
          }
        };
      }
    });
    const harness = createAiHarness({
      repository,
      provider,
      streamStartTimeoutMs: 1_000,
      streamIdleTimeoutMs: 5
    });
    const result = await harness.runTextStream(streamRunRequest());

    await expect(collect(result.events)).rejects.toThrow("AI_STREAM_IDLE_TIMEOUT");
    await expect(repository.findRun("workspace_a", result.run.id, "profile_owner")).resolves.toMatchObject({
      status: "failed",
      validationErrors: ["AI_STREAM_FAILED"]
    });
    expect(returned).toBe(1);
  });

  it("allows one consumer, rejects concurrent pulls, and never yields after done", async () => {
    let resolveFirst: ((value: IteratorResult<AiTextStreamEvent>) => void) | undefined;
    let returned = 0;
    const provider = createProvider({
      streamText() {
        return {
          [Symbol.asyncIterator]() {
            return {
              next: () => new Promise<IteratorResult<AiTextStreamEvent>>((resolve) => { resolveFirst = resolve; }),
              async return() {
                returned += 1;
                return { done: true, value: undefined };
              }
            };
          }
        };
      }
    });
    const harness = createAiHarness({ repository: createInMemoryAiRepository(), provider });
    const { events } = await harness.runTextStream(streamRunRequest());
    const iterator = events[Symbol.asyncIterator]();
    expect(() => events[Symbol.asyncIterator]()).toThrow("AI_STREAM_ALREADY_CONSUMED");
    const first = iterator.next();
    await expect(iterator.next()).rejects.toThrow("AI_STREAM_CONCURRENT_NEXT");
    resolveFirst?.({ done: false, value: { type: "done", text: "Final" } });
    await expect(first).resolves.toEqual({ done: false, value: { type: "done", text: "Final" } });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(returned).toBe(1);
  });

  it("fails safely when iterator acquisition throws", async () => {
    const repository = createInMemoryAiRepository();
    const harness = createAiHarness({
      repository,
      provider: createProvider({
        streamText() {
          return {
            [Symbol.asyncIterator]() {
              throw new Error("PRIVATE_ITERATOR_FAILURE");
            }
          };
        }
      })
    });
    const result = await harness.runTextStream(streamRunRequest());
    await expect(collect(result.events)).rejects.toThrow("PRIVATE_ITERATOR_FAILURE");
    await expect(repository.findRun("workspace_a", result.run.id, "profile_owner")).resolves.toMatchObject({
      status: "failed",
      validationErrors: ["AI_STREAM_FAILED"]
    });
  });

  it("rejects unauthorized and unsafe citations at the harness boundary", async () => {
    const createCitationHarness = (allowExternalResearch: boolean, url: string) => {
      const repository = createInMemoryAiRepository();
      const harness = createAiHarness({
        repository,
        citationResolver: async () => ["10.0.0.7"],
        provider: createMockAiProvider({
          streamEvents: [{ type: "citation", title: "Fonte", url, publishedAt: null }]
        })
      });
      return { repository, result: harness.runTextStream({ ...streamRunRequest(), allowExternalResearch }) };
    };

    const unauthorized = createCitationHarness(false, "https://example.com/fonte");
    const unauthorizedResult = await unauthorized.result;
    await expect(collect(unauthorizedResult.events)).rejects.toThrow("AI_STREAM_UNAUTHORIZED_CITATION");
    await expect(unauthorized.repository.findRun(
      "workspace_a", unauthorizedResult.run.id, "profile_owner"
    )).resolves.toMatchObject({ status: "failed" });

    const unsafe = createCitationHarness(true, "https://internal.example.com/private");
    const unsafeResult = await unsafe.result;
    await expect(collect(unsafeResult.events)).rejects.toThrow("AI_STREAM_CITATION_INVALID");
  });

  it("bounds citation metadata and accepts a normalized public citation", async () => {
    const runCitation = async (event: Extract<AiTextStreamEvent, { type: "citation" }>) => {
      const harness = createAiHarness({
        repository: createInMemoryAiRepository(),
        provider: createMockAiProvider({ streamEvents: [event] }),
        citationResolver: async () => ["93.184.216.34"]
      });
      const result = await harness.runTextStream({ ...streamRunRequest(), allowExternalResearch: true });
      return collect(result.events);
    };

    await expect(runCitation({
      type: "citation",
      title: "x".repeat(241),
      url: "https://example.com/fonte",
      publishedAt: null
    })).rejects.toThrow("AI_STREAM_CITATION_INVALID");
    await expect(runCitation({
      type: "citation",
      title: "Fonte",
      url: "https://example.com/fonte",
      publishedAt: "não-é-data"
    })).rejects.toThrow("AI_STREAM_CITATION_INVALID");
    await expect(runCitation({
      type: "citation",
      title: "  Fonte pública  ",
      url: "https://example.com/fonte",
      publishedAt: "2026-06-01"
    })).resolves.toEqual([{
      type: "citation",
      title: "Fonte pública",
      url: "https://example.com/fonte",
      publishedAt: "2026-06-01"
    }]);
  });

  it("handles cyclic private input and truncates non-private Unicode summaries safely", async () => {
    const cyclic: { self?: unknown; text?: string } = { text: "segredo absoluto" };
    cyclic.self = cyclic;
    const privateRepository = createInMemoryAiRepository();
    const privateHarness = createAiHarness({ repository: privateRepository, provider: createMockAiProvider() });
    const privateResult = await privateHarness.runTextStream({ ...streamRunRequest(), input: cyclic });
    await collect(privateResult.events);
    await expect(privateRepository.findRun(
      "workspace_a", privateResult.run.id, "profile_owner"
    )).resolves.toMatchObject({
      inputSummary: "[private owner studio input]",
      outputSummary: "[private owner studio output]"
    });

    const unicodeRepository = createInMemoryAiRepository();
    const unicodeText = "😀".repeat(200);
    const unicodeHarness = createAiHarness({
      repository: unicodeRepository,
      provider: createMockAiProvider({ streamEvents: [{ type: "done", text: unicodeText }] })
    });
    const unicodeResult = await unicodeHarness.runTextStream({
      ...streamRunRequest(),
      source: "create_with_ai",
      taskKind: "process_draft"
    });
    await collect(unicodeResult.events);
    const unicodeRun = await unicodeRepository.findRun("workspace_a", unicodeResult.run.id);
    expect(Array.from(unicodeRun?.outputSummary ?? "")).toHaveLength(160);
    expect(unicodeRun?.outputSummary).not.toContain("�");
  });

  it("returns one finite, consistently-sized embedding per input", async () => {
    const harness = createAiHarness({
      repository: createInMemoryAiRepository(),
      provider: createMockAiProvider({ embeddings: [[0.1, 0.2], [0.3, 0.4]] })
    });

    await expect(harness.createEmbeddings({
      model: "text-embedding-3-small",
      inputs: ["primeiro", "segundo"]
    })).resolves.toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it("rejects malformed embedding cardinality, dimensions, and non-finite values", async () => {
    const createHarness = (embeddings: number[][]) => createAiHarness({
      repository: createInMemoryAiRepository(),
      provider: createMockAiProvider({ embeddings })
    });
    const request = { model: "text-embedding-3-small", inputs: ["a", "b"] };

    await expect(createHarness([[0.1]]).createEmbeddings(request)).rejects.toThrow("AI_EMBEDDING_LENGTH_MISMATCH");
    await expect(createHarness([[0.1], [0.2, 0.3]]).createEmbeddings(request)).rejects.toThrow("AI_EMBEDDING_DIMENSION_MISMATCH");
    await expect(createHarness([[0.1], [Number.NaN]]).createEmbeddings(request)).rejects.toThrow("AI_EMBEDDING_NON_FINITE_VALUE");
    await expect(createHarness([[], []]).createEmbeddings(request)).rejects.toThrow("AI_EMBEDDING_EMPTY_VECTOR");
    await expect(createHarness([]).createEmbeddings({ model: " ", inputs: ["a"] })).rejects.toThrow("AI_EMBEDDING_MODEL_REQUIRED");
    await expect(createHarness([]).createEmbeddings({ model: "model", inputs: [] })).rejects.toThrow("AI_EMBEDDING_INPUTS_REQUIRED");
    await expect(createHarness([]).createEmbeddings({ model: "model", inputs: [" "] })).rejects.toThrow("AI_EMBEDDING_INPUT_INVALID");
  });
});

function streamRunRequest() {
  return {
    workspaceId: "workspace_a",
    actorProfileId: "profile_owner",
    source: "owner_studio" as const,
    inputMode: "text" as const,
    taskKind: "studio_assist" as const,
    agentKey: "owner_studio_companion",
    promptKey: "agent/process-architect",
    promptVersion: "1",
    model: "gpt-5.5",
    reasoningEffort: "medium" as const,
    input: { text: "Ajude a pensar." },
    allowExternalResearch: false
  };
}

async function collect(events: AsyncIterable<AiTextStreamEvent>) {
  const collected: AiTextStreamEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

function createProvider(overrides: Partial<AiProvider>): AiProvider {
  const fallback = createMockAiProvider();
  return { ...fallback, ...overrides };
}
