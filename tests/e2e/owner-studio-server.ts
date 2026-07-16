import type { AiProvider, AiStructuredProviderRequest } from "../../apps/api/src/modules/ai/ai.types";
import { buildApp } from "../../apps/api/src/app";
import { readRuntimeConfig } from "../../apps/api/src/config/runtime";
import { createInMemoryCompanyRepository } from "../../apps/api/src/modules/company/in-memory-company.repository";
import { startStudioAssetMaintenance } from "../../apps/api/src/modules/studio/studio-asset-maintenance-runner";
import { createInMemoryObjectStorage } from "../../apps/api/src/storage/in-memory-object-storage";

const host = "127.0.0.1";
const port = 3090;
const runtimeConfig = readRuntimeConfig({
  BAASE_RUNTIME_MODE: "demo",
  BAASE_AUTH_MODE: "local",
  BAASE_SEED_DEMO_DATA: "true",
  BAASE_STUDIO_ENABLED: "true",
  BAASE_STUDIO_VECTOR_ENABLED: "true"
});
const memoryObjectStorage = createInMemoryObjectStorage();
const objectStorage = {
  ...memoryObjectStorage,
  async createDownloadUrl(key: string) {
    const object = await memoryObjectStorage.get(key);
    const chunks: Buffer[] = [];
    for await (const chunk of object.body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return `data:${object.contentType ?? "application/octet-stream"};base64,${Buffer.concat(chunks).toString("base64")}`;
  }
};
await objectStorage.ensureReady();
const companyRepository = createE2eCompanyRepository();

const app = buildApp({
  aiProvider: deterministicStudioProvider(),
  companyRepository,
  objectStorage,
  runtimeConfig,
  seedDemoData: true,
  studioMemoryDimensions: 4,
  studioVectorPersistent: true
});
const maintenance = startStudioAssetMaintenance(app, {
  intervalMs: 40,
  jitterRatio: 0,
  maxItemsPerProcessor: 20,
  perItemTimeoutMs: 5_000,
  scavengeIntervalMs: 60_000
});

async function shutdown() {
  await maintenance.stop();
  await app.close();
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

await app.listen({ host, port });

function createE2eCompanyRepository() {
  const repository = createInMemoryCompanyRepository({ now: () => "2026-07-14T12:00:00.000Z" });
  repository.commitLifecycleState?.({
    areas: [{
      id: "Criacao", workspaceId: "workspace_a", name: "Criação", description: null,
      sortOrder: 1, archivedAt: null, createdAt: "2026-07-01T09:00:00.000Z", updatedAt: "2026-07-01T09:00:00.000Z"
    }],
    roleTemplates: [],
    teamMembers: [
      member("profile_owner", "Marina Alves", "owner", null),
      member("profile_owner_b", "Outro dono", "owner", null),
      member("profile_manager", "Gestora E2E", "manager", "Criacao"),
      member("profile_employee", "Pessoa E2E", "employee", "Criacao")
    ],
    invites: []
  });
  return repository;
}

function member(
  id: string,
  name: string,
  role: "owner" | "manager" | "employee",
  areaId: string | null
) {
  return {
    id,
    workspaceId: "workspace_a",
    name,
    email: `${id}@example.invalid`,
    role,
    areaId,
    areaAccessIds: areaId ? [areaId] : [],
    roleTemplateId: null,
    accessScope: role === "owner" ? "workspace" as const : role === "manager" ? "area" as const : "assigned_only" as const,
    clerkUserId: null,
    customerId: null,
    status: "active" as const,
    createdByProfileId: "profile_owner",
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-01T09:00:00.000Z"
  };
}

function deterministicStudioProvider(): AiProvider {
  return {
    async generateStructured(request) {
      if (request.schemaName === "studio_text_suggestion") return textSuggestion(request);
      if (request.taskKind === "studio_ritual_prepare") {
        if (JSON.stringify(request.input).includes("E2E_SLOW_PREPARATION")) {
          await new Promise((resolve) => setTimeout(resolve, 1_500));
        }
        return ritualPreparation(request);
      }
      if (request.taskKind === "studio_synthesize") {
        return {
          summary: "A revisão tornou a decisão explícita sem publicar nada na operação.",
          decisions: ["Revisar a capacidade toda segunda-feira."],
          open_questions: ["Qual sinal indicará necessidade de ajuste?"],
          suggested_next_steps: ["Registrar a decisão como proposta revisável."]
        };
      }
      return {};
    },

    async *streamText(request) {
      const input = JSON.stringify(request.input);
      if (input.includes("E2E_PROVIDER_OUTAGE")) throw new Error("E2E_PROVIDER_UNAVAILABLE");
      const text = request.allowExternalResearch
        ? "A pesquisa externa foi executada somente para esta pergunta e permanece separada da operação."
        : "Organizei a leitura em fatos, inferências e próximos pontos para sua decisão.";
      yield { type: "delta", text: text.slice(0, Math.ceil(text.length / 2)) };
      yield { type: "delta", text: text.slice(Math.ceil(text.length / 2)) };
      if (request.allowExternalResearch) {
        yield {
          type: "citation",
          title: "Fonte pública determinística",
          url: "https://example.com/owner-studio-e2e",
          publishedAt: "2026-07-01"
        };
      }
      yield { type: "done", text };
    },

    async createEmbeddings(request) {
      return request.inputs.map((input) => deterministicEmbedding(input));
    },

    async transcribeAudio() {
      return {
        text: "Transcrição determinística: preservar a fala original e organizar a próxima revisão.",
        confidence: 0.99,
        durationSeconds: 1
      };
    }
  };
}

function textSuggestion(request: AiStructuredProviderRequest) {
  const input = asRecord(request.input);
  const document = asRecord(input.document);
  const id = String(document.id ?? "");
  const revision = Number(document.revision ?? 1);
  const original = String(document.body_text ?? "");
  return {
    facts: [],
    inferences: [{
      statement: "O pensamento pode ganhar uma meta revisável.",
      basis: "Estrutura solicitada explicitamente pelo dono.",
      confidence: "high"
    }],
    gaps: [{
      question: "Qual resultado mostrará avanço?",
      reason: "A definição continua sob decisão do dono."
    }],
    citations: [],
    proposal: {
      document_id: id,
      expected_revision: revision,
      title: "Meta revisável para o próximo ciclo",
      body_json: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: `Meta proposta: ${original}` }] }]
      },
      body_text: `Meta proposta: ${original}`
    }
  };
}

function ritualPreparation(request: AiStructuredProviderRequest) {
  const ritual = asRecord(asRecord(request.input).ritual);
  const guideQuestions = Array.isArray(ritual.guideQuestions)
    ? ritual.guideQuestions.map(String)
    : ["O que mudou?", "Qual decisão precisa permanecer explícita?"];
  return {
    facts: [],
    inferences: [],
    gaps: [],
    citations: [],
    proposal: {
      ritual_id: String(ritual.id ?? ""),
      title: "Revisão semanal preparada",
      intent: String(ritual.intention ?? "Revisar decisões e próximos passos."),
      agenda: guideQuestions.map((prompt) => ({ prompt, purpose: "Preservar o contexto antes de decidir." })),
      preparation_notes: ["A preparação usa apenas fontes autorizadas para este dono."],
      suggested_duration_minutes: 20
    }
  };
}

function deterministicEmbedding(input: string) {
  const vector = [1, 1, 1, 1];
  for (let index = 0; index < input.length; index += 1) {
    vector[index % vector.length] = (vector[index % vector.length] ?? 1) + (input.codePointAt(index) ?? 0);
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => Number((value / magnitude).toFixed(8)));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}
