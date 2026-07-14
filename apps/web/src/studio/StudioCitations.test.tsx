import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import StudioCitations from "./StudioCitations";
import type { StudioCitation } from "./studio.types";

describe("StudioCitations", () => {
  it("normalizes operational resources, metrics and Studio documents into typed navigation targets", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    render(<StudioCitations citations={[
      citation("operational_resource", "task_1", { resourceType: "task" }, "Tarefa atrasada"),
      citation("operational_metric", "dashboard:2026-07-01:2026-07-14", { resourceType: "dashboard" }, "Indicadores"),
      citation("studio_document", "document_2", {}, "Reflexão anterior")
    ]} onOpenInternal={open} />);
    await user.click(screen.getByRole("button", { name: /3 fontes/i }));
    const drawer = screen.getByRole("complementary", { name: "Fontes da resposta" });
    expect(within(drawer).getByText("Tarefa")).toBeInTheDocument();
    expect(within(drawer).getByText("Painel operacional")).toBeInTheDocument();
    expect(within(drawer).getByText("Documento do Estúdio")).toBeInTheDocument();

    await user.click(within(drawer).getByRole("button", { name: /tarefa atrasada/i }));
    await user.click(within(drawer).getByRole("button", { name: /indicadores/i }));
    await user.click(within(drawer).getByRole("button", { name: /reflexão anterior/i }));
    expect(open.mock.calls.map(([target]) => target)).toEqual([
      { kind: "task", resourceId: "task_1" },
      { kind: "dashboard", resourceId: "dashboard:2026-07-01:2026-07-14" },
      { kind: "studio_document", resourceId: "document_2" }
    ]);
  });

  it("disables malformed internal and unsafe external sources", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    render(<StudioCitations citations={[
      citation("operational_resource", "unknown", {}, "Desconhecida"),
      { ...citation("external_url", null, {}, "URL insegura"), url: "javascript:alert(1)" }
    ]} onOpenInternal={open} />);
    await user.click(screen.getByRole("button", { name: /2 fontes/i }));
    expect(screen.getAllByText("Fonte sem navegação disponível")).toHaveLength(2);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });
});

function citation(
  sourceType: StudioCitation["sourceType"],
  sourceId: string | null,
  metadata: Record<string, unknown>,
  label: string
): StudioCitation {
  return { sourceType, sourceId, metadata, label, url: null, excerpt: "", observedAt: "2026-07-14T10:00:00.000Z", periodFrom: null, periodTo: null };
}
