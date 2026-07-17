import type { CompanyProcess } from "../../processes/process.types";
import { parseProcessSopBody } from "@prymeira/baase-shared";
import { editorialCss, escapeHtml } from "./editorial.css";

export function processSopHtml(input: { process: CompanyProcess; workspaceName: string; areaName?: string | null }) {
  const process = input.process;
  const parsed = parseProcessSopBody(process.currentVersion.body);
  const materials = (process.materials ?? []).length ? `<section class="materials"><h2>Materiais e referências</h2>${process.materials!.map((material) => `
    <div class="material"><div><strong>${escapeHtml(material.title)}</strong>${material.url ? `<br><small>${escapeHtml(material.url)}</small>` : ""}</div><small>${material.kind === "file" ? "arquivo" : "link"}</small></div>`).join("")}</section>` : "";
  const foundation = [
    parsed.objective ? foundationItem("objective", "Objetivo", parsed.objective) : "",
    parsed.trigger ? foundationItem("trigger", "Gatilho", parsed.trigger) : "",
    parsed.operationalRule ? foundationItem("rule", "Regra operacional", parsed.operationalRule) : ""
  ].filter(Boolean).join("");
  const steps = parsed.steps.map((step, index) => `<article class="sop-step">
    <div class="sop-step__heading"><span class="sop-step-number">${index + 1}</span><div><span class="sop-step__eyebrow">Etapa ${index + 1}</span><h2>${escapeHtml(step.title)}</h2></div></div>
    ${step.instruction ? `<p class="sop-step__instruction">${escapeHtml(step.instruction)}</p>` : ""}
    ${step.expectedResult ? `<section class="sop-result"><span>Resultado esperado</span><p>${escapeHtml(step.expectedResult)}</p></section>` : ""}
    ${step.attentionPoints?.length ? `<section class="sop-attention"><span>Pontos de atenção</span><ul>${step.attentionPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul></section>` : ""}
  </article>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${editorialCss}</style></head><body class="publication publication--sop">
    <header class="masthead"><div class="brand">${escapeHtml(input.workspaceName)}</div><div class="kind">Manual de operação</div></header>
    <section class="sop-opening"><div class="eyebrow">Padrão operacional · versão ${process.currentVersion.version}</div><h1>${escapeHtml(process.title)}</h1>
    ${process.summary ? `<p class="summary">${escapeHtml(process.summary)}</p>` : ""}
    <div class="meta"><span>${escapeHtml(input.areaName ?? "Empresa")}</span><span>Atualizado em ${formatDate(process.updatedAt)}</span></div></section>
    <main>${foundation ? `<section class="sop-foundation">${foundation}</section>` : ""}<section class="sop-flow"><div class="section-heading"><span>Como executar</span><h2>Etapas do processo</h2></div>${steps || '<p class="empty-note">Este processo ainda não possui etapas estruturadas.</p>'}</section>${materials}</main>
    <footer><span>${escapeHtml(input.workspaceName)} · Manual de operação</span><span>Versão ${process.currentVersion.version}</span><span aria-hidden="true"></span></footer>
  </body></html>`;
}

function foundationItem(kind: string, label: string, value: string) {
  return `<article class="sop-foundation__item sop-foundation__item--${kind}"><span>${label}</span><p>${escapeHtml(value)}</p></article>`;
}

const formatDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(value));
