import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudioCopilot from "./StudioCopilot";
import StudioPage from "./StudioPage";
import type { StudioDocument } from "./studio.types";

const studioStyles = readFileSync(resolve(process.cwd(), "src/studio/studio.css"), "utf8");
const studioPageSource = readFileSync(resolve(process.cwd(), "src/studio/StudioPage.tsx"), "utf8");
const proactivityStyles = readFileSync(resolve(process.cwd(), "src/studio/studio-proactivity.css"), "utf8");

describe("Owner Studio accessibility and adaptive quiet ops", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/#estudio");
    installLocalStorage();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      })
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => undefined));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.document.body.style.overflow = "";
  });

  it("exposes named landmarks, ordered headings, and labelled capture controls", () => {
    render(<StudioPage />);

    const studio = screen.getByRole("region", { name: "Estúdio" });
    expect(within(studio).getByRole("navigation", { name: "Seções do Estúdio" })).toBeInTheDocument();
    expect(within(studio).getByRole("region", { name: "Conteúdo da seção" })).toBeInTheDocument();
    expect(within(studio).getByRole("heading", { level: 1, name: "Estúdio" })).toBeInTheDocument();
    expect(within(studio).getByRole("heading", { level: 2, name: "Um espaço para pensar com clareza." })).toBeInTheDocument();
    expect(within(studio).getByRole("form", { name: "Nova captura" })).toBeInTheDocument();
    expect(within(studio).getByRole("textbox", { name: "Registre um pensamento" })).toBeInTheDocument();
  });

  it("moves through the internal navigation with arrows, Home, and End", () => {
    render(<StudioPage />);
    const navigation = screen.getByRole("navigation", { name: "Seções do Estúdio" });
    const home = within(navigation).getByRole("button", { name: "Início" });
    const inbox = within(navigation).getByRole("button", { name: "Entrada" });
    const privacy = within(navigation).getByRole("button", { name: "Privacidade" });

    home.focus();
    fireEvent.keyDown(home, { key: "ArrowDown" });
    expect(inbox).toHaveFocus();
    fireEvent.keyDown(inbox, { key: "End" });
    expect(privacy).toHaveFocus();
    fireEvent.keyDown(privacy, { key: "Home" });
    expect(home).toHaveFocus();
    fireEvent.keyDown(home, { key: "ArrowUp" });
    expect(privacy).toHaveFocus();
  });

  it("contains the mobile copilot sheet and returns focus to its trigger", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(max-width: 1200px)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      })
    });

    render(<StudioCopilot document={studioDocument} onDocumentChange={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Copiloto do Estúdio" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(screen.getByLabelText("O que você quer entender melhor?")).toHaveFocus());
    await user.keyboard("{Escape}");
    const trigger = screen.getByRole("button", { name: "Pensar com a IA" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("announces stream phases once without exposing token deltas as live text", async () => {
    const user = userEvent.setup();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(new ReadableStream({
      start(streamController) { controller = streamController; }
    }), { headers: { "content-type": "text/event-stream" } }));
    render(<StudioCopilot document={studioDocument} onDocumentChange={vi.fn()} />);

    const live = screen.getByRole("status");
    await user.type(screen.getByLabelText("O que você quer entender melhor?"), "Organize este pensamento");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    expect(live).toHaveTextContent("Gerando resposta");

    controller.enqueue(new TextEncoder().encode("event: delta\ndata: {\"text\":\"Primeiro token\"}\n\n"));
    controller.enqueue(new TextEncoder().encode("event: delta\ndata: {\"text\":\" e segundo token\"}\n\n"));
    expect(live).not.toHaveTextContent("token");
    controller.enqueue(new TextEncoder().encode("event: done\ndata: {\"message_id\":\"message_1\"}\n\n"));
    controller.close();
    await waitFor(() => expect(live).toHaveTextContent("Resposta concluída"));
  });

  it("encodes state beyond color and keeps save feedback persistently live", () => {
    render(<StudioPage />);
    expect(screen.getByRole("button", { name: "Início" })).toHaveAttribute("aria-current", "page");
    expect(studioStyles).toMatch(/studio-editor__save-status[\s\S]*data-state/);
    expect(studioStyles).toMatch(/studio-nav__item\[aria-current="page"\]/);
  });

  it("enables motion only when the user has not requested reduced motion", () => {
    expect(studioStyles).toMatch(/@media \(prefers-reduced-motion: no-preference\)[\s\S]*?transition:/);
    expect(studioStyles).not.toMatch(/\.studio-nav__item\s*\{[^}]*transition:/);
    expect(studioStyles).not.toMatch(/\.studio-composer\s*\{[^}]*transition:/);
  });

  it("keeps material feedback out of a page-wide live region", () => {
    expect(studioPageSource).not.toMatch(
      /className="studio-content"[^>]*aria-live=/u
    );
  });

  it("styles document materials as a quiet, wrapping, token-based action strip", () => {
    const strip = cssRule(studioStyles, ".studio-document-assets > section:first-child");
    expect(strip).toMatch(/border-top:\s*1px solid var\(--line\)/u);
    expect(strip).toMatch(/padding:\s*18px 0/u);

    const actions = cssRule(
      studioStyles,
      '.studio-document-assets > section:first-child > [role="group"][aria-busy]'
    );
    expect(actions).toMatch(/display:\s*flex/u);
    expect(actions).toMatch(/flex-wrap:\s*wrap/u);
    expect(actions).toMatch(/gap:\s*8px/u);

    const actionButton = cssRule(
      studioStyles,
      '.studio-document-assets > section:first-child > [role="group"][aria-busy] > button'
    );
    expect(actionButton).toMatch(/min-height:\s*40px/u);
    expect(actionButton).toMatch(/background:\s*var\(--panel\)/u);
    expect(actionButton).toMatch(/border:\s*1px solid var\(--line\)/u);

    const recording = cssRule(
      studioStyles,
      '.studio-document-assets > section:first-child > [role="group"][aria-busy] > button[aria-pressed="true"]'
    );
    expect(recording).toMatch(/background:\s*var\(--accent-bg\)/u);
    expect(recording).toMatch(/color:\s*var\(--accent-ink\)/u);
    expect(studioStyles).toMatch(
      /\.studio-document-assets\s*>\s*section:first-child[\s\S]*?:focus-visible[\s\S]*?outline:\s*2px solid var\(--accent\)/u
    );
    expect(studioStyles).toMatch(
      /@media \(pointer:\s*coarse\)[\s\S]*?\.studio-document-assets\s*>\s*section:first-child[\s\S]*?min-height:\s*44px/u
    );
    expect(studioStyles).toMatch(
      /@media \(max-width:\s*720px\)[\s\S]*?\.studio-document-assets[\s\S]*?min-width:\s*0[\s\S]*?\.studio-document-assets\s*>\s*section:first-child\s*>\s*form/u
    );
    expect(studioStyles).toMatch(
      /@media \(max-width:\s*720px\)[\s\S]*?\.studio-document-assets\s*\{[^}]*max-width:\s*100%[^}]*min-width:\s*0/u
    );
    expect(studioStyles).not.toMatch(
      /\.studio-document-assets[^}]*?(?:linear-gradient|#[0-9a-f]{3,8}|\brgba?\()/iu
    );
  });

  it("keeps proactive signals inside the shared quiet-ops visual system", () => {
    expect(proactivityStyles).not.toMatch(/linear-gradient|#[0-9a-f]{3,8}|\brgba?\(/i);
    expect(proactivityStyles).toMatch(/background:\s*var\(--accent-bg\)/);
    expect(proactivityStyles).toMatch(/border-radius:\s*var\(--studio-panel-radius\)/);
    expect(proactivityStyles).toMatch(/@media \(max-width: 720px\)/);
  });
});

const studioDocument: StudioDocument = {
  id: "document_1",
  workspaceId: "workspace_1",
  ownerProfileId: "owner_1",
  captureKey: null,
  title: "Plano",
  bodyJson: { type: "doc", content: [] },
  bodyText: "Original",
  revision: 1,
  captureMode: "text",
  inboxState: "reviewed",
  isFocused: false,
  status: "active",
  createdAt: "2026-07-14T10:00:00.000Z",
  updatedAt: "2026-07-14T10:00:00.000Z",
  archivedAt: null
};

function installLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, String(value))
    }
  });
}

function cssRule(styles: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "u"));
  expect(match, `missing CSS rule: ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}
