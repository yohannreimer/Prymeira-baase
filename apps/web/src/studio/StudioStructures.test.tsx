import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudioStructures from "./StudioStructures";

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
      metricJson: { label: "Receita", target: 200, baseline: 100, current: 125, unit: "mil" },
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
    expect(within(panel).getByText(/125 de 200 mil/i)).toBeInTheDocument();
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
});

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
