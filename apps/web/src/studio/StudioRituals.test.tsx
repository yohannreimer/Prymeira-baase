import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudioRituals from "./StudioRituals";

const ritual = {
  id: "ritual_1",
  workspaceId: "workspace_1",
  ownerProfileId: "owner_1",
  documentId: "document_1",
  documentTitle: "Revisar prioridades",
  kind: "ritual",
  lifecycleStatus: "active",
  revision: 1,
  horizonAt: null,
  metricJson: null,
  cadenceJson: { frequency: "weekly", weekdays: [1], local_time: "09:00", timezone: "America/Sao_Paulo" },
  nextRunAt: "2026-07-20T12:00:00.000Z",
  propertiesJson: { intention: "Revisar prioridades", guide_questions: ["O que mudou?", "O que merece foco?"] },
  createdAt: "2026-07-14T12:00:00.000Z",
  updatedAt: "2026-07-14T12:00:00.000Z",
  archivedAt: null
};

const readySession = {
  id: "session_1",
  workspaceId: "workspace_1",
  ownerProfileId: "owner_1",
  ritualId: ritual.id,
  status: "ready",
  revision: 1,
  contextJson: {
    preparedAt: "2026-07-14T12:00:00.000Z",
    operational: { facts: [{ label: "Duas decisões seguem abertas" }] },
    related: [{ documentId: "document_2", excerpt: "Margem e contratação" }]
  },
  preparationJson: {
    proposal: {
      ritual_id: ritual.id,
      title: "Revisão semanal",
      intent: "Decidir com clareza",
      agenda: [
        { prompt: "O que mudou?", purpose: "Separar fatos de impressão" },
        { prompt: "O que merece foco?", purpose: "Escolher a próxima atenção" }
      ],
      preparation_notes: ["Há duas decisões abertas"],
      suggested_duration_minutes: 20
    }
  },
  answersJson: {},
  synthesisJson: null,
  prepareAiRunId: "run_prepare",
  synthesisAiRunId: null,
  preparationToken: null,
  preparationLeaseExpiresAt: null,
  failureCode: null,
  createdAt: "2026-07-14T12:00:00.000Z",
  updatedAt: "2026-07-14T12:00:00.000Z",
  completedAt: null
};

describe("StudioRituals", () => {
  beforeEach(() => installLocalStorage());
  afterEach(() => vi.restoreAllMocks());

  it("opens answers immediately while preparation advances through abortable polling", async () => {
    const user = userEvent.setup();
    const preparing = {
      ...readySession,
      status: "preparing",
      revision: 1,
      preparationJson: null,
      prepareAiRunId: null,
      preparationToken: null,
      preparationLeaseExpiresAt: null,
      contextJson: { ritual: { guideQuestions: ["O que mudou?", "O que merece foco?"] } }
    };
    let polls = 0;
    let pollSignal: AbortSignal | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) return response({ structures: [ritual], nextCursor: null });
      if (url.endsWith(`/api/studio/rituals/${ritual.id}/sessions`) && init?.method === "POST") {
        return response({ session: preparing }, 201);
      }
      if (url.includes(`/api/studio/rituals/${ritual.id}/sessions?`) && !init?.method) {
        polls += 1;
        pollSignal = init?.signal as AbortSignal;
        return response({ sessions: [{ ...readySession, revision: 2 }], nextCursor: null });
      }
      return response({}, 404);
    });

    render(<StudioRituals />);
    await user.click(await screen.findByRole("button", { name: /iniciar revisar prioridades/i }));

    expect(await screen.findByRole("textbox", { name: "Resposta para O que mudou?" })).toBeEnabled();
    expect(screen.getByText("Preparando contexto em segundo plano…")).toBeVisible();
    await waitFor(() => expect(screen.getByText("Ver contexto preparado")).toBeVisible(), { timeout: 2_500 });
    expect(polls).toBeGreaterThan(0);
    await waitFor(() => expect(pollSignal?.aborted).toBe(true));
  });

  it("saves one visible question at a time and keeps final suggestions pending", async () => {
    const user = userEvent.setup();
    let revision = 1;
    let answers: Record<string, string> = {};
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) return response({ structures: [ritual], nextCursor: null });
      if (url.endsWith(`/api/studio/rituals/${ritual.id}/sessions`) && init?.method === "POST") {
        return response({ session: readySession }, 201);
      }
      if (url.endsWith("/api/studio/ritual-sessions/session_1") && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body));
        answers = { ...answers, ...payload.answers };
        revision += 1;
        return response({ session: { ...readySession, status: "in_progress", revision, answersJson: answers } });
      }
      if (url.endsWith("/api/studio/ritual-sessions/session_1/finish") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body));
        answers = { ...answers, ...payload.answers };
        revision += 1;
        return response({ session: {
          ...readySession,
          status: "completed",
          revision,
          answersJson: answers,
          completedAt: "2026-07-14T12:10:00.000Z",
          synthesisJson: {
            summary: "A semana pede foco comercial.",
            decisions: ["Manter a contratação em revisão"],
            open_questions: ["Qual margem mínima aceitar?"],
            suggested_next_steps: ["Revisar a proposta comercial"]
          }
        } });
      }
      return response({}, 404);
    });

    render(<StudioRituals />);
    await user.click(await screen.findByRole("button", { name: /iniciar revisar prioridades/i }));

    expect(screen.getByRole("heading", { name: "O que mudou?" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "O que merece foco?" })).not.toBeInTheDocument();
    await user.click(screen.getByText("Ver contexto preparado"));
    expect(screen.getByText("Há duas decisões abertas")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Resposta para O que mudou?" }), "A margem melhorou.");
    await user.click(screen.getByRole("button", { name: "Salvar e continuar" }));
    expect(await screen.findByRole("heading", { name: "O que merece foco?" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Estado do salvamento do ritual" })).toHaveTextContent("Salvo");

    await user.type(screen.getByRole("textbox", { name: "Resposta para O que merece foco?" }), "Proposta comercial.");
    await user.click(screen.getByRole("button", { name: "Concluir ritual" }));

    expect(await screen.findByRole("heading", { name: "Ritual concluído" })).toBeInTheDocument();
    const suggestions = screen.getByRole("region", { name: "Sugestões para revisar" });
    expect(within(suggestions).getAllByText("Pendente").length).toBeGreaterThan(0);
    expect(within(suggestions).getByText("Revisar a proposta comercial")).toBeInTheDocument();
    expect(within(suggestions).queryByRole("button", { name: /aplicar|criar tarefa|publicar/i })).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.filter(([url, init]) => String(url).includes("ritual-sessions/session_1") && init?.method === "PATCH")).toHaveLength(2);
  });

  it("keeps answers available when preparation fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) return response({ structures: [ritual], nextCursor: null });
      if (url.endsWith(`/api/studio/rituals/${ritual.id}/sessions`) && init?.method === "POST") {
        return response({ session: {
          ...readySession,
          status: "failed",
          preparationJson: null,
          failureCode: "STUDIO_RITUAL_PREPARATION_FAILED"
        } }, 201);
      }
      return response({}, 404);
    });

    render(<StudioRituals />);
    await user.click(await screen.findByRole("button", { name: /iniciar revisar prioridades/i }));
    expect(await screen.findByRole("status", { name: "Estado do salvamento do ritual" })).toBeVisible();
    expect(screen.getByText(/contexto da IA não ficou disponível/i)).toBeVisible();
    expect(screen.getByRole("heading", { name: "O que mudou?" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Resposta para O que mudou?" })).toBeEnabled();
  });

  it("keeps an offline answer locally and retries without hiding the save state", async () => {
    const user = userEvent.setup();
    let patchAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) return response({ structures: [ritual], nextCursor: null });
      if (url.endsWith(`/api/studio/rituals/${ritual.id}/sessions`) && init?.method === "POST") return response({ session: readySession }, 201);
      if (url.endsWith("/api/studio/ritual-sessions/session_1") && init?.method === "PATCH") {
        patchAttempts += 1;
        if (patchAttempts === 1) throw new TypeError("offline");
        return response({ session: { ...readySession, status: "in_progress", revision: 2, answersJson: { "O que mudou?": "Resposta preservada" } } });
      }
      return response({}, 404);
    });

    render(<StudioRituals />);
    await user.click(await screen.findByRole("button", { name: /iniciar revisar prioridades/i }));
    await user.type(screen.getByRole("textbox", { name: "Resposta para O que mudou?" }), "Resposta preservada");
    await user.click(screen.getByRole("button", { name: "Salvar e continuar" }));
    expect(await screen.findByRole("status", { name: "Estado do salvamento do ritual" })).toHaveTextContent("Offline");
    expect(window.localStorage.getItem("baase:studio:ritual-draft:session_1")).toContain("Resposta preservada");
    await user.click(screen.getByRole("button", { name: "Tentar salvar novamente" }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Estado do salvamento do ritual" })).toHaveTextContent("Salvo"));
  });

  it("does not claim an offline answer was preserved when browser storage rejects it", async () => {
    const user = userEvent.setup();
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) return response({ structures: [ritual], nextCursor: null });
      if (url.endsWith(`/api/studio/rituals/${ritual.id}/sessions`) && init?.method === "POST") return response({ session: readySession }, 201);
      if (url.endsWith("/api/studio/ritual-sessions/session_1") && init?.method === "PATCH") throw new TypeError("offline");
      return response({}, 404);
    });

    render(<StudioRituals />);
    await user.click(await screen.findByRole("button", { name: /iniciar revisar prioridades/i }));
    await user.type(screen.getByRole("textbox", { name: "Resposta para O que mudou?" }), "Ainda não sincronizada");
    await user.click(screen.getByRole("button", { name: "Salvar e continuar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/mantenha esta página aberta/i);
    expect(screen.queryByText(/ficou guardada neste navegador/i)).not.toBeInTheDocument();
  });

  it("resumes an in-progress session at the first unanswered question and moves focus on advance", async () => {
    const user = userEvent.setup();
    let revision = 3;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) return response({ structures: [ritual], nextCursor: null });
      if (url.endsWith(`/api/studio/rituals/${ritual.id}/sessions`) && init?.method === "POST") return response({
        session: { ...readySession, status: "in_progress", revision, answersJson: { "O que mudou?": "A margem melhorou." } }
      }, 201);
      if (url.endsWith("/api/studio/ritual-sessions/session_1") && init?.method === "PATCH") {
        revision += 1;
        return response({ session: { ...readySession, status: "in_progress", revision, answersJson: JSON.parse(String(init.body)).answers } });
      }
      return response({}, 404);
    });

    render(<StudioRituals />);
    await user.click(await screen.findByRole("button", { name: /iniciar revisar prioridades/i }));

    const resumed = await screen.findByRole("textbox", { name: "Resposta para O que merece foco?" });
    expect(resumed).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Pergunta anterior" }));
    await user.click(screen.getByRole("button", { name: "Salvar e continuar" }));
    expect(await screen.findByRole("textbox", { name: "Resposta para O que merece foco?" })).toHaveFocus();
  });

  it("offers an explicit synthesis retry after answers were safely completed", async () => {
    const user = userEvent.setup();
    let finishCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) return response({ structures: [ritual], nextCursor: null });
      if (url.endsWith(`/api/studio/rituals/${ritual.id}/sessions`) && init?.method === "POST") return response({ session: {
        ...readySession,
        status: "completed",
        revision: 4,
        completedAt: "2026-07-14T12:10:00.000Z",
        synthesisFailureCode: "STUDIO_RITUAL_SYNTHESIS_FAILED"
      } }, 201);
      if (url.endsWith("/api/studio/ritual-sessions/session_1/finish") && init?.method === "POST") {
        finishCalls += 1;
        return response({ session: {
          ...readySession,
          status: "completed",
          revision: 6,
          completedAt: "2026-07-14T12:10:00.000Z",
          synthesisJson: { summary: "Síntese recuperada.", decisions: [], open_questions: [], suggested_next_steps: [] },
          synthesisFailureCode: null
        } });
      }
      return response({}, 404);
    });

    render(<StudioRituals />);
    await user.click(await screen.findByRole("button", { name: /iniciar revisar prioridades/i }));
    await user.click(await screen.findByRole("button", { name: /tentar gerar síntese/i }));

    expect(await screen.findByText("Síntese recuperada.")).toBeInTheDocument();
    expect(finishCalls).toBe(1);
  });

  it("keeps synthesis retry enabled when the retry itself finishes with another provider failure", async () => {
    const user = userEvent.setup();
    let finishCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) return response({ structures: [ritual], nextCursor: null });
      if (url.endsWith(`/api/studio/rituals/${ritual.id}/sessions`) && init?.method === "POST") return response({ session: {
        ...readySession,
        status: "completed",
        revision: 4,
        completedAt: "2026-07-14T12:10:00.000Z",
        synthesisFailureCode: "STUDIO_RITUAL_SYNTHESIS_FAILED"
      } }, 201);
      if (url.endsWith("/api/studio/ritual-sessions/session_1/finish") && init?.method === "POST") {
        finishCalls += 1;
        return response({ session: {
          ...readySession,
          status: "completed",
          revision: 4 + finishCalls,
          completedAt: "2026-07-14T12:10:00.000Z",
          synthesisFailureCode: "STUDIO_RITUAL_SYNTHESIS_FAILED"
        } });
      }
      return response({}, 404);
    });

    render(<StudioRituals />);
    await user.click(await screen.findByRole("button", { name: /iniciar revisar prioridades/i }));
    const retry = await screen.findByRole("button", { name: /tentar gerar síntese/i });
    await user.click(retry);

    await waitFor(() => expect(screen.getByRole("button", { name: /tentar gerar síntese/i })).toBeEnabled());
    expect(finishCalls).toBe(1);
  });

  it("restores an unfinished ritual builder draft after leaving the page", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ structures: [], nextCursor: null }));
    const first = render(<StudioRituals />);
    await user.click(await screen.findByRole("button", { name: "Criar ritual" }));
    await user.type(screen.getByRole("textbox", { name: "Nome do ritual" }), "Revisão do trimestre");
    await user.type(screen.getByRole("textbox", { name: "Intenção" }), "Escolher as apostas centrais");
    first.unmount();

    render(<StudioRituals />);
    await user.click(await screen.findByRole("button", { name: "Criar ritual" }));
    expect(screen.getByRole("textbox", { name: "Nome do ritual" })).toHaveValue("Revisão do trimestre");
    expect(screen.getByRole("textbox", { name: "Intenção" })).toHaveValue("Escolher as apostas centrais");
  });

  it("uses the exact projected document title without scanning document pages", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) return response({
        structures: [{ ...ritual, documentTitle: "Revisão semanal do dono" }], nextCursor: null
      });
      if (url.includes("/api/studio/documents")) throw new Error("DOCUMENT_SCAN_FORBIDDEN");
      return response({}, 404);
    });

    render(<StudioRituals />);
    expect(await screen.findByText("Revisão semanal do dono")).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("drains a newer answer snapshot before finishing when a previous PATCH is still pending", async () => {
    const user = userEvent.setup();
    const slowPatch = deferred<Response>();
    const calls: Array<{ kind: "patch" | "finish"; body: Record<string, unknown> }> = [];
    let revision = 1;
    let patchCount = 0;
    let storedAnswers: Record<string, string> = {};
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) return response({ structures: [ritual], nextCursor: null });
      if (url.endsWith(`/api/studio/rituals/${ritual.id}/sessions`) && init?.method === "POST") return response({ session: readySession }, 201);
      if (url.endsWith("/api/studio/ritual-sessions/session_1") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { answers: Record<string, string> };
        calls.push({ kind: "patch", body });
        patchCount += 1;
        if (patchCount === 2) return slowPatch.promise;
        storedAnswers = { ...storedAnswers, ...body.answers };
        revision += 1;
        return response({ session: { ...readySession, status: "in_progress", revision, answersJson: storedAnswers } });
      }
      if (url.endsWith("/api/studio/ritual-sessions/session_1/finish") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        calls.push({ kind: "finish", body });
        revision += 1;
        return response({ session: {
          ...readySession,
          status: "completed",
          revision,
          answersJson: storedAnswers,
          synthesisJson: null,
          completedAt: "2026-07-14T12:20:00.000Z"
        } });
      }
      return response({}, 404);
    });

    render(<StudioRituals />);
    await user.click(await screen.findByRole("button", { name: /iniciar revisar prioridades/i }));
    await user.type(screen.getByRole("textbox", { name: "Resposta para O que mudou?" }), "Primeira resposta");
    await user.click(screen.getByRole("button", { name: "Salvar e continuar" }));
    await screen.findByRole("heading", { name: "O que merece foco?" });

    const finalAnswer = screen.getByRole("textbox", { name: "Resposta para O que merece foco?" });
    await user.type(finalAnswer, "Versão inicial");
    await waitFor(() => expect(patchCount).toBe(2), { timeout: 1_500 });
    await user.type(finalAnswer, " e final");
    await user.click(screen.getByRole("button", { name: "Concluir ritual" }));
    expect(calls.some((call) => call.kind === "finish")).toBe(false);

    storedAnswers = { ...storedAnswers, "O que merece foco?": "Versão inicial" };
    revision += 1;
    slowPatch.resolve(response({ session: {
      ...readySession,
      status: "in_progress",
      revision,
      answersJson: storedAnswers
    } }));

    await screen.findByRole("heading", { name: "Ritual concluído" });
    const finalPatchIndex = calls.findIndex((call) => call.kind === "patch"
      && (call.body.answers as Record<string, string>)["O que merece foco?"] === "Versão inicial e final");
    const finishIndex = calls.findIndex((call) => call.kind === "finish");
    expect(finalPatchIndex).toBeGreaterThan(1);
    expect(finishIndex).toBeGreaterThan(finalPatchIndex);
    expect(calls[finishIndex]!.body.answers).toMatchObject({ "O que merece foco?": "Versão inicial e final" });
    expect(storedAnswers["O que merece foco?"]).toBe("Versão inicial e final");
  });

  it("keeps a stale local draft until the owner explicitly merges and saves it", async () => {
    const user = userEvent.setup();
    const recoveredPatch = deferred<Response>();
    let patchCount = 0;
    let recoveredPayload: { expected_revision: number; answers: Record<string, string> } | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) return response({ structures: [ritual], nextCursor: null });
      if (url.endsWith(`/api/studio/rituals/${ritual.id}/sessions`) && init?.method === "POST") return response({ session: readySession }, 201);
      if (url.endsWith(`/api/studio/rituals/${ritual.id}/sessions?limit=1`) && !init?.method) return response({
        sessions: [{ ...readySession, status: "in_progress", revision: 2, answersJson: { "O que mudou?": "Versão do servidor" } }],
        nextCursor: null
      });
      if (url.endsWith("/api/studio/ritual-sessions/session_1") && init?.method === "PATCH") {
        patchCount += 1;
        if (patchCount === 1) return response({
          error: { code: "STUDIO_RITUAL_SESSION_CHANGED", message: "Sessão alterada." }
        }, 409);
        recoveredPayload = JSON.parse(String(init.body));
        return recoveredPatch.promise;
      }
      return response({}, 404);
    });

    render(<StudioRituals />);
    await user.click(await screen.findByRole("button", { name: /iniciar revisar prioridades/i }));
    await user.type(screen.getByRole("textbox", { name: "Resposta para O que mudou?" }), "Meu rascunho local");
    await user.click(screen.getByRole("button", { name: "Salvar e continuar" }));

    expect(await screen.findByRole("button", { name: "Manter meu rascunho" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descartar rascunho local" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Resposta para O que mudou?" })).toHaveValue("Meu rascunho local");
    expect(window.localStorage.getItem("baase:studio:ritual-draft:session_1")).toContain("Meu rascunho local");

    await user.click(screen.getByRole("button", { name: "Manter meu rascunho" }));
    await waitFor(() => expect(recoveredPayload).toEqual({
      expected_revision: 2,
      answers: { "O que mudou?": "Meu rascunho local" }
    }));
    expect(window.localStorage.getItem("baase:studio:ritual-draft:session_1")).toContain("Meu rascunho local");

    recoveredPatch.resolve(response({ session: {
      ...readySession,
      status: "in_progress",
      revision: 3,
      answersJson: { "O que mudou?": "Meu rascunho local" }
    } }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Estado do salvamento do ritual" })).toHaveTextContent("Salvo"));
    expect(window.localStorage.getItem("baase:studio:ritual-draft:session_1")).toBeNull();
  });

  it("creates a free ritual and only reveals cadence when requested", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) return response({ structures: [], nextCursor: null });
      if (url.endsWith("/api/studio/documents") && init?.method === "POST") return response({ document: {
        id: "document_new",
        workspaceId: "workspace_1",
        ownerProfileId: "owner_1",
        captureKey: null,
        title: "Revisão mensal",
        bodyJson: { type: "doc" },
        bodyText: "Olhar decisões com calma",
        revision: 1,
        captureMode: "text",
        inboxState: "pending_review",
        isFocused: false,
        status: "active",
        createdAt: "2026-07-14T12:00:00.000Z",
        updatedAt: "2026-07-14T12:00:00.000Z",
        archivedAt: null
      } }, 201);
      if (url.endsWith("/api/studio/documents/document_new/structures") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body));
        return response({ structure: { ...ritual, id: "ritual_new", documentId: "document_new", cadenceJson: payload.cadence_json, propertiesJson: payload.properties_json } }, 201);
      }
      return response({}, 404);
    });

    render(<StudioRituals />);
    await user.click(await screen.findByRole("button", { name: "Criar ritual" }));
    expect(screen.queryByLabelText("Horário do ritual")).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Nome do ritual" }), "Revisão mensal");
    await user.type(screen.getByRole("textbox", { name: "Intenção" }), "Olhar decisões com calma");
    await user.type(screen.getByRole("textbox", { name: "Perguntas guia" }), "O que aprendi?\nO que muda agora?");
    await user.click(screen.getByRole("button", { name: "Adicionar cadência" }));
    expect(screen.getByLabelText("Horário do ritual")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Salvar ritual" }));

    await waitFor(() => expect(fetchSpy.mock.calls.some(([url, init]) => {
      if (!String(url).endsWith("/documents/document_new/structures") || init?.method !== "POST") return false;
      const payload = JSON.parse(String(init.body));
      return payload.kind === "ritual" && payload.properties_json.guide_questions.length === 2 && payload.cadence_json.timezone;
    })).toBe(true));
    expect(await screen.findByText("Revisão mensal")).toBeInTheDocument();
  });
});

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function installLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() { return store.size; }
    }
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
