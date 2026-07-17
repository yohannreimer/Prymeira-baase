import type { StudioAsset, StudioDocument } from "../../studio/studio.types";
import { editorialCss, escapeHtml, textToEditorialHtml } from "./editorial.css";
import { tiptapDocumentToHtml } from "./tiptap-html";

export function studioSheetHtml(input: { document: StudioDocument; assets: StudioAsset[]; workspaceName: string; authorName: string }) {
  const title = input.document.title?.trim() || "Folha sem título";
  const richBody = tiptapDocumentToHtml(input.document.bodyJson);
  const body = richBody?.trim() ? richBody : textToEditorialHtml(input.document.bodyText);
  const materials = input.assets.length ? `<section class="materials"><h2>Materiais</h2>${input.assets.map((asset) => `
    <div class="material"><div><strong>${escapeHtml(asset.displayName)}</strong><br><small>${escapeHtml(asset.mimeType ?? asset.kind)}</small></div>
    <small>${asset.sizeBytes ? `${Math.ceil(asset.sizeBytes / 1024)} KB` : "referência"}</small></div>`).join("")}</section>` : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${editorialCss}</style></head><body class="publication publication--studio">
    <header class="masthead"><div><div class="brand">${escapeHtml(input.workspaceName)}</div><div class="eyebrow">Privado para você</div></div><div class="kind">Estúdio · Folha</div></header>
    <section class="studio-sheet__opening"><h1>${escapeHtml(title)}</h1>
    <div class="meta"><span>Por ${escapeHtml(input.authorName)}</span><span>Atualizada em ${formatDate(input.document.updatedAt)}</span></div></section>
    <main class="studio-sheet__body">${body}${materials}</main>
    <footer><span>${escapeHtml(input.workspaceName)} · Estúdio</span><span>Documento privado</span><span aria-hidden="true"></span></footer>
  </body></html>`;
}

const formatDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(value));
