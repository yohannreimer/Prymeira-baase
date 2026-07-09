import type { FastifyInstance } from "fastify";
import { z, type ZodType } from "zod";
import { canEditCompanyBase } from "@prymeira/baase-shared";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext } from "../../http/auth-context";
import { createAiHarness } from "./ai-harness";
import type { AiProvider, AiRepository, AiRunSource, AiTaskKind } from "./ai.types";
import { getPromptDefinition } from "./prompt-registry";
import { buildProactiveSuggestions, type ProactiveSuggestionContext } from "./proactive-suggestions";
import {
  announcementDraftSchema,
  getAiSchema,
  onboardingSetupSuggestionSchema,
  processDraftSchema,
  routineDraftSchema,
  trainingDraftSchema
} from "./schema-registry";

const draftAttachmentSchema = z.object({
  name: z.string().min(1).max(180),
  mime_type: z.string().min(1).max(120),
  content_base64: z.string().min(1).max(16_000_000)
});

const audioBase64MaxLength = 32_000_000;

const createDraftSchema = z.object({
  type: z.enum(["onboarding", "process", "routine", "training", "announcement"]),
  input_mode: z.enum(["text", "audio", "pdf", "mixed"]).default("text"),
  input: z.string().min(1),
  context: z.record(z.string(), z.unknown()).optional().default({}),
  attachments: z.array(draftAttachmentSchema).max(5).optional().default([])
});

const transcribeSchema = z.object({
  source: z.enum(["onboarding", "create_with_ai", "process", "routine", "training"]).default("create_with_ai"),
  audio_url: z.string().url().optional(),
  audio_base64: z.string().min(1).max(audioBase64MaxLength).optional(),
  mime_type: z.string().min(1).max(120).optional().nullable(),
  language: z.string().optional().nullable(),
  keyterms: z.array(z.string().min(1)).optional().default([])
}).refine((body) => Boolean(body.audio_url || body.audio_base64), {
  message: "Informe audio_url ou audio_base64.",
  path: ["audio_url"]
});

const onboardingSuggestionSchema = z.object({
  segment: z.string().min(1).max(120),
  answers: z.array(z.object({
    question: z.string().min(1),
    answer: z.string().min(1),
    input_mode: z.enum(["text", "audio"]).default("text")
  })).min(1),
  context: z.record(z.string(), z.unknown()).optional().default({})
});

type DraftConfig = {
  taskKind: AiTaskKind;
  agentKey: string;
  promptKey: string;
  schemaKey: "onboarding_setup_suggestion" | "process_draft" | "routine_draft" | "training_draft" | "announcement_draft";
};

const draftConfigByType: Record<z.infer<typeof createDraftSchema>["type"], DraftConfig> = {
  onboarding: {
    taskKind: "onboarding_setup",
    agentKey: "onboarding_architect",
    promptKey: "agent/onboarding-architect",
    schemaKey: "onboarding_setup_suggestion"
  },
  process: {
    taskKind: "process_draft",
    agentKey: "process_architect",
    promptKey: "agent/process-architect",
    schemaKey: "process_draft"
  },
  routine: {
    taskKind: "routine_draft",
    agentKey: "routine_architect",
    promptKey: "agent/routine-architect",
    schemaKey: "routine_draft"
  },
  training: {
    taskKind: "training_draft",
    agentKey: "training_architect",
    promptKey: "agent/training-architect",
    schemaKey: "training_draft"
  },
  announcement: {
    taskKind: "announcement_draft",
    agentKey: "announcement_architect",
    promptKey: "agent/announcement-architect",
    schemaKey: "announcement_draft"
  }
};

export async function registerAiRoutes(
  app: FastifyInstance,
  repository: AiRepository,
  provider: AiProvider,
  proactiveContext?: ProactiveSuggestionContext
) {
  const harness = createAiHarness({ repository, provider });

  app.get("/ai/runs", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const runs = await repository.listRuns(context.workspaceId);
    return { runs };
  });

  app.post("/ai/drafts", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const body = createDraftSchema.parse(request.body);
    const config = draftConfigByType[body.type];
    const prompt = getPromptDefinition(config.promptKey, "1");
    const schema = readDraftSchema(config.schemaKey);
    const attachments = await extractDraftAttachments(body.attachments);
    const result = await harness.runStructured({
      workspaceId: context.workspaceId,
      actorProfileId: context.profileId,
      source: "create_with_ai",
      inputMode: body.input_mode,
      taskKind: config.taskKind,
      agentKey: config.agentKey,
      promptKey: prompt.key,
      promptVersion: prompt.version,
      model: "gpt-5.5",
      reasoningEffort: "medium",
      input: {
        text: body.input,
        attachments,
        context: body.context
      },
      outputSchema: schema,
      schemaName: config.schemaKey
    });

    return reply.status(201).send({
      draft: {
        id: `draft_${result.run.id}`,
        ai_run_id: result.run.id,
        type: body.type,
        status: "ready_for_review",
        content: result.output
      }
    });
  });

  app.get("/ai/proactive-suggestions", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const suggestions = proactiveContext
      ? await buildProactiveSuggestions(context.workspaceId, proactiveContext)
      : [];

    return {
      suggestions
    };
  });

  app.post("/ai/onboarding/suggestions", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const body = onboardingSuggestionSchema.parse(request.body);
    const prompt = getPromptDefinition("agent/onboarding-architect", "1");
    const result = await harness.runStructured({
      workspaceId: context.workspaceId,
      actorProfileId: context.profileId,
      source: "onboarding",
      inputMode: body.answers.some((answer) => answer.input_mode === "audio") ? "mixed" : "text",
      taskKind: "onboarding_setup",
      agentKey: "onboarding_architect",
      promptKey: prompt.key,
      promptVersion: prompt.version,
      model: "gpt-5.5",
      reasoningEffort: "medium",
      input: {
        segment: body.segment,
        answers: body.answers,
        context: body.context
      },
      outputSchema: onboardingSetupSuggestionSchema,
      schemaName: "onboarding_setup_suggestion"
    });

    return reply.status(201).send({
      suggestion: result.output,
      ai_run: result.run
    });
  });

  app.post("/ai/transcriptions", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const body = transcribeSchema.parse(request.body);
    const transcript = await harness.transcribeAudio({
      workspaceId: context.workspaceId,
      actorProfileId: context.profileId,
      source: body.source as AiRunSource,
      audioUrl: body.audio_url,
      audioBuffer: body.audio_base64 ? decodeAudioBase64(body.audio_base64) : undefined,
      mimeType: body.mime_type,
      language: body.language,
      keyterms: body.keyterms
    });

    return reply.status(201).send({
      transcript: {
        text: transcript.text,
        confidence: transcript.confidence,
        duration_seconds: transcript.durationSeconds,
        words: transcript.words
      }
    });
  });
}

function decodeAudioBase64(input: string) {
  const base64 = input.includes(",") ? input.slice(input.indexOf(",") + 1) : input;
  return Buffer.from(base64, "base64");
}

type DraftAttachmentInput = z.infer<typeof draftAttachmentSchema>;

async function extractDraftAttachments(attachments: DraftAttachmentInput[]) {
  return Promise.all(attachments.map(async (attachment) => {
    const buffer = decodeAudioBase64(attachment.content_base64);
    const mimeType = attachment.mime_type.toLowerCase();
    const name = attachment.name;
    const text = isPdfAttachment(name, mimeType)
      ? await extractPdfText(buffer, name)
      : isTextAttachment(name, mimeType)
        ? buffer.toString("utf8")
        : "";
    const trimmedText = text.trim();

    if (!trimmedText) {
      throw new ApiError(400, "AI_ATTACHMENT_INVALID", `Não foi possível extrair texto de ${name}.`, {
        name,
        mime_type: attachment.mime_type
      });
    }

    return {
      name,
      mimeType: attachment.mime_type,
      text: trimmedText.slice(0, 80_000)
    };
  }));
}

function isTextAttachment(name: string, mimeType: string) {
  const lowerName = name.toLowerCase();
  return mimeType.startsWith("text/") || lowerName.endsWith(".txt") || lowerName.endsWith(".md");
}

function isPdfAttachment(name: string, mimeType: string) {
  return mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}

async function extractPdfText(buffer: Buffer, name: string) {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text ?? "";
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    throw new ApiError(400, "AI_ATTACHMENT_INVALID", `Não foi possível ler o PDF ${name}.`, {
      name,
      reason: error instanceof Error ? error.message : "PDF_PARSE_FAILED"
    });
  }
}

function readDraftSchema(key: DraftConfig["schemaKey"]): ZodType<unknown> {
  if (key === "onboarding_setup_suggestion") return onboardingSetupSuggestionSchema;
  if (key === "process_draft") return processDraftSchema;
  if (key === "routine_draft") return routineDraftSchema;
  if (key === "training_draft") return trainingDraftSchema;
  if (key === "announcement_draft") return announcementDraftSchema;
  return getAiSchema(key);
}
