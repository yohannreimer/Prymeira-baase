import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudioStructures from "./StudioStructures";
import { subscribeStudioEvents } from "./studio-events";

const baseStructure = {
  id: "structure_1",
  workspaceId: "workspace_1",
  ownerProfileId: "owner_1",
  documentId: "document_1",
  lifecycleStatus: "active" as const,
  revision: 1,
  cadenceJson: null,
  nextRunAt: null,
  createdAt: "2026-07-14T12:00:00.000Z",
  updatedAt: "2026-07-14T12:00:00.000Z",
  archivedAt: null
};

describe("StudioStructures", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates a goal from only the document title and desired result, revealing indicator and horizon on demand", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) {
        return response({ structures: [], nextCursor: null });
      }
      if (url.endsWith("/api/studio/documents/document_1/structures") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body));
        return response({
          structure: {
            ...baseStructure,
            kind: "goal",
            horizonAt: payload.horizon_at ?? null,
            metricJson: payload.metric_json ?? null,
            propertiesJson: payload.properties_json
          }
        }, 201);
      }
      return response({}, 404);
    });
    render(<StudioStructures documentId="document_1" documentTitle="Expandir atendimento" />);

    const trigger = await screen.findByRole("button", { name: /estruturar este pensamento/i });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Meta" }));

    expect(screen.getByRole("textbox", { name: "Resultado desejado" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Nome do indicador" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Horizonte da meta")).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Resultado desejado" }), "Atender o Sul com consistência");
    await user.click(screen.getByRole("button", { name: "Adicionar indicador" }));
    await user.type(screen.getByRole("textbox", { name: "Nome do indicador" }), "Clientes ativos");
    await user.type(screen.getByRole("spinbutton", { name: "Alvo" }), "40");
    await user.click(screen.getByRole("button", { name: "Adicionar horizonte" }));
    await user.type(screen.getByLabelText("Horizonte da meta"), "2026-12-31");
    await user.click(screen.getByRole("button", { name: "Criar meta" }));

    await waitFor(() => expect(fetchSpy.mock.calls.some(([url, init]) => (
      String(url).endsWith("/api/studio/documents/document_1/structures")
      && init?.method === "POST"
      && JSON.parse(String(init.body)).properties_json.desired_outcome === "Atender o Sul com consistência"
      && JSON.parse(String(init.body)).metric_json.target === 40
      && JSON.parse(String(init.body)).horizon_at === "2026-12-31T00:00:00.000Z"
    ))).toBe(true));
    expect(screen.getByRole("button", { name: /meta.*expandir atendimento/i })).toBeInTheDocument();
  });

  it("removes optional goal fields without deleting the document and preserves compatible properties", async () => {
    const user = userEvent.setup();
    const goal = {
      ...baseStructure,
      kind: "goal" as const,
      horizonAt: "2026-12-31T00:00:00.000Z",
      metricJson: { label: "Clientes", target: 2000, baseline: 1000, current: 1250, unit: "clientes" },
      propertiesJson: {
        desired_outcome: "Crescer com margem",
        state: "in_focus",
        progress_evidence: ["Primeiro contrato renovado"]
      }
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) return response({ structures: [goal], nextCursor: null });
      if (url.endsWith("/api/studio/structures/structure_1") && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body));
        return response({ structure: { ...goal, revision: 2, horizonAt: null, metricJson: null, propertiesJson: payload.properties_json } });
      }
      return response({}, 404);
    });
    render(<StudioStructures documentId="document_1" documentTitle="Margem sustentável" />);

    const trigger = await screen.findByRole("button", { name: /meta.*margem sustentável/i });
    await user.click(trigger);
    const panel = screen.getByRole("region", { name: "Detalhes estratégicos" });
    expect(within(panel).getByText(/1\.250 de 2\.000 clientes/i)).toBeInTheDocument();
    expect(within(panel).queryByText(/%/)).not.toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Remover indicador" }));
    await user.click(within(panel).getByRole("button", { name: "Remover horizonte" }));
    await user.click(within(panel).getByRole("button", { name: "Salvar meta" }));

    await waitFor(() => {
      const patch = fetchSpy.mock.calls.find(([url, init]) => String(url).endsWith("/structures/structure_1") && init?.method === "PATCH");
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({
        expected_revision: 1,
        metric_json: null,
        horizon_at: null,
        properties_json: {
          desired_outcome: "Crescer com margem",
          state: "in_focus",
          progress_evidence: ["Primeiro contrato renovado"]
        }
      });
    });
    expect(fetchSpy.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("records a decision with its original context, dates and later learning", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) return response({ structures: [], nextCursor: null });
      if (url.endsWith("/api/studio/documents/document_1/structures") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body));
        return response({ structure: { ...baseStructure, kind: "decision", horizonAt: payload.horizon_at, metricJson: null, propertiesJson: payload.properties_json } }, 201);
      }
      return response({}, 404);
    });
    render(<StudioStructures documentId="document_1" documentTitle="Escolha de canal" />);
    await user.click(await screen.findByRole("button", { name: /estruturar este pensamento/i }));
    await user.click(screen.getByRole("button", { name: "Decisão" }));

    await user.type(screen.getByRole("textbox", { name: "Decisão tomada" }), "Priorizar parceiros");
    await user.type(screen.getByRole("textbox", { name: "Contexto original" }), "Aquisição direta ficou cara");
    await user.type(screen.getByLabelText("Data da decisão"), "2026-07-14");
    await user.type(screen.getByLabelText("Revisar em"), "2026-10-14");
    await user.type(screen.getByRole("textbox", { name: "Efeitos e aprendizados" }), "Ainda vamos observar");
    await user.click(screen.getByRole("button", { name: "Criar decisão" }));

    await waitFor(() => {
      const call = fetchSpy.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        kind: "decision",
        horizon_at: "2026-10-14T00:00:00.000Z",
        properties_json: {
          decision: "Priorizar parceiros",
          context: "Aquisição direta ficou cara",
          decision_date: "2026-07-14",
          review_date: "2026-10-14",
          learnings: "Ainda vamos observar"
        }
      });
    });
  });

  it("organizes plans by fronts and milestones, never task checkboxes", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) return response({ structures: [], nextCursor: null });
      if (url.endsWith("/api/studio/documents/document_1/structures") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body));
        return response({ structure: { ...baseStructure, kind: "plan", horizonAt: null, metricJson: null, propertiesJson: payload.properties_json } }, 201);
      }
      return response({}, 404);
    });
    render(<StudioStructures documentId="document_1" documentTitle="Expansão regional" />);
    await user.click(await screen.findByRole("button", { name: /estruturar este pensamento/i }));
    await user.click(screen.getByRole("button", { name: "Plano" }));

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Direção do plano" }), "Validar a região antes de escalar");
    await user.type(screen.getByRole("textbox", { name: "Frente 1" }), "Parcerias locais");
    await user.click(screen.getByRole("button", { name: "Adicionar frente" }));
    await user.type(screen.getByRole("textbox", { name: "Frente 2" }), "Operação regional");
    await user.type(screen.getByRole("textbox", { name: "Marco 1" }), "Primeiro contrato sustentável");
    await user.click(screen.getByRole("button", { name: "Criar plano" }));

    expect(await screen.findByRole("button", { name: /plano.*expansão regional/i })).toBeInTheDocument();
  });

  it("moves focus into the details and restores it when Escape closes the panel", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ structures: [], nextCursor: null }));
    render(<StudioStructures documentId="document_1" documentTitle="Pensamento" />);
    const trigger = await screen.findByRole("button", { name: /estruturar este pensamento/i });

    await user.click(trigger);
    expect(screen.getByRole("heading", { name: "Dar forma ao pensamento" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("region", { name: "Detalhes estratégicos" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("recovers from the real stale code by reloading the document-scoped structure after reopening", async () => {
    const user = userEvent.setup();
    let getCount = 0;
    const goal = {
      ...baseStructure,
      kind: "goal" as const,
      horizonAt: null,
      metricJson: null,
      propertiesJson: { desired_outcome: "Versão inicial" }
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) {
        getCount += 1;
        return response({ structures: [{
          ...goal,
          revision: getCount,
          propertiesJson: { desired_outcome: getCount === 1 ? "Versão inicial" : "Versão da outra aba" }
        }], nextCursor: null });
      }
      if (url.endsWith("/api/studio/structures/structure_1") && init?.method === "PATCH") {
        return response({ error: { code: "STUDIO_STRUCTURE_CHANGED", message: "A estrutura mudou." } }, 409);
      }
      return response({}, 404);
    });
    render(<StudioStructures documentId="document_1" documentTitle="Meta compartilhada" />);
    const trigger = await screen.findByRole("button", { name: /meta.*meta compartilhada/i });
    await user.click(trigger);
    const result = screen.getByRole("textbox", { name: "Resultado desejado" });
    await user.clear(result);
    await user.type(result, "Minha edição");
    await user.click(screen.getByRole("button", { name: "Salvar meta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/mudou em outra aba/i);
    await user.click(screen.getByRole("button", { name: "Fechar detalhes estratégicos" }));
    await user.click(trigger);

    await waitFor(() => expect(screen.getByRole("textbox", { name: "Resultado desejado" })).toHaveValue("Versão da outra aba"));
    expect(getCount).toBe(2);
    expect(fetchSpy.mock.calls.filter(([url, init]) => String(url).includes("/api/studio/structures") && !init?.method)).toHaveLength(2);
  });

  it("recognizes the real active-duplicate code", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (!init?.method) return response({ structures: [], nextCursor: null });
      if (String(input).endsWith("/documents/document_1/structures")) {
        return response({ error: { code: "STUDIO_STRUCTURE_ACTIVE_DUPLICATE", message: "Já existe." } }, 409);
      }
      return response({}, 404);
    });
    render(<StudioStructures documentId="document_1" documentTitle="Escolha" />);
    await user.click(await screen.findByRole("button", { name: /estruturar este pensamento/i }));
    await user.click(screen.getByRole("button", { name: "Decisão" }));
    await user.type(screen.getByRole("textbox", { name: "Decisão tomada" }), "Manter o foco");
    await user.click(screen.getByRole("button", { name: "Criar decisão" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/já possui uma estrutura deste tipo/i);
  });

  it("recovers an active duplicate from another tab and continues in edit mode", async () => {
    const user = userEvent.setup();
    let getCount = 0;
    const existingDecision = {
      ...baseStructure,
      id: "decision_from_other_tab",
      kind: "decision" as const,
      horizonAt: null,
      metricJson: null,
      revision: 3,
      propertiesJson: { decision: "Decisão criada na outra aba", context: "Contexto preservado" }
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures") && !init?.method) {
        getCount += 1;
        return response({ structures: getCount === 1 ? [] : [existingDecision], nextCursor: null });
      }
      if (url.endsWith("/api/studio/documents/document_1/structures") && init?.method === "POST") {
        return response({ error: { code: "STUDIO_STRUCTURE_ACTIVE_DUPLICATE", message: "Já existe." } }, 409);
      }
      if (url.endsWith("/api/studio/structures/decision_from_other_tab") && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body));
        return response({ structure: {
          ...existingDecision,
          revision: 4,
          propertiesJson: payload.properties_json
        } });
      }
      return response({}, 404);
    });
    render(<StudioStructures documentId="document_1" documentTitle="Escolha" />);
    const trigger = await screen.findByRole("button", { name: /estruturar este pensamento/i });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Decisão" }));
    await user.type(screen.getByRole("textbox", { name: "Decisão tomada" }), "Minha decisão concorrente");
    await user.click(screen.getByRole("button", { name: "Criar decisão" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/já possui uma estrutura deste tipo/i);

    await user.click(screen.getByRole("button", { name: "Fechar detalhes estratégicos" }));
    await user.click(trigger);
    await waitFor(() => expect(
      screen.getByRole("textbox", { name: "Decisão tomada" })
    ).toHaveValue("Decisão criada na outra aba"));
    const decision = screen.getByRole("textbox", { name: "Decisão tomada" });
    expect(screen.getByRole("textbox", { name: "Contexto original" })).toHaveValue("Contexto preservado");
    expect(screen.getByRole("button", { name: "Salvar decisão" })).toBeInTheDocument();

    await user.type(decision, " revisada");
    await user.click(screen.getByRole("button", { name: "Salvar decisão" }));
    await waitFor(() => expect(fetchSpy.mock.calls.some(([url, init]) => (
      String(url).endsWith("/structures/decision_from_other_tab")
      && init?.method === "PATCH"
      && JSON.parse(String(init.body)).expected_revision === 3
    ))).toBe(true));
    expect(getCount).toBe(2);
  });

  it("uses one document-scoped request even when the owner has ten thousand other structures", async () => {
    const otherStructures = Array.from({ length: 10_000 }, (_, index) => ({
      ...baseStructure,
      id: `structure_${index}`,
      documentId: `other_document_${index}`,
      kind: "goal" as const,
      horizonAt: null,
      metricJson: null,
      propertiesJson: { desired_outcome: `Meta ${index}` }
    }));
    const target = {
      ...baseStructure,
      id: "target_structure",
      documentId: "document / 10.000",
      kind: "plan" as const,
      horizonAt: null,
      metricJson: null,
      propertiesJson: { direction: "Foco" }
    };
    const serverStore = [...otherStructures, target];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "https://baase.local");
      const documentId = url.searchParams.get("document_id");
      return response({
        structures: serverStore.filter((structure) => structure.documentId === documentId).slice(0, 4),
        nextCursor: null
      });
    });
    render(<StudioStructures documentId="document / 10.000" documentTitle="Pensamento isolado" />);

    await screen.findByRole("button", { name: /plano.*pensamento isolado/i });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(serverStore).toHaveLength(10_001);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("/api/studio/structures?lifecycle_status=active&document_id=document+%2F+10.000&limit=4");
  });

  it("checkpoints the current saved revision before publishing a successful structure change", async () => {
    const user = userEvent.setup();
    const sequence: string[] = [];
    const received = vi.fn(() => sequence.push("event"));
    const unsubscribe = subscribeStudioEvents(received);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures?") && !init?.method) return response({ structures: [], nextCursor: null });
      if (url.endsWith("/api/studio/documents/document_1/structures") && init?.method === "POST") {
        sequence.push("persisted");
        return response({ structure: decisionStructure() }, 201);
      }
      if (url.endsWith("/api/studio/documents/document_1") && !init?.method) {
        sequence.push("document");
        return response({ document: rawDocument(7) });
      }
      if (url.endsWith("/api/studio/documents/document_1/checkpoints") && init?.method === "POST") {
        sequence.push("checkpoint");
        expect(JSON.parse(String(init.body))).toEqual({
          expected_revision: 7,
          reason: "structure_changed",
          checkpoint_key: "structure_changed:decision:structure_decision:1"
        });
        return response({ version: rawCheckpoint(7) }, 201);
      }
      return response({}, 404);
    });

    render(<StudioStructures documentId="document_1" documentTitle="Direção estratégica" />);
    await user.click(await screen.findByRole("button", { name: /estruturar este pensamento/i }));
    await user.click(screen.getByRole("button", { name: "Decisão" }));
    await user.type(screen.getByRole("textbox", { name: "Decisão tomada" }), "Concentrar a expansão");
    await user.click(screen.getByRole("button", { name: "Criar decisão" }));

    await waitFor(() => expect(received).toHaveBeenCalledWith({
      type: "structure-changed",
      documentId: "document_1",
      kind: "decision"
    }));
    expect(sequence).toEqual(["persisted", "document", "checkpoint", "event"]);
    expect(screen.queryByText(/marco não pôde ser preservado/i)).not.toBeInTheDocument();
    unsubscribe();
  });

  it("keeps the durable mutation visible, warns accessibly when checkpointing fails, and still publishes", async () => {
    const user = userEvent.setup();
    const received = vi.fn();
    const unsubscribe = subscribeStudioEvents(received);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures?") && !init?.method) return response({ structures: [], nextCursor: null });
      if (url.endsWith("/api/studio/documents/document_1/structures") && init?.method === "POST") {
        return response({ structure: decisionStructure() }, 201);
      }
      if (url.endsWith("/api/studio/documents/document_1") && !init?.method) return response({ document: rawDocument(3) });
      if (url.endsWith("/api/studio/documents/document_1/checkpoints") && init?.method === "POST") {
        return response({ error: { code: "TEMPORARY", message: "offline" } }, 503);
      }
      return response({}, 404);
    });

    render(<StudioStructures documentId="document_1" documentTitle="Direção estratégica" />);
    await user.click(await screen.findByRole("button", { name: /estruturar este pensamento/i }));
    await user.click(screen.getByRole("button", { name: "Decisão" }));
    await user.type(screen.getByRole("textbox", { name: "Decisão tomada" }), "Preservar a margem");
    await user.click(screen.getByRole("button", { name: "Criar decisão" }));

    expect(await screen.findByRole("button", { name: /decisão.*direção estratégica/i })).toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(/estrutura foi salva.*histórico/i);
    expect(received).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("does not publish when structure persistence fails", async () => {
    const user = userEvent.setup();
    const received = vi.fn();
    const unsubscribe = subscribeStudioEvents(received);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures?") && !init?.method) return response({ structures: [], nextCursor: null });
      if (url.endsWith("/api/studio/documents/document_1/structures") && init?.method === "POST") {
        return response({ error: { code: "TEMPORARY", message: "offline" } }, 503);
      }
      return response({}, 404);
    });

    render(<StudioStructures documentId="document_1" documentTitle="Escolha" />);
    await user.click(await screen.findByRole("button", { name: /estruturar este pensamento/i }));
    await user.click(screen.getByRole("button", { name: "Decisão" }));
    await user.type(screen.getByRole("textbox", { name: "Decisão tomada" }), "Escolher agora");
    await user.click(screen.getByRole("button", { name: "Criar decisão" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível salvar/i);
    expect(received).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("archives an existing structure, removes it locally and publishes its kind after persistence", async () => {
    const user = userEvent.setup();
    const decision = decisionStructure();
    const received = vi.fn();
    const unsubscribe = subscribeStudioEvents(received);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures?") && !init?.method) return response({ structures: [decision], nextCursor: null });
      if (url.endsWith("/api/studio/structures/structure_decision") && init?.method === "DELETE") {
        return response({ structure: { ...decision, revision: 2, lifecycleStatus: "archived", archivedAt: "2026-07-16T14:00:00.000Z" } });
      }
      if (url.endsWith("/api/studio/documents/document_1") && !init?.method) return response({ document: rawDocument(4) });
      if (url.endsWith("/api/studio/documents/document_1/checkpoints") && init?.method === "POST") {
        return response({ version: rawCheckpoint(4, 2) }, 201);
      }
      return response({}, 404);
    });

    render(<StudioStructures documentId="document_1" documentTitle="Escolha" />);
    await user.click(await screen.findByRole("button", { name: /decisão.*escolha/i }));
    await user.click(screen.getByRole("button", { name: "Arquivar decisão" }));

    await waitFor(() => expect(received).toHaveBeenCalledWith({
      type: "structure-changed",
      documentId: "document_1",
      kind: "decision"
    }));
    expect(screen.queryByRole("button", { name: "Arquivar decisão" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /estruturar este pensamento/i })).toBeInTheDocument();
    unsubscribe();
  });

  it("keeps an active structure visible and uses archive-specific copy when archiving fails", async () => {
    const user = userEvent.setup();
    const decision = decisionStructure();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/studio/structures?") && !init?.method) return response({ structures: [decision], nextCursor: null });
      if (url.endsWith("/api/studio/structures/structure_decision") && init?.method === "DELETE") {
        return response({ error: { code: "TEMPORARY", message: "offline" } }, 503);
      }
      return response({}, 404);
    });

    render(<StudioStructures documentId="document_1" documentTitle="Escolha" />);
    const trigger = await screen.findByRole("button", { name: /decisão.*escolha/i });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Arquivar decisão" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível arquivar.*continua ativa/i);
    expect(screen.getByRole("button", { name: "Arquivar decisão" })).toBeInTheDocument();
    expect(trigger).toHaveAccessibleName(/decisão.*escolha/i);
  });
});

function decisionStructure() {
  return {
    ...baseStructure,
    id: "structure_decision",
    kind: "decision" as const,
    horizonAt: null,
    metricJson: null,
    propertiesJson: { decision: "Concentrar a expansão" }
  };
}

function rawDocument(revision: number) {
  return {
    id: "document_1",
    workspace_id: "workspace_1",
    owner_profile_id: "owner_1",
    capture_key: null,
    title: "Direção estratégica",
    body_json: { type: "doc" },
    body_text: "Pensamento",
    revision,
    capture_mode: "text",
    inbox_state: "reviewed",
    is_focused: false,
    status: "active",
    created_at: "2026-07-14T12:00:00.000Z",
    updated_at: "2026-07-16T12:00:00.000Z",
    archived_at: null
  };
}

function rawCheckpoint(revision: number, structureRevision = 1) {
  return {
    id: `version_${revision}`,
    workspace_id: "workspace_1",
    owner_profile_id: "owner_1",
    document_id: "document_1",
    version_number: revision,
    body_json: { type: "doc" },
    body_text: "Pensamento",
    origin: "user",
    actor_profile_id: "owner_1",
    ai_run_id: null,
    created_at: "2026-07-16T12:00:00.000Z",
    checkpoint_reason: "structure_changed",
    checkpoint_key: `structure_changed:decision:structure_decision:${structureRevision}`,
    source_revision: revision,
    is_legacy: false
  };
}

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
