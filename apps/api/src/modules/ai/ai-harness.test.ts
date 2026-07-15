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

  it("propagates structured cancellation to the provider and audits failure exactly once", async () => {
    const baseRepository = createInMemoryAiRepository({ now: () => "2026-07-07T12:00:00.000Z" });
    const updateRun = vi.fn(baseRepository.updateRun);
    const repository = { ...baseRepository, updateRun };
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    let providerSettled = false;
    const provider = createProvider({
      generateStructured(request) {
        providerSignal = request.signal;
        return new Promise((_, reject) => request.signal?.addEventListener("abort", () => {
          providerSettled = true;
          reject(request.signal?.reason);
        }, { once: true }));
      },
      async transcribeAudio() { throw new Error("NOT_EXPECTED"); }
    });
    const harness = createAiHarness({ repository, provider });
    const pending = harness.runStructured({
      workspaceId: "workspace_a", actorProfileId: "profile_owner", source: "owner_studio",
      inputMode: "text", taskKind: "studio_organize", agentKey: "owner_studio_companion",
      promptKey: "agent/owner-studio-companion", promptVersion: "1", model: "gpt-5.5",
      reasoningEffort: "medium", input: {}, outputSchema: processDraftSchema, signal: controller.signal
    });

    await vi.waitFor(() => expect(providerSignal).toBe(controller.signal));
    controller.abort(new Error("cancel now"));
    await expect(pending).rejects.toThrow("cancel now");
    expect(providerSettled).toBe(true);
    expect(updateRun).toHaveBeenCalledTimes(1);
    expect(updateRun.mock.calls[0]?.[0]).toMatchObject({ status: "failed" });
    expect((await baseRepository.listRuns("workspace_a", "profile_owner"))[0]).toMatchObject({ status: "failed" });
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
    const observedSignals: AbortSignal[] = [];
    const fallbackProvider = createMockAiProvider();
    const signalProvider = createProvider({
      streamText(request) {
        observedSignals.push(request.signal!);
        return fallbackProvider.streamText(request);
      }
    });
    controller.abort(new Error("pre-aborted"));
    const abortedHarness = createAiHarness({
      repository: abortedRepository,
      provider: signalProvider,
      streamStartTimeoutMs: 1_000
    });
    const aborted = await abortedHarness.runTextStream({ ...streamRunRequest(), signal: controller.signal });
    await vi.waitFor(async () => {
      await expect(abortedRepository.findRun(
        "workspace_a", aborted.run.id, "profile_owner"
      )).resolves.toMatchObject({ status: "failed", validationErrors: ["AI_STREAM_FAILED"] });
    });
    expect(observedSignals[0]?.aborted).toBe(true);
    expect(observedSignals[0]).not.toBe(controller.signal);

    const idleRepository = createInMemoryAiRepository();
    const idleHarness = createAiHarness({
      repository: idleRepository,
      provider: signalProvider,
      streamStartTimeoutMs: 5
    });
    const idle = await idleHarness.runTextStream(streamRunRequest());
    await vi.waitFor(async () => {
      await expect(idleRepository.findRun(
        "workspace_a", idle.run.id, "profile_owner"
      )).resolves.toMatchObject({ status: "failed", validationErrors: ["AI_STREAM_FAILED"] });
    });
    expect(observedSignals[1]?.aborted).toBe(true);
  });

  it("bounds an idle provider pull and closes it without leaving the run active", async () => {
    const repository = createInMemoryAiRepository();
    let returned = 0;
    let pendingNext = 0;
    let providerSignal: AbortSignal | undefined;
    const provider = createProvider({
      streamText(request) {
        providerSignal = request.signal;
        return {
          [Symbol.asyncIterator]() {
            return {
              next: () => new Promise<IteratorResult<AiTextStreamEvent>>((_resolve, reject) => {
                pendingNext += 1;
                const abort = () => {
                  pendingNext -= 1;
                  reject(request.signal?.reason);
                };
                request.signal?.addEventListener("abort", abort, { once: true });
              }),
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
    expect(providerSignal?.aborted).toBe(true);
    expect(pendingNext).toBe(0);
  });

  it("aborts the provider and awaits terminal audit on consumer return", async () => {
    const repository = createInMemoryAiRepository();
    let providerSignal: AbortSignal | undefined;
    let pendingNext = 0;
    let returned = 0;
    const provider = createProvider({
      streamText(request) {
        providerSignal = request.signal;
        return {
          [Symbol.asyncIterator]() {
            return {
              next: () => new Promise<IteratorResult<AiTextStreamEvent>>((_resolve, reject) => {
                pendingNext += 1;
                request.signal?.addEventListener("abort", () => {
                  pendingNext -= 1;
                  reject(request.signal?.reason);
                }, { once: true });
              }),
              async return() {
                returned += 1;
                return { done: true, value: undefined };
              }
            };
          }
        };
      }
    });
    const harness = createAiHarness({ repository, provider });
    const result = await harness.runTextStream(streamRunRequest());
    const iterator = result.events[Symbol.asyncIterator]();
    const pending = iterator.next();
    const pendingSettled = pending.then((value) => value, (error) => error);
    const returnedResult = iterator.return!();

    await expect(returnedResult).resolves.toEqual({ done: true, value: undefined });
    await expect(pendingSettled).resolves.toBeDefined();
    expect(providerSignal?.aborted).toBe(true);
    expect(pendingNext).toBe(0);
    expect(returned).toBe(1);
    await expect(repository.findRun("workspace_a", result.run.id, "profile_owner")).resolves.toMatchObject({
      status: "failed"
    });
  });

  it("does not expose success, failure, or cancellation before terminal audit persistence", async () => {
    const runScenario = async (kind: "success" | "failure" | "cancel") => {
      const repository = createInMemoryAiRepository();
      const gate = deferred<void>();
      let updateStarted = false;
      let updates = 0;
      const provider = kind === "failure"
        ? createProvider({ async *streamText() { throw new Error("PROVIDER_FAILED"); } })
        : createMockAiProvider({ streamEvents: [{ type: "done", text: "Final" }] });
      const harness = createAiHarness({
        repository: {
          ...repository,
          async updateRun(run) {
            updates += 1;
            updateStarted = true;
            await gate.promise;
            return repository.updateRun(run);
          }
        },
        provider
      });
      const result = await harness.runTextStream(streamRunRequest());
      const iterator = result.events[Symbol.asyncIterator]();
      const terminal = kind === "cancel" ? iterator.return!() : iterator.next();
      await vi.waitFor(() => expect(updateStarted).toBe(true));
      let settled = false;
      void terminal.then(() => { settled = true; }, () => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      gate.resolve();
      if (kind === "failure") await expect(terminal).rejects.toThrow("PROVIDER_FAILED");
      else await expect(terminal).resolves.toBeDefined();
      expect(updates).toBe(1);
    };

    await runScenario("success");
    await runScenario("failure");
    await runScenario("cancel");
  });

  it("surfaces terminal audit persistence failure once without an unhandled retry", async () => {
    const repository = createInMemoryAiRepository();
    let updates = 0;
    const harness = createAiHarness({
      repository: {
        ...repository,
        async updateRun() {
          updates += 1;
          throw new Error("DATABASE_UNAVAILABLE");
        }
      },
      provider: createMockAiProvider({ streamEvents: [{ type: "done", text: "Final" }] })
    });
    const result = await harness.runTextStream(streamRunRequest());

    await expect(collect(result.events)).rejects.toThrow("AI_STREAM_AUDIT_PERSIST_FAILED");
    expect(updates).toBe(1);
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
    for (const publishedAt of [
      "2026-02-30",
      "2026-04-31",
      "2025-02-29",
      "2026-01-01T24:00:00Z",
      "2026-01-01T23:60:00Z",
      "2026-01-01T23:59:60Z",
      "2026-01-01T12:00:00+14:30"
    ]) {
      await expect(runCitation({
        type: "citation",
        title: "Fonte",
        url: "https://example.com/fonte",
        publishedAt
      })).rejects.toThrow("AI_STREAM_CITATION_INVALID");
    }
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
    await expect(runCitation({
      type: "citation",
      title: "Fonte bissexta",
      url: "https://example.com/bissexto",
      publishedAt: "2024-02-29T23:59:59.123Z"
    })).resolves.toHaveLength(1);
  });

  it("cancels citation DNS validation promptly and persists one terminal audit", async () => {
    const repository = createInMemoryAiRepository();
    const originalUpdate = repository.updateRun.bind(repository);
    let updates = 0;
    let resolverStarted = false;
    let resolverSignal: AbortSignal | undefined;
    const resolver = deferred<string[]>();
    const controller = new AbortController();
    const harness = createAiHarness({
      repository: {
        ...repository,
        async updateRun(run) {
          updates += 1;
          return originalUpdate(run);
        }
      },
      provider: createMockAiProvider({
        streamEvents: [{
          type: "citation", title: "Fonte", url: "https://example.com/fonte", publishedAt: null
        }]
      }),
      citationResolver: (_hostname, signal) => {
        resolverStarted = true;
        resolverSignal = signal;
        return resolver.promise;
      }
    });
    const result = await harness.runTextStream({
      ...streamRunRequest(), allowExternalResearch: true, signal: controller.signal
    });
    const iterator = result.events[Symbol.asyncIterator]();
    const next = iterator.next();
    await vi.waitFor(() => expect(resolverStarted).toBe(true));

    controller.abort(new Error("USER_CANCELLED"));
    await expect(withTestTimeout(next)).resolves.toEqual({ done: true, value: undefined });
    expect(resolverSignal?.aborted).toBe(true);
    expect(updates).toBe(1);
    await expect(repository.findRun(
      "workspace_a", result.run.id, "profile_owner"
    )).resolves.toMatchObject({ status: "failed" });
  });

  it("bounds a never-resolving citation DNS lookup and handles a late rejection", async () => {
    const repository = createInMemoryAiRepository();
    const originalUpdate = repository.updateRun.bind(repository);
    let updates = 0;
    const resolver = deferred<string[]>();
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      const harness = createAiHarness({
        repository: {
          ...repository,
          async updateRun(run) {
            updates += 1;
            return originalUpdate(run);
          }
        },
        provider: createMockAiProvider({
          streamEvents: [{
            type: "citation", title: "Fonte", url: "https://example.com/fonte", publishedAt: null
          }]
        }),
        citationResolver: () => resolver.promise,
        citationResolverTimeoutMs: 5
      });
      const result = await harness.runTextStream({ ...streamRunRequest(), allowExternalResearch: true });

      await expect(withTestTimeout(collect(result.events))).rejects.toThrow("AI_STREAM_CITATION_INVALID");
      expect(updates).toBe(1);
      resolver.reject(new Error("LATE_DNS_FAILURE"));
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });

  it("returns promptly while citation DNS validation is pending", async () => {
    const repository = createInMemoryAiRepository();
    const resolver = deferred<string[]>();
    let resolverStarted = false;
    let resolverSignal: AbortSignal | undefined;
    const harness = createAiHarness({
      repository,
      provider: createMockAiProvider({
        streamEvents: [{
          type: "citation", title: "Fonte", url: "https://example.com/fonte", publishedAt: null
        }]
      }),
      citationResolver: (_hostname, signal) => {
        resolverStarted = true;
        resolverSignal = signal;
        return resolver.promise;
      }
    });
    const result = await harness.runTextStream({ ...streamRunRequest(), allowExternalResearch: true });
    const iterator = result.events[Symbol.asyncIterator]();
    const next = iterator.next();
    await vi.waitFor(() => expect(resolverStarted).toBe(true));

    await expect(withTestTimeout(iterator.return!())).resolves.toEqual({ done: true, value: undefined });
    await expect(withTestTimeout(next)).resolves.toEqual({ done: true, value: undefined });
    expect(resolverSignal?.aborted).toBe(true);
    await expect(repository.findRun(
      "workspace_a", result.run.id, "profile_owner"
    )).resolves.toMatchObject({ status: "failed" });
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

    const family = "👨‍👩‍👧‍👦";
    const graphemeRepository = createInMemoryAiRepository();
    const graphemeHarness = createAiHarness({
      repository: graphemeRepository,
      provider: createMockAiProvider({
        streamEvents: [
          { type: "delta", text: "a".repeat(154) },
          { type: "delta", text: "👨‍" },
          { type: "delta", text: "👩‍👧‍👦" },
          { type: "delta", text: "👍" },
          { type: "delta", text: "🏽" },
          { type: "delta", text: "e" },
          { type: "delta", text: "\u0301" },
          { type: "delta", text: "x".repeat(10) }
        ]
      })
    });
    const graphemeResult = await graphemeHarness.runTextStream({
      ...streamRunRequest(), source: "create_with_ai", taskKind: "process_draft"
    });
    await collect(graphemeResult.events);
    await expect(graphemeRepository.findRun("workspace_a", graphemeResult.run.id)).resolves.toMatchObject({
      outputSummary: `${"a".repeat(154)}${family}👍🏽é...`
    });
  });

  it("bounds pathological summary graphemes by code points and UTF-8 bytes", async () => {
    const cases = [
      `e${"\u0301".repeat(1_000)}`,
      Array.from({ length: 400 }, () => "👩‍").join("") + "👩",
      `${"😀".repeat(159)}👍🏽tail`
    ];
    for (const text of cases) {
      const repository = createInMemoryAiRepository();
      const harness = createAiHarness({
        repository,
        provider: createMockAiProvider({ streamEvents: [{ type: "done", text }] })
      });
      const result = await harness.runTextStream({
        ...streamRunRequest(), source: "create_with_ai", taskKind: "process_draft"
      });
      await collect(result.events);
      const summary = (await repository.findRun("workspace_a", result.run.id))?.outputSummary ?? "";
      const graphemeCount = Array.from(
        new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(summary)
      ).length;
      expect(graphemeCount).toBeLessThanOrEqual(160);
      expect(Array.from(summary).length).toBeLessThanOrEqual(640);
      expect(Buffer.byteLength(summary, "utf8")).toBeLessThanOrEqual(1_024);
      expect(summary).not.toContain("�");
    }

    const privateRepository = createInMemoryAiRepository();
    const privateHarness = createAiHarness({
      repository: privateRepository,
      provider: createMockAiProvider({ streamEvents: [{ type: "done", text: cases[0]! }] })
    });
    const privateResult = await privateHarness.runTextStream(streamRunRequest());
    await collect(privateResult.events);
    await expect(privateRepository.findRun(
      "workspace_a", privateResult.run.id, "profile_owner"
    )).resolves.toMatchObject({
      inputSummary: "[private owner studio input]",
      outputSummary: "[private owner studio output]"
    });
  });

  it("returns one finite, consistently-sized embedding per input", async () => {
    const harness = createAiHarness({
      repository: createInMemoryAiRepository(),
      provider: createMockAiProvider({ embeddings: [[0.1, 0.2], [0.3, 0.4]] })
    });

    await expect(harness.createEmbeddings({
      model: "text-embedding-3-small",
      inputs: ["primeiro", "segundo"],
      dimensions: 1_536
    })).resolves.toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it("rejects malformed embedding cardinality, dimensions, and non-finite values", async () => {
    const createHarness = (embeddings: number[][]) => createAiHarness({
      repository: createInMemoryAiRepository(),
      provider: createMockAiProvider({ embeddings })
    });
    const request = { model: "text-embedding-3-small", inputs: ["a", "b"], dimensions: 1_536 };

    await expect(createHarness([[0.1]]).createEmbeddings(request)).rejects.toThrow("AI_EMBEDDING_LENGTH_MISMATCH");
    await expect(createHarness([[0.1], [0.2, 0.3]]).createEmbeddings(request)).rejects.toThrow("AI_EMBEDDING_DIMENSION_MISMATCH");
    await expect(createHarness([[0.1], [Number.NaN]]).createEmbeddings(request)).rejects.toThrow("AI_EMBEDDING_NON_FINITE_VALUE");
    await expect(createHarness([[], []]).createEmbeddings(request)).rejects.toThrow("AI_EMBEDDING_EMPTY_VECTOR");
    await expect(createHarness([]).createEmbeddings({ model: " ", inputs: ["a"], dimensions: 1_536 })).rejects.toThrow("AI_EMBEDDING_MODEL_REQUIRED");
    await expect(createHarness([]).createEmbeddings({ model: "model", inputs: [], dimensions: 1_536 })).rejects.toThrow("AI_EMBEDDING_INPUTS_REQUIRED");
    await expect(createHarness([]).createEmbeddings({ model: "model", inputs: [" "], dimensions: 1_536 })).rejects.toThrow("AI_EMBEDDING_INPUT_INVALID");
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function withTestTimeout<T>(promise: Promise<T>, timeoutMs = 100) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("TEST_TIMEOUT")), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
