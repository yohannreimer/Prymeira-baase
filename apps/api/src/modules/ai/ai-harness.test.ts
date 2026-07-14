import { describe, expect, it } from "vitest";
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

  it("audits a successful text stream and stores only its bounded final summary", async () => {
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

    const [run] = await repository.listRuns("workspace_a");
    expect(run).toMatchObject({
      source: "owner_studio",
      taskKind: "studio_assist",
      status: "completed",
      validationErrors: []
    });
    expect(run?.outputSummary).toHaveLength(160);
    expect(run?.outputSummary?.endsWith("...")).toBe(true);
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

    const [run] = await repository.listRuns("workspace_a");
    expect(run).toMatchObject({ status: "failed", validationErrors: ["PROVIDER_STREAM_FAILED"] });
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
    await expect(repository.listRuns("workspace_a")).resolves.toEqual([
      expect.objectContaining({ status: "failed", validationErrors: ["PROVIDER_START_FAILED"] })
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

    const [run] = await repository.listRuns("workspace_a");
    expect(providerClosed).toBe(true);
    expect(run).toMatchObject({ status: "failed", validationErrors: ["AI_STREAM_CANCELLED"] });
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
    await expect(duplicateRepository.listRuns("workspace_a")).resolves.toEqual([
      expect.objectContaining({ status: "completed", outputSummary: "Oi" })
    ]);
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
