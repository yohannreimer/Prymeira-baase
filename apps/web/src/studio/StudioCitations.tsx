import { useEffect, useRef, useState } from "react";
import { studioCitationInternalTarget } from "./studio-api";
import type { StudioCitation, StudioInternalCitationTarget } from "./studio.types";

type Props = {
  citations: StudioCitation[];
  onOpenInternal?(target: StudioInternalCitationTarget, citation: StudioCitation): void;
};

export default function StudioCitations({ citations, onOpenInternal }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        queueMicrotask(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);

  if (!citations.length) return null;
  return <div className="studio-citations">
    <button ref={triggerRef} type="button" aria-expanded={open} aria-controls="studio-citation-drawer" onClick={() => setOpen(true)}>
      <i className="ph-light ph-books" aria-hidden="true" /> {citations.length} {citations.length === 1 ? "fonte" : "fontes"}
    </button>
    {open ? <aside id="studio-citation-drawer" aria-label="Fontes da resposta" className="studio-citations__drawer">
      <header>
        <div><p className="mono">Rastreabilidade</p><h3>Fontes consultadas</h3></div>
        <button ref={closeRef} type="button" aria-label="Fechar fontes" onClick={() => {
          setOpen(false);
          queueMicrotask(() => triggerRef.current?.focus());
        }}><i className="ph-light ph-x" aria-hidden="true" /></button>
      </header>
      <ol>
        {citations.map((citation, index) => {
          const target = studioCitationInternalTarget(citation);
          const externalUrl = citation.sourceType === "external_url" ? safeExternalUrl(citation.url) : null;
          return <li key={`${citation.sourceType}-${citation.sourceId ?? citation.url}-${index}`}>
          {externalUrl ? <a href={externalUrl} target="_blank" rel="noreferrer">
            <strong>{citation.label}</strong><span>Fonte externa · abrir em nova aba</span>
          </a> : target ? <button type="button" onClick={() => onOpenInternal?.(target, citation)}>
            <strong>{citation.label}</strong><span>{sourceLabel(target.kind)}</span>
          </button> : <div className="studio-citations__unavailable" aria-disabled="true">
            <strong>{citation.label}</strong><span>Fonte sem navegação disponível</span>
          </div>}
          {citation.excerpt ? <p>{citation.excerpt}</p> : null}
          <small>{citation.periodFrom && citation.periodTo ? `${citation.periodFrom} — ${citation.periodTo} · ` : ""}consultado em {formatDate(citation.observedAt)}</small>
        </li>})}
      </ol>
    </aside> : null}
  </div>;
}

function sourceLabel(type: StudioInternalCitationTarget["kind"]) {
  const labels: Record<StudioInternalCitationTarget["kind"], string> = {
    dashboard: "Painel operacional", task: "Tarefa", routine: "Rotina", process: "Processo",
    training: "Treinamento", announcement: "Comunicado", person: "Pessoa", studio_document: "Documento do Estúdio"
  };
  return labels[type];
}

function safeExternalUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
  }).format(date);
}
