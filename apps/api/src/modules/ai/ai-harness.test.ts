import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAiHarness } from "./ai-harness";
import type { AiProvider, AiStructuredProviderRequest } from "./ai.types";
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
    const provider: AiProvider = {
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
    };
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
});
