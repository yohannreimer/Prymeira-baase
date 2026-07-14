import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudioPage from "./StudioPage";

const studioStyles = readFileSync(resolve(process.cwd(), "src/studio/studio.css"), "utf8");

describe("StudioPage", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => undefined));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("owns its secondary navigation and section state", () => {
    render(<StudioPage />);

    const studio = screen.getByRole("region", { name: "Estúdio" });
    const navigation = within(studio).getByRole("navigation", { name: "Seções do Estúdio" });
    const expectedSections = [
      "Início",
      "Caixa de entrada",
      "Tudo",
      "Metas",
      "Decisões",
      "Planos",
      "Rituais",
      "Coleção",
      "Documento"
    ];

    expect(within(navigation).getAllByRole("button").map((button) => button.textContent?.trim())).toEqual(expectedSections);
    expect(within(navigation).getByRole("button", { name: "Início" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Um espaço para pensar com clareza." })).toBeInTheDocument();

    fireEvent.click(within(navigation).getByRole("button", { name: "Decisões" }));
    expect(within(navigation).getByRole("button", { name: "Decisões" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Decisões" })).toBeInTheDocument();

    fireEvent.click(within(navigation).getByRole("button", { name: "Documento" }));
    expect(screen.getByRole("heading", { name: "Documento" })).toBeInTheDocument();
  });

  it("supports native keyboard activation and ordered focus", async () => {
    const user = userEvent.setup();
    render(<StudioPage />);

    const navigation = screen.getByRole("navigation", { name: "Seções do Estúdio" });
    const home = within(navigation).getByRole("button", { name: "Início" });
    const inbox = screen.getByRole("button", { name: "Caixa de entrada" });
    const all = within(navigation).getByRole("button", { name: "Tudo" });

    await user.tab();
    expect(home).toHaveFocus();
    await user.tab();
    expect(inbox).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(inbox).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Caixa de entrada" })).toBeInTheDocument();

    await user.tab();
    expect(all).toHaveFocus();
    await user.keyboard(" ");
    expect(all).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Tudo" })).toBeInTheDocument();
  });

  it("keeps every section accessible in the responsive overflow navigation", () => {
    render(<StudioPage />);

    const navigation = screen.getByRole("navigation", { name: "Seções do Estúdio" });
    expect(navigation).not.toHaveAttribute("aria-hidden");
    expect(within(navigation).getAllByRole("button")).toHaveLength(9);
    expect(screen.getByRole("region", { name: "Conteúdo da seção" })).toBeVisible();
    expect(studioStyles).toMatch(/@media \(max-width: 760px\)[\s\S]*overflow-x: auto/);
  });
});
