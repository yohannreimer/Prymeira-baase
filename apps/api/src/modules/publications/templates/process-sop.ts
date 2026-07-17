import type { CompanyProcess } from "../../processes/process.types";
import { editorialCss, escapeHtml, textToEditorialHtml } from "./editorial.css";

export function processSopHtml(input: { process: CompanyProcess; workspaceName: string; areaName?: string | null }) {
  const process = input.process;
  const materials = (process.materials ?? []).length ? `<section class="materials"><h2>Materiais e referências</h2>${process.materials!.map((material) => `
    <div class="material"><div><strong>${escapeHtml(material.title)}</strong>${material.url ? `<br><small>${escapeHtml(material.url)}</small>` : ""}</div><small>${material.kind === "file" ? "arquivo" : "link"}</small></div>`).join("")}</section>` : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${editorialCss}</style></head><body>
    <header class="masthead"><div class="brand">${escapeHtml(input.workspaceName)}</div><div class="kind">Manual de operação</div></header>
    <h1>${escapeHtml(process.title)}</h1>
    ${process.summary ? `<p class="summary">${escapeHtml(process.summary)}</p>` : ""}
    <div class="meta"><span>Versão ${process.currentVersion.version}</span><span>${escapeHtml(input.areaName ?? "Empresa")}</span><span>${formatDate(process.updatedAt)}</span></div>
    <main>${textToEditorialHtml(process.currentVersion.body)}${materials}</main>
    <footer>${escapeHtml(input.workspaceName)} · Manual de operação · versão ${process.currentVersion.version}</footer>
  </body></html>`;
}

const formatDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(value));
