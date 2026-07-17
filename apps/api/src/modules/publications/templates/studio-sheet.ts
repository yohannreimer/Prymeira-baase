import type { StudioAsset, StudioDocument } from "../../studio/studio.types";
import { editorialCss, escapeHtml, textToEditorialHtml } from "./editorial.css";

export function studioSheetHtml(input: { document: StudioDocument; assets: StudioAsset[]; workspaceName: string; authorName: string }) {
  const title = input.document.title?.trim() || "Folha sem título";
  const materials = input.assets.length ? `<section class="materials"><h2>Materiais</h2>${input.assets.map((asset) => `
    <div class="material"><div><strong>${escapeHtml(asset.displayName)}</strong><br><small>${escapeHtml(asset.mimeType ?? asset.kind)}</small></div>
    <small>${asset.sizeBytes ? `${Math.ceil(asset.sizeBytes / 1024)} KB` : "referência"}</small></div>`).join("")}</section>` : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${editorialCss}</style></head><body>
    <header class="masthead"><div class="brand">${escapeHtml(input.workspaceName)}</div><div class="kind">Estúdio · Folha</div></header>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta"><span>Por ${escapeHtml(input.authorName)}</span><span>Atualizada em ${formatDate(input.document.updatedAt)}</span></div>
    <main>${textToEditorialHtml(input.document.bodyText)}${materials}</main>
    <footer>${escapeHtml(input.workspaceName)} · Documento privado exportado pelo Estúdio</footer>
  </body></html>`;
}

const formatDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(value));
