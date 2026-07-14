import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const { studioModuleLoaded } = vi.hoisted(() => ({ studioModuleLoaded: vi.fn() }));

vi.mock("./studio/StudioPage", () => {
  studioModuleLoaded();
  return { default: () => <section>Studio module</section> };
});

describe("Studio lazy access boundary", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    studioModuleLoaded.mockClear();
  });

  it("does not import the Studio module for a manager hashchange", async () => {
    render(<App initialRole="gestor" apiEnabled={false} />);

    window.history.replaceState(null, "", "/#estudio");
    fireEvent(window, new HashChangeEvent("hashchange"));

    await waitFor(() => expect(window.location.hash).toBe("#painel-gestor"));
    expect(screen.getByRole("heading", { name: "Painel da área · Criação" })).toBeInTheDocument();
    expect(studioModuleLoaded).not.toHaveBeenCalled();
  });
});
