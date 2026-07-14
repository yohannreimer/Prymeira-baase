import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudioSearch from "./StudioSearch";
import type { StudioSearchResult } from "./studio.types";

const result: StudioSearchResult = {
  documentId: "document_1",
  title: "Plano anual",
  excerpt: "Crescer com margem e foco.",
  updatedAt: "2026-07-13T10:00:00.000Z",
  collections: [{ id: "collection_1", name: "Estratégia" }]
};

describe("StudioSearch", () => {
  afterEach(() => vi.useRealTimers());

  it("debounces, cancels obsolete requests, and ignores stale completions", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const stale = deferred<StudioSearchResult[]>();
    const searchDocuments = vi.fn((query: string, _limit: number, signal: AbortSignal) => {
      signals.push(signal);
      return query === "plano" ? Promise.resolve([result]) : stale.promise;
    });
    render(<StudioSearch searchDocuments={searchDocuments} onOpenDocument={vi.fn()} />);
    const input = screen.getByRole("searchbox", { name: "Buscar no Estúdio" });

    fireEvent.change(input, { target: { value: "pla" } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    fireEvent.change(input, { target: { value: "plano" } });
    await act(() => vi.advanceTimersByTimeAsync(300));

    expect(searchDocuments).toHaveBeenCalledTimes(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(screen.getByRole("button", { name: /Plano anual/ })).toBeInTheDocument();
    await act(async () => stale.resolve([{ ...result, documentId: "stale", title: "Resultado obsoleto" }]));
    expect(screen.queryByText("Resultado obsoleto")).not.toBeInTheDocument();
  });

  it("shows title, excerpt, date, collection context and sends analytics without private body", async () => {
    const user = userEvent.setup();
    const onAnalytics = vi.fn();
    render(<StudioSearch searchDocuments={async () => [result]} onOpenDocument={vi.fn()} onAnalytics={onAnalytics} debounceMs={0} />);
    await user.type(screen.getByRole("searchbox", { name: "Buscar no Estúdio" }), "margem");

    expect(await screen.findByText("Crescer com margem e foco.")).toBeInTheDocument();
    expect(screen.getByText(/Estratégia/)).toBeInTheDocument();
    expect(screen.getByText(/13 de jul/)).toBeInTheDocument();
    expect(JSON.stringify(onAnalytics.mock.calls)).not.toContain("Crescer com margem");
    expect(onAnalytics).toHaveBeenCalledWith(expect.objectContaining({ resultCount: 1, queryLength: 6 }));
  });

  it("teaches the empty states and uses roving keyboard focus", async () => {
    const user = userEvent.setup();
    const second = { ...result, documentId: "document_2", title: "Decisão comercial" };
    const { rerender } = render(<StudioSearch searchDocuments={async () => []} onOpenDocument={vi.fn()} debounceMs={0} />);
    expect(screen.getByText("Busque uma ideia, decisão ou trecho que você lembra.")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Buscar no Estúdio" }), "inexistente");
    expect(await screen.findByText("Nenhum registro corresponde a esta busca.")).toBeInTheDocument();

    rerender(<StudioSearch searchDocuments={async () => [result, second]} onOpenDocument={vi.fn()} debounceMs={0} />);
    const input = screen.getByRole("searchbox", { name: "Buscar no Estúdio" });
    await user.clear(input);
    await user.type(input, "plano");
    const first = await screen.findByRole("button", { name: /Plano anual/ });
    act(() => first.focus());
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getByRole("button", { name: /Decisão comercial/ })).toHaveFocus());
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
