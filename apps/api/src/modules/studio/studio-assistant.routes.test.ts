import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { readRuntimeConfig } from "../../config/runtime";
import type { AiProvider } from "../ai/ai.types";
import { createInMemoryStudioRepository } from "./in-memory-studio.repository";

const ownerA = { "x-baase-workspace-id": "workspace_a", "x-baase-role": "owner", "x-baase-profile-id": "owner_a" };
const ownerB = { ...ownerA, "x-baase-profile-id": "owner_b" };
const manager = { ...ownerA, "x-baase-role": "manager", "x-baase-profile-id": "manager_a" };
const employee = { ...ownerA, "x-baase-role": "employee", "x-baase-profile-id": "employee_a" };

describe("Studio assistant routes", () => {
  it("reports mock AI as ready and streams in pilot without an OpenAI key", async () => {
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const app = buildApp({
        runtimeConfig: readRuntimeConfig({
          BAASE_RUNTIME_MODE: "pilot",
          BAASE_AUTH_MODE: "local",
          BAASE_STUDIO_ENABLED: "true"
        })
      });
      const readiness = await app.inject({ method: "GET", url: "/studio/readiness", headers: ownerA });
      const response = await app.inject({
        method: "POST", url: "/studio/assistant/turns", headers: ownerA,
        payload: { message: "Use o provider local." }
      });

      expect(readiness.json()).toMatchObject({
        ai: { status: "ready", code: null },
        embeddings: { status: "ready", code: null }
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/event-stream");
    } finally {
      if (previousOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiApiKey;
    }
  });

  it("returns safe HTTP 503 before opening SSE when production Studio AI is unavailable", async () => {
    const response = await buildApp({
      runtimeConfig: readRuntimeConfig({
        BAASE_RUNTIME_MODE: "production",
        BAASE_AUTH_MODE: "local",
        BAASE_STUDIO_ENABLED: "true"
      })
    }).inject({
      method: "POST", url: "/studio/assistant/turns", headers: ownerA,
      payload: { message: "Não exponha o stream." }
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["content-type"]).not.toContain("text/event-stream");
    expect(response.json().error).toEqual({
      code: "AI_PROVIDER_UNAVAILABLE",
      message: "A inteligência artificial do Estúdio está indisponível no momento.",
      details: {}
    });
  });

  it("streams framed SSE with non-buffering headers and persists before done", async () => {
    const app = buildApp({ studioRepository: createInMemoryStudioRepository(), aiProvider: provider() });
    const response = await app.inject({
      method: "POST", url: "/studio/assistant/turns", headers: ownerA,
      payload: { message: "Pense comigo.", allow_external_research: false }
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(response.headers["x-accel-buffering"]).toBe("no");
    const events = parseSse(response.body);
    expect(events.map((event) => event.event)).toEqual(["run", "delta", "done"]);
    expect(events[0]?.data).toMatchObject({ ai_run_id: expect.any(String), conversation_id: expect.any(String) });
    expect(events[2]?.data).toMatchObject({ message_id: expect.any(String) });
  });

  it.each([manager, employee])("keeps the assistant owner-only", async (headers) => {
    const response = await buildApp().inject({
      method: "POST", url: "/studio/assistant/turns", headers,
      payload: { message: "Não autorizado." }
    });
    expect(response.statusCode).toBe(403);
  });

  it("does not leak a conversation or suggestion across owner scope", async () => {
    const repository = createInMemoryStudioRepository();
    const app = buildApp({ studioRepository: repository, aiProvider: provider() });
    const first = await app.inject({ method: "POST", url: "/studio/assistant/turns", headers: ownerA,
      payload: { message: "Privado." } });
    const conversationId = parseSse(first.body)[0]?.data.conversation_id as string;
    const foreignTurn = await app.inject({ method: "POST", url: "/studio/assistant/turns", headers: ownerB,
      payload: { conversation_id: conversationId, message: "Tente atravessar." } });
    expect(foreignTurn.statusCode).toBe(404);
    expect(foreignTurn.body).not.toContain("Privado");
    const foreignDecision = await app.inject({ method: "POST", url: "/studio/suggestions/unknown/accept", headers: ownerB });
    expect(foreignDecision.statusCode).toBe(404);
  });

  it("returns a safe terminal SSE error without done or private provider details", async () => {
    const failing: AiProvider = {
      async generateStructured() { return {}; },
      async *streamText() { yield { type: "delta", text: "início" }; throw new Error("secret-provider-token-123"); },
      async createEmbeddings() { return []; },
      async transcribeAudio() { return { text: "", confidence: null, durationSeconds: null }; }
    };
    const response = await buildApp({ aiProvider: failing }).inject({
      method: "POST", url: "/studio/assistant/turns", headers: ownerA, payload: { message: "Falhe seguro." }
    });
    const events = parseSse(response.body);
    expect(events.map((event) => event.event)).toEqual(["run", "delta", "error"]);
    expect(events.at(-1)?.data).toEqual({ code: "STUDIO_ASSISTANT_FAILED", retryable: true });
    expect(response.body).not.toContain("secret-provider-token-123");
    expect(response.body).not.toContain("event: done");
  });

  it("accepts a text suggestion idempotently through owner-only routes", async () => {
    const repository = createInMemoryStudioRepository();
    const document = await repository.createDocument({ workspaceId: "workspace_a", ownerProfileId: "owner_a",
      title: "Original", bodyJson: {}, bodyText: "Original", captureMode: "text", inboxState: "pending_review",
      isFocused: false, status: "active" });
    const app = buildApp({ studioRepository: repository, aiProvider: provider({ facts: [], inferences: [], gaps: [], citations: [], proposal: {
      document_id: document.id, expected_revision: document.revision, title: "Aceito", body_json: {}, body_text: "Aceito"
    } }) });
    const turn = await app.inject({ method: "POST", url: "/studio/assistant/turns", headers: ownerA,
      payload: { document_id: document.id, message: "Sugira", request_text_suggestion: true } });
    const suggestion = parseSse(turn.body).find((event) => event.event === "suggestion")?.data;
    expect(suggestion).toBeTruthy();
    if (!suggestion) throw new Error("expected suggestion event");
    expect(suggestion).not.toHaveProperty("workspaceId");
    expect(suggestion).not.toHaveProperty("ownerProfileId");
    expect(suggestion.payload_json).toMatchObject({
      facts: [], inferences: [], gaps: [], citations: [],
      proposal: { document_id: document.id, expected_revision: document.revision }
    });
    const first = await app.inject({ method: "POST", url: `/studio/suggestions/${suggestion.id}/accept`, headers: ownerA });
    const repeated = await app.inject({ method: "POST", url: `/studio/suggestions/${suggestion.id}/accept`, headers: ownerA });
    expect(first.statusCode).toBe(200);
    expect(repeated.json().version.id).toBe(first.json().version.id);
    expect(first.json().version.origin).toBe("accepted_ai_suggestion");
  });

  it("accepts an edited preview atomically and keeps retries idempotent", async () => {
    const repository = createInMemoryStudioRepository();
    const document = await repository.createDocument({ workspaceId: "workspace_a", ownerProfileId: "owner_a",
      title: "Original", bodyJson: {}, bodyText: "Original", captureMode: "text", inboxState: "pending_review",
      isFocused: false, status: "active" });
    const app = buildApp({ studioRepository: repository, aiProvider: provider({ facts: [], inferences: [], gaps: [], citations: [], proposal: {
      document_id: document.id, expected_revision: 1, title: "Proposta", body_json: {}, body_text: "Proposta"
    } }) });
    const turn = await app.inject({ method: "POST", url: "/studio/assistant/turns", headers: ownerA,
      payload: { document_id: document.id, message: "Sugira", request_text_suggestion: true } });
    const suggestion = parseSse(turn.body).find((event) => event.event === "suggestion")!.data;
    const proposal = { document_id: document.id, expected_revision: 1, title: "Minha edição",
      body_json: { type: "doc" }, body_text: "Texto revisado por mim" };
    const accepted = await app.inject({ method: "POST", url: `/studio/suggestions/${suggestion.id}/accept`, headers: ownerA,
      payload: { proposal } });
    const repeated = await app.inject({ method: "POST", url: `/studio/suggestions/${suggestion.id}/accept`, headers: ownerA,
      payload: { proposal: { ...proposal, body_text: "Outra coisa" } } });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().version.bodyText).toBe("Texto revisado por mim");
    expect(repeated.json().version.id).toBe(accepted.json().version.id);
    expect(repeated.json().version.bodyText).toBe("Texto revisado por mim");
  });

  it("returns 400 before accepting a suggestion with malicious editor JSON", async () => {
    const repository = createInMemoryStudioRepository();
    const app = buildApp({ studioRepository: repository });
    let malicious: Record<string, unknown> = {};
    const body_json = malicious;
    for (let index = 0; index < 40; index += 1) {
      const next: Record<string, unknown> = {};
      malicious.child = next;
      malicious = next;
    }

    const response = await app.inject({
      method: "POST",
      url: "/studio/suggestions/suggestion_a/accept",
      headers: ownerA,
      payload: { proposal: { document_id: "document_a", expected_revision: 1, title: null,
        body_json, body_text: "Tentativa" } }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "STUDIO_EDITOR_JSON_INVALID" } });
  });

  it("uses bounded selected text instead of leaking the complete document to the narrative provider", async () => {
    let providerInput = "";
    const scopedProvider: AiProvider = {
      async generateStructured() { return {}; },
      async *streamText(request) {
        providerInput = JSON.stringify(request.input);
        yield { type: "done", text: "Resposta" };
      },
      async createEmbeddings() { return []; },
      async transcribeAudio() { return { text: "", confidence: null, durationSeconds: null }; }
    };
    const repository = createInMemoryStudioRepository();
    const document = await repository.createDocument({ workspaceId: "workspace_a", ownerProfileId: "owner_a",
      title: "Privado", bodyJson: {}, bodyText: "SEGREDO_FORA_DA_SELECAO", captureMode: "text",
      inboxState: "pending_review", isFocused: false, status: "active" });
    const response = await buildApp({ studioRepository: repository, aiProvider: scopedProvider }).inject({
      method: "POST", url: "/studio/assistant/turns", headers: ownerA,
      payload: { document_id: document.id, message: "Analise", selected_text_context: "TRECHO_ESCOLHIDO" }
    });
    expect(response.statusCode).toBe(200);
    expect(providerInput).toContain("TRECHO_ESCOLHIDO");
    expect(providerInput).not.toContain("SEGREDO_FORA_DA_SELECAO");
  });
});

function provider(structured: unknown = {}): AiProvider {
  return {
    async generateStructured() { return structured; },
    async *streamText(request) {
      if (request.allowExternalResearch) throw new Error("external not expected");
      yield { type: "delta", text: "Resposta segura." };
      yield { type: "done", text: "Resposta segura." };
    },
    async createEmbeddings() { return []; },
    async transcribeAudio() { return { text: "", confidence: null, durationSeconds: null }; }
  };
}

function parseSse(body: string) {
  return body.split("\n\n").filter((frame) => frame.startsWith("event: ")).map((frame) => {
    const [eventLine, dataLine] = frame.split("\n");
    return { event: eventLine!.slice("event: ".length), data: JSON.parse(dataLine!.slice("data: ".length)) as Record<string, any> };
  });
}
