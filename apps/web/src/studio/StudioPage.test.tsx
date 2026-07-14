import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("opens a recent document with persisted assets, transcript, original, and focused heading", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/studio/home")) {
        return jsonResponse({
          home: {
            recent_documents: [rawDocument], focused_documents: [], pending_review_count: 0, next_rituals: []
          }
        });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) {
        return jsonResponse({ assets: [rawAsset] });
      }
      if (url.endsWith(`/api/studio/assets/${rawAsset.id}/download`)) {
        return jsonResponse({ url: "https://private.example/reflexao.wav", expires_in_seconds: 600 });
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    render(<StudioPage />);

    const documentButtons = await screen.findAllByRole("button", { name: /Reflexão estratégica/u });
    await user.click(documentButtons.at(-1)!);

    const heading = await screen.findByRole("heading", { name: "Reflexão estratégica" });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveFocus();
    expect(await screen.findByText("Escolher uma direção com calma.")).toBeInTheDocument();
    expect(screen.getByTestId("studio-audio-player")).toHaveAttribute("src", "https://private.example/reflexao.wav");
    expect(screen.getByRole("link", { name: "Baixar áudio original" })).toHaveAttribute(
      "href", "https://private.example/reflexao.wav"
    );
  });

  it("does not move focus back to the document heading when persisted assets are retried", async () => {
    const user = userEvent.setup();
    let assetRequests = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/studio/home")) {
        return jsonResponse({
          home: {
            recent_documents: [rawDocument], focused_documents: [], pending_review_count: 0, next_rituals: []
          }
        });
      }
      if (url.endsWith(`/api/studio/documents/${rawDocument.id}/assets`)) {
        assetRequests += 1;
        if (assetRequests === 1) return jsonResponse({ error: { code: "TEMPORARY", message: "retry" } }, 503);
        return new Promise<Response>(() => undefined);
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    });
    render(<StudioPage />);

    const documentButtons = await screen.findAllByRole("button", { name: /Reflexão estratégica/u });
    await user.click(documentButtons.at(-1)!);
    await screen.findByRole("alert");
    const persistentTarget = screen.getByRole("button", { name: "Tudo" });
    persistentTarget.focus();
    expect(persistentTarget).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(assetRequests).toBe(2));
    expect(persistentTarget).toHaveFocus();
  });
});

const rawDocument = {
  id: "document_recent", workspace_id: "workspace_a", owner_profile_id: "profile_owner",
  title: "Reflexão estratégica", body_json: { type: "doc" }, body_text: "Escolher uma direção.",
  revision: 1, capture_mode: "audio", inbox_state: "pending_review", is_focused: false,
  status: "active", created_at: "2026-07-13T12:00:00.000Z",
  updated_at: "2026-07-13T12:01:00.000Z", archived_at: null
} as const;

const rawAsset = {
  id: "asset_recent", workspace_id: "workspace_a", owner_profile_id: "profile_owner",
  document_id: rawDocument.id, idempotency_key: "44444444-4444-4444-8444-444444444444",
  kind: "audio", display_name: "reflexao.wav", source_url: null, final_url: null,
  mime_type: "audio/wav", size_bytes: 52, extraction_status: "ready",
  extracted_text: "Escolher uma direção com calma.", last_error_code: null, attempt_count: 1,
  next_attempt_at: null, created_at: "2026-07-13T12:00:00.000Z",
  updated_at: "2026-07-13T12:01:00.000Z"
} as const;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
