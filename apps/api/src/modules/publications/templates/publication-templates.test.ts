import { describe, expect, it } from "vitest";
import type { CompanyProcess } from "../../processes/process.types";
import type { StudioDocument } from "../../studio/studio.types";
import { processSopHtml } from "./process-sop";
import { studioSheetHtml } from "./studio-sheet";

describe("publication templates", () => {
  it("preserves rich Studio blocks and safe inline marks", () => {
    const html = studioSheetHtml({
      document: studioDocument({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Primeiro parágrafo." }] },
          { type: "paragraph" },
          { type: "paragraph", content: [
            { type: "text", text: "Importante", marks: [{ type: "bold" }] },
            { type: "text", text: " e calmo", marks: [{ type: "italic" }] }
          ] },
          { type: "bulletList", content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Um motivo" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Fonte", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] }] }
          ] }
        ]
      }),
      assets: [], workspaceName: "Holand", authorName: "Yohann"
    });

    expect(html).toContain("<p>Primeiro parágrafo.</p>");
    expect(html).toContain('class="studio-sheet__spacer"');
    expect(html).toContain("<strong>Importante</strong>");
    expect(html).toContain("<em> e calmo</em>");
    expect(html).toContain("<ul>");
    expect(html).toContain('<a href="https://example.com"');
  });

  it("rejects unsafe links and falls back to escaped text", () => {
    const html = studioSheetHtml({
      document: studioDocument({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Não executar", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }]
      }),
      assets: [], workspaceName: "Holand", authorName: "Yohann"
    });
    expect(html).not.toContain("javascript:");
    expect(html).toContain("Não executar");

    const legacy = studioSheetHtml({
      document: { ...studioDocument({}), bodyText: "Um bloco\n\n- Primeiro\n- Segundo" },
      assets: [], workspaceName: "Holand", authorName: "Yohann"
    });
    expect(legacy).toContain("<p>Um bloco</p>");
    expect(legacy).toContain("<li>Primeiro</li>");
  });

  it("renders the operational SOP structure with sequential steps", () => {
    const html = processSopHtml({ process: companyProcess(), workspaceName: "Holand", areaName: "Comercial" });

    expect(html).toContain("sop-foundation__item--objective");
    expect(html).toContain("Padronizar oportunidades");
    expect(html).toContain("sop-step-number\">1<");
    expect(html).toContain("sop-step-number\">2<");
    expect(html).toContain("sop-result");
    expect(html).toContain("Registro criado");
    expect(html).toContain("sop-attention");
    expect(html).toContain("Não deixar no WhatsApp");
  });
});

function studioDocument(bodyJson: Record<string, unknown>): StudioDocument {
  return {
    id: "document_1", workspaceId: "workspace_1", ownerProfileId: "owner_1", captureKey: null,
    title: "Tomando decisões importantes", bodyJson, bodyText: "Texto achatado", revision: 1,
    captureMode: "text", inboxState: "reviewed", isFocused: true, status: "active",
    createdAt: "2026-07-17T12:00:00.000Z", updatedAt: "2026-07-17T12:00:00.000Z", archivedAt: null
  };
}

function companyProcess(): CompanyProcess {
  const body = `Objetivo: Padronizar oportunidades
Gatilho: Novo prospect
Regra operacional: Registrar tudo

1. Abrir registro
Instrução: Cadastre o prospect.
Resultado esperado: Registro criado.
Pontos de atenção:
- Não deixar no WhatsApp.

2. Definir retorno
Instrução: Registre data e responsável.`;
  return {
    id: "process_1", workspaceId: "workspace_1", areaId: null, title: "Registrar oportunidade",
    summary: "Um padrão simples para o comercial.", status: "published", ownerProfileId: null,
    owner: null, materials: [], createdByProfileId: "owner_1", publishedAt: "2026-07-17T12:00:00.000Z",
    archivedAt: null, createdAt: "2026-07-17T12:00:00.000Z", updatedAt: "2026-07-17T12:00:00.000Z",
    currentVersion: {
      id: "version_1", processId: "process_1", workspaceId: "workspace_1", version: 2,
      title: "Registrar oportunidade", body, changeNote: "", editorProfileId: "owner_1",
      createdAt: "2026-07-17T12:00:00.000Z"
    },
    versions: []
  };
}
