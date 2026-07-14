import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import RelatedThoughts from "./RelatedThoughts";

describe("RelatedThoughts", () => {
  it("explains, opens and persists an owner-approved relation", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const requests: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/related")) return json({ related: [{
        document: rawDocument(), excerpt: "Tema de expansão", score: 0.82,
        explanation: "Explora uma ideia próxima, mesmo usando palavras diferentes."
      }] });
      return json({ id: "relation_1" });
    });
    render(<RelatedThoughts documentId="source" onOpenDocument={open} />);
    expect(requests).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Encontrar conexões" }));
    expect(await screen.findByText(/explora uma ideia próxima/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /documento relacionado/i }));
    expect(open).toHaveBeenCalledWith("related");
    await user.click(screen.getByRole("button", { name: "Manter esta conexão" }));
    expect(await screen.findByRole("button", { name: "Conexão aceita" })).toBeDisabled();
    expect(requests.at(-1)).toContain("/documents/source/relations");
  });
});

function rawDocument() { return {
  id: "related", workspace_id: "workspace", owner_profile_id: "owner", capture_key: null,
  title: "Documento relacionado", body_json: {}, body_text: "Tema de expansão", revision: 1,
  capture_mode: "text", inbox_state: "reviewed", is_focused: false, status: "active",
  created_at: "2026-07-14T10:00:00.000Z", updated_at: "2026-07-14T10:00:00.000Z", archived_at: null
}; }
function json(value: unknown) { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
