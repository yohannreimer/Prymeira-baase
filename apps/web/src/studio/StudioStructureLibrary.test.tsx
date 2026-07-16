import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudioStructureLibrary, { formatStudioCalendarDate } from "./StudioStructureLibrary";
import { listStudioStructures } from "./studio-api";
import type { StudioStructure } from "./studio.types";

vi.mock("./studio-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./studio-api")>();
  return { ...original, listStudioStructures: vi.fn() };
});

const mockedList = vi.mocked(listStudioStructures);

describe("StudioStructureLibrary", () => {
  beforeEach(() => mockedList.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("lists decisions and opens the original document", async () => {
    const user = userEvent.setup();
    const onOpenDocument = vi.fn();
    mockedList.mockResolvedValue({
      items: [structure({
        id: "decision_1",
        documentId: "document_1",
        documentTitle: "Reorganizar atendimento",
        kind: "decision",
        propertiesJson: { decision: "Unificar a fila comercial", context: "Dois canais competiam pela atenção." }
      })],
      nextCursor: null
    });

    render(<StudioStructureLibrary kind="decision" onOpenDocument={onOpenDocument} />);

    expect(await screen.findByRole("heading", { name: "Decisões" })).toBeVisible();
    expect(screen.getByText("Reorganizar atendimento")).toBeVisible();
    expect(mockedList).toHaveBeenCalledWith(
      { kind: "decision", lifecycle_status: "active", limit: 30 },
      fetch,
      expect.any(AbortSignal)
    );
    await user.click(screen.getByRole("button", { name: "Abrir Reorganizar atendimento" }));
    expect(onOpenDocument).toHaveBeenCalledWith("document_1");
  });

  it("searches loaded titles and filters by a safe structure state", async () => {
    const user = userEvent.setup();
    mockedList.mockResolvedValueOnce({
      items: [
        structure({ id: "goal_1", documentId: "doc_1", documentTitle: "Abrir nova unidade", propertiesJson: { desired_outcome: "Operação pronta", state: "in_focus" } }),
        structure({ id: "goal_2", documentId: "doc_2", documentTitle: "Rever margem", propertiesJson: { desired_outcome: "Margem saudável", state: "waiting" } })
      ],
      nextCursor: null
    });

    render(<StudioStructureLibrary kind="goal" onOpenDocument={vi.fn()} />);
    await screen.findByText("Abrir nova unidade");

    await user.type(screen.getByRole("searchbox", { name: "Buscar metas por título" }), "margem");
    expect(screen.queryByText("Abrir nova unidade")).not.toBeInTheDocument();
    expect(screen.getByText("Rever margem")).toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "Buscar metas por título" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar metas por estado" }), "in_focus");
    expect(screen.getByText("Abrir nova unidade")).toBeInTheDocument();
    expect(screen.queryByText("Rever margem")).not.toBeInTheDocument();
  });

  it("loads true cursor pages incrementally and deduplicates repeated ids", async () => {
    const user = userEvent.setup();
    mockedList
      .mockResolvedValueOnce({
        items: [structure({ id: "plan_1", documentId: "doc_1", documentTitle: "Plano Sul", kind: "plan", propertiesJson: { direction: "Validar a região" } })],
        nextCursor: "cursor_2"
      })
      .mockResolvedValueOnce({
        items: [
          structure({ id: "plan_1", documentId: "doc_1", documentTitle: "Plano Sul repetido", kind: "plan", propertiesJson: { direction: "Validar a região" } }),
          structure({ id: "plan_2", documentId: "doc_2", documentTitle: "Plano Norte", kind: "plan", propertiesJson: { direction: "Encontrar parceiros" } })
        ],
        nextCursor: null
      });

    render(<StudioStructureLibrary kind="plan" onOpenDocument={vi.fn()} />);
    await screen.findByText("Plano Sul");
    await user.click(screen.getByRole("button", { name: "Carregar mais planos" }));

    expect(await screen.findByText("Plano Norte")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(mockedList).toHaveBeenNthCalledWith(2,
      { kind: "plan", lifecycle_status: "active", limit: 30, cursor: "cursor_2" },
      fetch,
      expect.any(AbortSignal)
    );
  });

  it("keeps pagination focusable while loading, announces the final page and focuses its first new item", async () => {
    const user = userEvent.setup();
    const finalPage = deferred<{ items: StudioStructure[]; nextCursor: null }>();
    mockedList
      .mockResolvedValueOnce({
        items: [structure({ id: "plan_1", documentId: "doc_1", documentTitle: "Plano inicial", kind: "plan" })],
        nextCursor: "cursor_final"
      })
      .mockImplementationOnce(() => finalPage.promise);

    render(<StudioStructureLibrary kind="plan" onOpenDocument={vi.fn()} />);
    const loadMore = await screen.findByRole("button", { name: "Carregar mais planos" });
    loadMore.focus();
    await user.click(loadMore);

    expect(loadMore).toHaveFocus();
    expect(loadMore).toHaveAttribute("aria-disabled", "true");
    expect(loadMore).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status", { name: "Atualização da lista" })).toHaveTextContent("Carregando mais planos.");

    await act(async () => finalPage.resolve({
      items: [structure({ id: "plan_2", documentId: "doc_2", documentTitle: "Plano recém-carregado", kind: "plan" })],
      nextCursor: null
    }));

    const newItem = await screen.findByRole("button", { name: "Abrir Plano recém-carregado" });
    await waitFor(() => expect(newItem).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Carregar mais planos" })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Atualização da lista" })).toHaveTextContent("1 plano adicionado. Você chegou ao fim.");
  });

  it("returns pagination focus to the stable heading when the final page adds no unique item", async () => {
    const user = userEvent.setup();
    mockedList
      .mockResolvedValueOnce({
        items: [structure({ id: "decision_1", documentId: "doc_1", documentTitle: "Escolha existente", kind: "decision" })],
        nextCursor: "cursor_final"
      })
      .mockResolvedValueOnce({
        items: [structure({ id: "decision_1", documentId: "doc_1", documentTitle: "Escolha repetida", kind: "decision" })],
        nextCursor: null
      });

    render(<StudioStructureLibrary kind="decision" onOpenDocument={vi.fn()} />);
    const loadMore = await screen.findByRole("button", { name: "Carregar mais decisões" });
    loadMore.focus();
    await user.click(loadMore);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Decisões" })).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole("status", { name: "Atualização da lista" })).toHaveTextContent("Nenhuma decisão nova. Você chegou ao fim.");
  });

  it("does not steal focus when the owner moves away while the final page is pending", async () => {
    const user = userEvent.setup();
    const finalPage = deferred<{ items: StudioStructure[]; nextCursor: null }>();
    mockedList
      .mockResolvedValueOnce({
        items: [structure({ id: "goal_1", documentId: "doc_1", documentTitle: "Meta inicial" })],
        nextCursor: "cursor_final"
      })
      .mockImplementationOnce(() => finalPage.promise);

    render(<StudioStructureLibrary kind="goal" onOpenDocument={vi.fn()} />);
    const loadMore = await screen.findByRole("button", { name: "Carregar mais metas" });
    loadMore.focus();
    await user.click(loadMore);
    const search = screen.getByRole("searchbox", { name: "Buscar metas por título" });
    search.focus();
    expect(search).toHaveFocus();

    await act(async () => finalPage.resolve({
      items: [structure({ id: "goal_2", documentId: "doc_2", documentTitle: "Meta nova" })],
      nextCursor: null
    }));

    await screen.findByRole("button", { name: "Abrir Meta nova" });
    expect(search).toHaveFocus();
    expect(screen.getByRole("status", { name: "Atualização da lista" })).toHaveTextContent("1 meta adicionada. Você chegou ao fim.");
  });

  it("abandons stale results when the kind changes", async () => {
    const decisionPage = deferred<{ items: StudioStructure[]; nextCursor: null }>();
    mockedList.mockImplementation((query) => query?.kind === "decision"
      ? decisionPage.promise
      : Promise.resolve({ items: [structure({ id: "goal_new", documentId: "doc_new", documentTitle: "Meta atual" })], nextCursor: null }));

    const { rerender } = render(<StudioStructureLibrary kind="decision" onOpenDocument={vi.fn()} />);
    rerender(<StudioStructureLibrary kind="goal" onOpenDocument={vi.fn()} />);
    expect(await screen.findByText("Meta atual")).toBeInTheDocument();

    decisionPage.resolve({
      items: [structure({ id: "decision_old", documentId: "doc_old", documentTitle: "Decisão antiga", kind: "decision" })],
      nextCursor: null
    });
    await waitFor(() => expect(screen.queryByText("Decisão antiga")).not.toBeInTheDocument());
    expect(mockedList.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal);
    expect(mockedList.mock.calls[0]?.[2]?.aborted).toBe(true);
  });

  it("offers calm empty, no-result, error and retry states", async () => {
    const user = userEvent.setup();
    mockedList.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ items: [], nextCursor: null });

    render(<StudioStructureLibrary kind="decision" onOpenDocument={vi.fn()} />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Não foi possível buscar suas decisões agora.")).toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Nenhuma decisão organizada ainda.")).toBeInTheDocument();
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it("formats calendar dates without shifting the civil day in São Paulo", async () => {
    expect(formatStudioCalendarDate("2026-12-31T00:00:00.000Z")).toBe("31 de dez. de 2026");
    expect(formatStudioCalendarDate("2026-12-31")).toBe("31 de dez. de 2026");
    expect(formatStudioCalendarDate("2026-02-29")).toBeNull();
    expect(formatStudioCalendarDate("not-a-date")).toBeNull();

    mockedList.mockResolvedValueOnce({
      items: [structure({
        id: "goal_calendar",
        documentTitle: "Encerrar o ano",
        horizonAt: "2026-12-31T00:00:00.000Z"
      })],
      nextCursor: null
    });
    const { rerender } = render(<StudioStructureLibrary kind="goal" onOpenDocument={vi.fn()} />);

    expect(await screen.findByText("Horizonte 31 de dez. de 2026")).toBeInTheDocument();

    mockedList.mockResolvedValueOnce({
      items: [structure({
        id: "decision_calendar",
        kind: "decision",
        documentTitle: "Revisar a escolha",
        propertiesJson: { decision: "Manter o canal", review_date: "2026-12-31" }
      })],
      nextCursor: null
    });
    rerender(<StudioStructureLibrary kind="decision" onOpenDocument={vi.fn()} />);
    expect(await screen.findByText("Revisar 31 de dez. de 2026")).toBeInTheDocument();
  });
});

function structure(overrides: Partial<StudioStructure> = {}): StudioStructure {
  return {
    id: "structure_1",
    workspaceId: "workspace_1",
    ownerProfileId: "owner_1",
    documentId: "document_1",
    documentTitle: "Pensamento",
    kind: "goal",
    lifecycleStatus: "active",
    revision: 1,
    horizonAt: null,
    metricJson: null,
    cadenceJson: null,
    nextRunAt: null,
    propertiesJson: { desired_outcome: "Resultado" },
    createdAt: "2026-07-10T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z",
    archivedAt: null,
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
