import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StudioPage from "./StudioPage";

describe("StudioPage", () => {
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

  it("supports keyboard activation, visible focus hooks, and a responsive shell", () => {
    render(<StudioPage />);

    const inbox = screen.getByRole("button", { name: "Caixa de entrada" });
    expect(inbox).toHaveClass("studio-nav__item");
    inbox.focus();
    fireEvent.keyDown(inbox, { key: "Enter" });
    fireEvent.click(inbox);

    expect(inbox).toHaveFocus();
    expect(inbox).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("studio-layout")).toHaveClass("studio-layout");
    expect(screen.getByRole("region", { name: "Conteúdo da seção" })).toBeInTheDocument();
  });
});
