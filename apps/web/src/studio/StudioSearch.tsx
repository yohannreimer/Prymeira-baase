import { useEffect, useRef, useState } from "react";
import { searchStudioDocuments as requestStudioSearch } from "./studio-api";
import type { StudioSearchResult } from "./studio.types";

export type StudioSearchAnalyticsEvent = {
  event: "studio_search_completed";
  queryLength: number;
  resultCount: number;
  status: "success" | "empty";
};

type StudioSearchProps = {
  searchDocuments?: (query: string, limit: number, signal: AbortSignal) => Promise<StudioSearchResult[]>;
  onOpenDocument(documentId: string): void;
  onAnalytics?(event: StudioSearchAnalyticsEvent): void;
  debounceMs?: number;
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric" });

export default function StudioSearch({
  searchDocuments = defaultSearch,
  onOpenDocument,
  onAnalytics,
  debounceMs = 300
}: StudioSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudioSearchResult[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [activeIndex, setActiveIndex] = useState(0);
  const requestSequence = useRef(0);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const trimmed = query.trim();
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    if (!trimmed) {
      setResults([]);
      setState("idle");
      return () => controller.abort();
    }

    setState("loading");
    setResults([]);
    const timeout = window.setTimeout(() => {
      void searchDocuments(trimmed, 20, controller.signal).then((nextResults) => {
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        setResults(nextResults);
        setActiveIndex(0);
        setState("ready");
        onAnalytics?.({
          event: "studio_search_completed",
          queryLength: trimmed.length,
          resultCount: nextResults.length,
          status: nextResults.length ? "success" : "empty"
        });
      }).catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error) || sequence !== requestSequence.current) return;
        setResults([]);
        setState("error");
      });
    }, debounceMs);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [debounceMs, onAnalytics, query, searchDocuments]);

  function moveFocus(current: number, direction: 1 | -1) {
    if (results.length === 0) return;
    const next = (current + direction + results.length) % results.length;
    setActiveIndex(next);
    resultRefs.current[next]?.focus();
  }

  return (
    <section className="studio-search" aria-label="Busca no Estúdio">
      <label className="studio-search__field">
        <i aria-hidden="true" className="ph-light ph-magnifying-glass" />
        <span className="sr-only">Buscar no Estúdio</span>
        <input
          type="search"
          aria-label="Buscar no Estúdio"
          placeholder="Buscar uma ideia, decisão ou trecho"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="studio-search__feedback" aria-live="polite">
        {state === "idle" ? <p>Busque uma ideia, decisão ou trecho que você lembra.</p> : null}
        {state === "loading" ? <p role="status">Procurando nos seus registros…</p> : null}
        {state === "ready" && results.length === 0 ? <p>Nenhum registro corresponde a esta busca.</p> : null}
        {state === "error" ? <p role="alert">A busca não respondeu agora. Tente novamente em instantes.</p> : null}
      </div>

      {results.length ? (
        <div className="studio-search__results" role="list" aria-label="Resultados da busca">
          {results.map((result, index) => (
            <div role="listitem" key={result.documentId}>
              <button
                ref={(node) => { resultRefs.current[index] = node; }}
                type="button"
                className="studio-search-result"
                tabIndex={activeIndex === index ? 0 : -1}
                aria-label={`${result.title || "Sem título"}. ${result.excerpt}`}
                onClick={() => onOpenDocument(result.documentId)}
                onFocus={() => setActiveIndex(index)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveFocus(index, 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveFocus(index, -1);
                  }
                }}
              >
                <span className="studio-search-result__title">{result.title || "Sem título"}</span>
                <span className="studio-search-result__excerpt">{result.excerpt}</span>
                <span className="studio-search-result__meta">
                  <time dateTime={result.updatedAt}>{formatDate(result.updatedAt)}</time>
                  <span aria-hidden="true">·</span>
                  <span>{searchContext(result)}</span>
                </span>
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function defaultSearch(query: string, limit: number, signal: AbortSignal) {
  return requestStudioSearch(query, limit, fetch, signal);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function searchContext(result: StudioSearchResult) {
  const structureLabels = (result.structures ?? []).map((kind) => ({
    goal: "Meta", decision: "Decisão", plan: "Plano", ritual: "Ritual"
  })[kind]);
  return [...result.collections.map((collection) => collection.name), ...structureLabels].join(", ") || "Documento livre";
}
