import { describe, expect, it } from "vitest";
import { createDeepgramProvider } from "./providers/deepgram.provider";
import { createMockAiProvider } from "./providers/mock-ai.provider";
import { createOpenAiProvider } from "./providers/openai.provider";
import {
  announcementDraftSchema,
  onboardingSetupSuggestionSchema,
  processDraftSchema,
  routineDraftSchema,
  trainingDraftSchema
} from "./schema-registry";

describe("Mock AI provider", () => {
  it("returns schema-valid default outputs for demo mode structured drafts", async () => {
    const provider = createMockAiProvider();

    expect(onboardingSetupSuggestionSchema.parse(await provider.generateStructured({
      taskKind: "onboarding_setup",
      agentKey: "onboarding_architect",
      promptKey: "agent/onboarding-architect",
      promptVersion: "1",
      model: "mock",
      reasoningEffort: "medium",
      input: { segment: "Agência de marketing", answers: [] },
      schemaName: "onboarding_setup_suggestion"
    })).areas[0]!.name).toBe("Operações");

    expect(processDraftSchema.parse(await provider.generateStructured({
      taskKind: "process_draft",
      agentKey: "process_architect",
      promptKey: "agent/process-architect",
      promptVersion: "1",
      model: "mock",
      reasoningEffort: "medium",
      input: { text: "Criar processo de aprovação de peças" },
      schemaName: "process_draft"
    })).steps).toHaveLength(4);

    expect(routineDraftSchema.parse(await provider.generateStructured({
      taskKind: "routine_draft",
      agentKey: "routine_architect",
      promptKey: "agent/routine-architect",
      promptVersion: "1",
      model: "mock",
      reasoningEffort: "medium",
      input: { text: "Criar rotina de fechamento financeiro" },
      schemaName: "routine_draft"
    })).tasks).toHaveLength(4);

    expect(trainingDraftSchema.parse(await provider.generateStructured({
      taskKind: "training_draft",
      agentKey: "training_architect",
      promptKey: "agent/training-architect",
      promptVersion: "1",
      model: "mock",
      reasoningEffort: "medium",
      input: { text: "Treinar equipe em evidências" },
      schemaName: "training_draft"
    })).quiz).toHaveLength(2);

    expect(announcementDraftSchema.parse(await provider.generateStructured({
      taskKind: "announcement_draft",
      agentKey: "announcement_architect",
      promptKey: "agent/announcement-architect",
      promptVersion: "1",
      model: "mock",
      reasoningEffort: "medium",
      input: { text: "Avisar equipe sobre novo padrão de evidência" },
      schemaName: "announcement_draft"
    })).requirement).toBe("read_confirmation");
  });

  it("returns a useful demo transcript when Deepgram is not configured", async () => {
    const provider = createMockAiProvider();

    const transcript = await provider.transcribeAudio({
      audioBuffer: Buffer.from("browser audio"),
      mimeType: "audio/webm",
      language: "pt-BR",
      keyterms: ["SOP"]
    });

    expect(transcript.text).toContain("processo");
    expect(transcript.durationSeconds).toBeGreaterThan(0);
  });

  it("streams deterministic text and only cites research when explicitly allowed", async () => {
    const provider = createMockAiProvider();
    const denied = await collect(provider.streamText(textRequest(false)));
    const allowed = await collect(provider.streamText(textRequest(true)));

    expect(denied.some((event) => event.type === "citation")).toBe(false);
    expect(denied.at(-1)).toMatchObject({ type: "done" });
    expect(allowed).toContainEqual({
      type: "citation",
      title: "Fonte pública de demonstração",
      url: "https://example.com/pesquisa",
      publishedAt: null
    });
  });

  it("returns deterministic embeddings in input order", async () => {
    const provider = createMockAiProvider();
    const first = await provider.createEmbeddings({ model: "mock-embedding", inputs: ["um", "dois"] });
    const second = await provider.createEmbeddings({ model: "mock-embedding", inputs: ["um", "dois"] });

    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first[0]).toHaveLength(first[1]!.length);
  });
});

describe("OpenAI provider", () => {
  it("builds a Responses API request with prompt, reasoning effort and structured output schema", async () => {
    const calls: unknown[] = [];
    const provider = createOpenAiProvider({
      citationResolver: async () => ["93.184.216.34"],
      client: {
        responses: {
          create: async (payload: unknown) => {
            calls.push(payload);
            return {
              id: "resp_123",
              output_text: JSON.stringify({ title: "Onboarding de cliente novo" })
            };
          }
        }
      }
    });

    const output = await provider.generateStructured({
      taskKind: "process_draft",
      agentKey: "process_architect",
      promptKey: "agent/process-architect",
      promptVersion: "1",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      input: { text: "Explique o onboarding de cliente novo." },
      schemaName: "process_draft",
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: { title: { type: "string" } },
        required: ["title"]
      }
    });

    expect(output).toEqual({ title: "Onboarding de cliente novo" });
    expect(calls[0]).toMatchObject({
      model: "gpt-5.5",
      reasoning: { effort: "medium" },
      text: {
        format: {
          type: "json_schema",
          name: "process_draft",
          strict: true
        }
      }
    });
    expect(JSON.stringify(calls[0])).toContain("arquiteto operacional");
    expect(JSON.stringify(calls[0])).toContain("Explique o onboarding de cliente novo.");
  });

  it("does not add web search without explicit consent and maps streamed annotations to citations", async () => {
    const calls: unknown[] = [];
    const streams = [
      asyncEvents([
        { type: "response.output_text.delta", delta: "Sem pesquisa" },
        { type: "response.output_text.done", text: "Sem pesquisa" },
        { type: "response.completed" }
      ]),
      asyncEvents([
        { type: "response.output_text.delta", delta: "Com fonte" },
        {
          type: "response.output_text.annotation.added",
          annotation: {
            type: "url_citation",
            title: "Relatório público",
            url: "https://example.com/relatorio",
            published_at: "2026-06-01"
          }
        },
        { type: "response.output_text.done", text: "Com fonte" },
        { type: "response.completed" }
      ])
    ];
    const provider = createOpenAiProvider({
      citationResolver: async () => ["93.184.216.34"],
      client: {
        responses: {
          create: async (payload: unknown) => {
            calls.push(payload);
            return streams.shift()!;
          }
        },
        embeddings: {
          create: async () => ({ data: [] })
        }
      }
    });

    expect(await collect(provider.streamText(textRequest(false)))).toEqual([
      { type: "delta", text: "Sem pesquisa" },
      { type: "done", text: "Sem pesquisa" }
    ]);
    expect(await collect(provider.streamText(textRequest(true)))).toEqual([
      { type: "delta", text: "Com fonte" },
      {
        type: "citation",
        title: "Relatório público",
        url: "https://example.com/relatorio",
        publishedAt: "2026-06-01"
      },
      { type: "done", text: "Com fonte" }
    ]);
    expect(calls[0]).not.toHaveProperty("tools");
    expect(calls[1]).toMatchObject({ tools: [{ type: "web_search" }] });
  });

  it("orders embeddings by provider index", async () => {
    const calls: unknown[] = [];
    const provider = createOpenAiProvider({
      client: {
        responses: {
          create: async () => ({ output_text: "{}" })
        },
        embeddings: {
          create: async (payload: unknown) => {
            calls.push(payload);
            return {
              data: [
                { index: 1, embedding: [0.3, 0.4] },
                { index: 0, embedding: [0.1, 0.2] }
              ]
            };
          }
        }
      }
    });

    await expect(provider.createEmbeddings({
      model: "text-embedding-3-small",
      inputs: ["um", "dois"]
    })).resolves.toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(calls).toEqual([{ model: "text-embedding-3-small", input: ["um", "dois"] }]);
  });

  it("rejects provider citations without consent or with an unsafe URL", async () => {
    const streams = [
      asyncEvents([{
        type: "response.output_text.annotation.added",
        annotation: { type: "url_citation", title: "Fonte", url: "https://example.com/fonte" }
      }]),
      asyncEvents([{
        type: "response.output_text.annotation.added",
        annotation: { type: "url_citation", title: "Fonte", url: "https://internal.example.com/admin" }
      }])
    ];
    const provider = createOpenAiProvider({
      citationResolver: async () => ["10.0.0.7"],
      client: {
        responses: { create: async () => streams.shift()! },
        embeddings: { create: async () => ({ data: [] }) }
      }
    });

    await expect(collect(provider.streamText(textRequest(false))))
      .rejects.toThrow("AI_STREAM_UNAUTHORIZED_CITATION");
    await expect(collect(provider.streamText(textRequest(true))))
      .rejects.toThrow("AI_STREAM_CITATION_INVALID");
  });

  it("rejects duplicate, missing, and out-of-range embedding indices", async () => {
    const responses = [
      { data: [{ index: 0, embedding: [0.1] }, { index: 0, embedding: [0.2] }] },
      { data: [{ index: 1, embedding: [0.1] }] },
      { data: [{ index: 0, embedding: [0.1] }, { index: 2, embedding: [0.2] }] }
    ];
    const provider = createOpenAiProvider({
      client: {
        responses: { create: async () => ({ output_text: "{}" }) },
        embeddings: { create: async () => responses.shift()! }
      }
    });
    const request = { model: "text-embedding-3-small", inputs: ["um", "dois"] };

    await expect(provider.createEmbeddings(request)).rejects.toThrow("OPENAI_EMBEDDING_INDEX_MISMATCH");
    await expect(provider.createEmbeddings(request)).rejects.toThrow("OPENAI_EMBEDDING_INDEX_MISMATCH");
    await expect(provider.createEmbeddings(request)).rejects.toThrow("OPENAI_EMBEDDING_INDEX_MISMATCH");
  });
});

function textRequest(allowExternalResearch: boolean) {
  return {
    taskKind: "studio_assist" as const,
    agentKey: "owner_studio_companion",
    promptKey: "agent/process-architect",
    promptVersion: "1",
    model: "gpt-5.5",
    reasoningEffort: "medium" as const,
    input: { text: "Ajude a pensar." },
    allowExternalResearch
  };
}

async function collect<T>(events: AsyncIterable<T>) {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

async function* asyncEvents(events: unknown[]) {
  yield* events;
}

describe("Deepgram provider", () => {
  it("transcribes an audio URL with Nova-3 options and normalizes transcript metadata", async () => {
    const calls: unknown[] = [];
    const provider = createDeepgramProvider({
      client: {
        listen: {
          v1: {
            media: {
              transcribeUrl: async (request: unknown) => {
                calls.push({ request });
                return {
                  result: {
                    metadata: { duration: 42 },
                    results: {
                      channels: [{
                        alternatives: [{
                          transcript: "Todo dia a atendente responde mensagens pendentes.",
                          confidence: 0.97,
                          words: [{
                            word: "Todo",
                            start: 0,
                            end: 0.3,
                            confidence: 0.99,
                            speaker: 0
                          }]
                        }]
                      }]
                    }
                  }
                };
              }
            }
          }
        }
      }
    });

    const transcript = await provider.transcribeAudio({
      audioUrl: "https://storage.baase.local/audio.wav",
      language: "pt-BR",
      keyterms: ["Baase", "WhatsApp", "Atendimento"]
    });

    expect(transcript).toEqual({
      text: "Todo dia a atendente responde mensagens pendentes.",
      confidence: 0.97,
      durationSeconds: 42,
      words: [{
        word: "Todo",
        start: 0,
        end: 0.3,
        confidence: 0.99,
        speaker: 0
      }]
    });
    expect(calls[0]).toEqual({
      request: {
        url: "https://storage.baase.local/audio.wav",
        model: "nova-3",
        language: "pt-BR",
        smart_format: true,
        utterances: true,
        diarize_model: "latest",
        keyterm: ["Baase", "WhatsApp", "Atendimento"]
      }
    });
  });

  it("transcribes an audio buffer with Nova-3 options", async () => {
    const calls: unknown[] = [];
    const provider = createDeepgramProvider({
      client: {
        listen: {
          v1: {
            media: {
              transcribeFile: async (source: unknown, options: unknown, requestOptions: unknown) => {
                calls.push({ source, options, requestOptions });
                return {
                  result: {
                    metadata: { duration: 42 },
                    results: {
                      channels: [{
                        alternatives: [{
                          transcript: "Todo dia a atendente responde mensagens pendentes.",
                          confidence: 0.97,
                          words: [{
                            word: "Todo",
                            start: 0,
                            end: 0.3,
                            confidence: 0.99,
                            speaker: 0
                          }]
                        }]
                      }]
                    }
                  }
                };
              }
            }
          }
        }
      }
    });

    const controller = new AbortController();
    const transcript = await provider.transcribeAudio({
      audioBuffer: Buffer.from("browser-audio"),
      mimeType: "audio/webm",
      language: "pt-BR",
      keyterms: ["Baase", "WhatsApp", "Atendimento"],
      signal: controller.signal
    });

    expect(transcript).toEqual({
      text: "Todo dia a atendente responde mensagens pendentes.",
      confidence: 0.97,
      durationSeconds: 42,
      words: [{
        word: "Todo",
        start: 0,
        end: 0.3,
        confidence: 0.99,
        speaker: 0
      }]
    });
    expect(calls[0]).toEqual({
      source: {
        data: Buffer.from("browser-audio"),
        filename: "recording.webm",
        contentType: "audio/webm",
        contentLength: Buffer.byteLength("browser-audio")
      },
      options: {
        model: "nova-3",
        language: "pt-BR",
        smart_format: true,
        utterances: true,
        diarize_model: "latest",
        keyterm: ["Baase", "WhatsApp", "Atendimento"]
      },
      requestOptions: { abortSignal: controller.signal }
    });
  });
});
