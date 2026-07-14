import { useEffect, useState } from "react";
import { acceptStudioRelation, getStudioRelatedThoughts } from "./studio-api";
import type { StudioRelatedThought } from "./studio.types";

type Props = { documentId: string; onOpenDocument?(documentId: string): void };

export default function RelatedThoughts({ documentId, onOpenDocument }: Props) {
  const [thoughts, setThoughts] = useState<StudioRelatedThought[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setState("loading");
    void getStudioRelatedThoughts(documentId, controller.signal).then((items) => {
      if (!controller.signal.aborted) { setThoughts(items); setState("ready"); }
    }).catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [documentId, expanded]);

  async function accept(targetId: string) {
    setPending(targetId);
    try {
      await acceptStudioRelation(documentId, targetId);
      setAccepted((current) => new Set(current).add(targetId));
    } finally { setPending(null); }
  }

  return <section className="studio-related" aria-labelledby="studio-related-title">
    <header><div><p className="mono">Memória</p><h3 id="studio-related-title">Pensamentos relacionados</h3></div>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Recolher" : "Encontrar conexões"}</button>
    </header>
    {!expanded ? <p className="studio-related__empty">Conecte ideias que apareceram em momentos diferentes.</p> : null}
    {state === "loading" ? <p role="status">Buscando conexões…</p> : null}
    {state === "error" ? <p className="studio-related__error">As conexões não puderam ser carregadas agora.</p> : null}
    {state === "ready" && !thoughts.length ? <p className="studio-related__empty">As conexões aparecem conforme sua memória no Estúdio cresce.</p> : null}
    {thoughts.map((thought) => <article key={thought.document.id}>
      <button type="button" className="studio-related__open" onClick={() => onOpenDocument?.(thought.document.id)}>
        <strong>{thought.document.title || "Sem título"}</strong><span>{thought.excerpt}</span>
      </button>
      <p>{thought.explanation}</p>
      <button type="button" disabled={pending === thought.document.id || accepted.has(thought.document.id)} onClick={() => void accept(thought.document.id)}>
        {accepted.has(thought.document.id) ? "Conexão aceita" : pending === thought.document.id ? "Conectando…" : "Manter esta conexão"}
      </button>
    </article>)}
  </section>;
}
