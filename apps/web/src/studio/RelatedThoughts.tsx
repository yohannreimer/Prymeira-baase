import { useEffect, useRef, useState } from "react";
import { acceptStudioRelation, getStudioRelatedThoughts } from "./studio-api";
import type { StudioDocumentIndexState, StudioRelatedThought } from "./studio.types";

type Props = { documentId: string; onOpenDocument?(documentId: string): void };

export default function RelatedThoughts({ documentId, onOpenDocument }: Props) {
  const [thoughts, setThoughts] = useState<StudioRelatedThought[]>([]);
  const [index, setIndex] = useState<StudioDocumentIndexState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [relationErrors, setRelationErrors] = useState<Map<string, string>>(new Map());
  const [reloadKey, setReloadKey] = useState(0);
  const pendingLocksRef = useRef(new Set<string>());

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    let poll: ReturnType<typeof setTimeout> | undefined;
    setThoughts([]);
    setIndex(null);
    setState("loading");
    void getStudioRelatedThoughts(documentId, controller.signal).then((response) => {
      if (!controller.signal.aborted) {
        setThoughts(response.related);
        setIndex(response.index);
        setState("ready");
        if (response.index.status === "pending" || response.index.status === "processing") {
          poll = setTimeout(() => setReloadKey((key) => key + 1), 2_000);
        }
      }
    }).catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => { controller.abort(); if (poll) clearTimeout(poll); };
  }, [documentId, expanded, reloadKey]);

  useEffect(() => {
    setAccepted(new Set());
    setPendingIds(new Set());
    setRelationErrors(new Map());
    pendingLocksRef.current.clear();
    setIndex(null);
  }, [documentId]);

  async function accept(targetId: string) {
    if (pendingLocksRef.current.has(targetId) || accepted.has(targetId)) return;
    pendingLocksRef.current.add(targetId);
    setPendingIds((current) => new Set(current).add(targetId));
    setRelationErrors((current) => {
      const next = new Map(current);
      next.delete(targetId);
      return next;
    });
    try {
      await acceptStudioRelation(documentId, targetId);
      setAccepted((current) => new Set(current).add(targetId));
    } catch {
      const title = thoughts.find((thought) => thought.document.id === targetId)?.document.title || "este pensamento";
      setRelationErrors((current) => new Map(current).set(targetId, `Não foi possível manter a conexão com ${title}. Nenhuma outra conexão foi afetada.`));
    } finally {
      pendingLocksRef.current.delete(targetId);
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(targetId);
        return next;
      });
    }
  }

  return <section className="studio-related" aria-labelledby="studio-related-title">
    <header><div><p className="mono">Memória</p><h3 id="studio-related-title">Pensamentos relacionados</h3></div>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Recolher" : "Encontrar conexões"}</button>
    </header>
    {!expanded ? <p className="studio-related__empty">Conecte ideias que apareceram em momentos diferentes.</p> : null}
    {state === "loading" ? <p role="status">Buscando conexões…</p> : null}
    {state === "error" ? <div className="studio-related__error" role="alert">
      <p>As conexões não puderam ser carregadas agora.</p>
      <button type="button" onClick={() => setReloadKey((key) => key + 1)}>Tentar novamente</button>
    </div> : null}
    {state === "ready" && index?.status === "pending" ? <p className="studio-related__empty" role="status">Preparando conexões deste pensamento…</p> : null}
    {state === "ready" && index?.status === "processing" ? <p className="studio-related__empty" role="status">Conectando este pensamento à sua memória…</p> : null}
    {state === "ready" && index?.status === "failed" ? <IndexNotice message="As conexões não puderam ser preparadas." onRetry={() => setReloadKey((key) => key + 1)} /> : null}
    {state === "ready" && index?.status === "stale" ? <IndexNotice message="Este pensamento mudou desde a última conexão." onRetry={() => setReloadKey((key) => key + 1)} /> : null}
    {state === "ready" && index?.status === "unavailable" ? <IndexNotice message="As conexões estão indisponíveis neste momento." onRetry={() => setReloadKey((key) => key + 1)} /> : null}
    {state === "ready" && index?.status === "ready" && !thoughts.length ? <p className="studio-related__empty" role="status">Nenhuma conexão encontrada</p> : null}
    {thoughts.map((thought) => <article key={thought.document.id}>
      <button type="button" className="studio-related__open" onClick={() => onOpenDocument?.(thought.document.id)}>
        <strong>{thought.document.title || "Sem título"}</strong><span>{thought.excerpt}</span>
      </button>
      <p>{thought.explanation}</p>
      {relationErrors.has(thought.document.id) ? <div className="studio-related__relation-error" role="alert">
        <p>{relationErrors.get(thought.document.id)}</p>
        <button type="button" onClick={() => void accept(thought.document.id)}>Tentar novamente</button>
      </div> : null}
      <button
        type="button"
        aria-label={accepted.has(thought.document.id)
          ? `Conexão aceita com ${thought.document.title || "Sem título"}`
          : pendingIds.has(thought.document.id)
            ? `Conectando com ${thought.document.title || "Sem título"}`
            : `Manter conexão com ${thought.document.title || "Sem título"}`}
        disabled={pendingIds.has(thought.document.id) || accepted.has(thought.document.id)}
        onClick={() => void accept(thought.document.id)}
      >
        {accepted.has(thought.document.id) ? "Conexão aceita" : pendingIds.has(thought.document.id) ? "Conectando…" : "Manter esta conexão"}
      </button>
    </article>)}
  </section>;
}

function IndexNotice({ message, onRetry }: { message: string; onRetry(): void }) {
  return <div className="studio-related__notice" role="status">
    <p>{message}</p>
    <button type="button" onClick={onRetry}>Tentar novamente</button>
  </div>;
}
