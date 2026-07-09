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
});

describe("OpenAI provider", () => {
  it("builds a Responses API request with prompt, reasoning effort and structured output schema", async () => {
    const calls: unknown[] = [];
    const provider = createOpenAiProvider({
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
});

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
              transcribeFile: async (source: unknown, options: unknown) => {
                calls.push({ source, options });
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
      audioBuffer: Buffer.from("browser-audio"),
      mimeType: "audio/webm",
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
      }
    });
  });
});
