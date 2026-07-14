import { useEffect, useRef, useState } from "react";
import type { StudioCitation } from "./studio.types";

type Props = {
  citations: StudioCitation[];
  onOpenInternal?(citation: StudioCitation): void;
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
        {citations.map((citation, index) => <li key={`${citation.sourceType}-${citation.sourceId ?? citation.url}-${index}`}>
          {citation.sourceType === "external_url" && citation.url ? <a href={citation.url} target="_blank" rel="noreferrer">
            <strong>{citation.label}</strong><span>Fonte externa · abrir em nova aba</span>
          </a> : <button type="button" onClick={() => onOpenInternal?.(citation)}>
            <strong>{citation.label}</strong><span>{sourceLabel(citation.sourceType)}</span>
          </button>}
          {citation.excerpt ? <p>{citation.excerpt}</p> : null}
          <small>{citation.periodFrom && citation.periodTo ? `${citation.periodFrom} — ${citation.periodTo} · ` : ""}consultado em {formatDate(citation.observedAt)}</small>
        </li>)}
      </ol>
    </aside> : null}
  </div>;
}

function sourceLabel(type: StudioCitation["sourceType"]) {
  const labels: Partial<Record<StudioCitation["sourceType"], string>> = {
    dashboard: "Painel operacional", task: "Tarefa", routine: "Rotina", process: "Processo",
    training: "Treinamento", announcement: "Comunicado", people: "Pessoa", studio_document: "Documento do Estúdio"
  };
  return labels[type] ?? "Fonte interna";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
  }).format(date);
}
