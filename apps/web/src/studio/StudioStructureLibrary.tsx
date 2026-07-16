import { useEffect, useMemo, useRef, useState } from "react";
import { listStudioStructures } from "./studio-api";
import type { StudioStructure, StudioStructureKind } from "./studio.types";

type LibraryKind = Exclude<StudioStructureKind, "ritual">;

type StudioStructureLibraryProps = {
  kind: LibraryKind;
  onOpenDocument(documentId: string): void;
};

type LibraryState = "loading" | "ready" | "error";
type SortMode = "updated" | "created" | "horizon";

const PAGE_SIZE = 30;
const calendarDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC"
});

const COPY: Record<LibraryKind, {
  title: string;
  singular: string;
  plural: string;
  icon: string;
  empty: string;
}> = {
  goal: { title: "Metas", singular: "meta", plural: "metas", icon: "ph-target", empty: "Nenhuma meta organizada ainda." },
  decision: { title: "Decisões", singular: "decisão", plural: "decisões", icon: "ph-signpost", empty: "Nenhuma decisão organizada ainda." },
  plan: { title: "Planos", singular: "plano", plural: "planos", icon: "ph-map-trifold", empty: "Nenhum plano organizado ainda." }
};

export default function StudioStructureLibrary({ kind, onOpenDocument }: StudioStructureLibraryProps) {
  const copy = COPY[kind];
  const [items, setItems] = useState<StudioStructure[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<LibraryState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortMode>("updated");
  const [reloadKey, setReloadKey] = useState(0);
  const generationRef = useRef(0);
  const paginationControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++generationRef.current;
    paginationControllerRef.current?.abort();
    paginationControllerRef.current = null;
    setItems([]);
    setNextCursor(null);
    setState("loading");
    setLoadingMore(false);
    setPageError(false);
    setSearch("");
    setStatus("all");

    void listStudioStructures(
      { kind, lifecycle_status: "active", limit: PAGE_SIZE },
      fetch,
      controller.signal
    ).then((page) => {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      setItems(uniqueStructures(page.items));
      setNextCursor(page.nextCursor);
      setState("ready");
    }).catch(() => {
      if (!controller.signal.aborted && generationRef.current === generation) setState("error");
    });

    return () => controller.abort();
  }, [kind, reloadKey]);

  useEffect(() => () => paginationControllerRef.current?.abort(), []);

  const statusOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const item of items) {
      const derived = structureStatus(item);
      options.set(derived.key, derived.label);
    }
    return [...options].map(([value, label]) => ({ value, label }));
  }, [items]);

  useEffect(() => {
    if (status !== "all" && !statusOptions.some((option) => option.value === status)) setStatus("all");
  }, [status, statusOptions]);

  const visibleItems = useMemo(() => {
    const normalizedSearch = normalize(search);
    return items
      .filter((item) => !normalizedSearch || normalize(item.documentTitle || "").includes(normalizedSearch))
      .filter((item) => status === "all" || structureStatus(item).key === status)
      .sort(structureSorter(sort));
  }, [items, search, sort, status]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    paginationControllerRef.current?.abort();
    const controller = new AbortController();
    paginationControllerRef.current = controller;
    const generation = generationRef.current;
    const cursor = nextCursor;
    setLoadingMore(true);
    setPageError(false);
    try {
      const page = await listStudioStructures(
        { kind, lifecycle_status: "active", limit: PAGE_SIZE, cursor },
        fetch,
        controller.signal
      );
      if (controller.signal.aborted || generationRef.current !== generation) return;
      setItems((current) => uniqueStructures([...current, ...page.items]));
      setNextCursor(page.nextCursor);
    } catch {
      if (!controller.signal.aborted && generationRef.current === generation) setPageError(true);
    } finally {
      if (!controller.signal.aborted && generationRef.current === generation) setLoadingMore(false);
      if (paginationControllerRef.current === controller) paginationControllerRef.current = null;
    }
  }

  return (
    <section className="studio-structure-library" aria-labelledby={`studio-${kind}-library-title`}>
      <header className="studio-structure-library__header">
        <div>
          <p className="mono">Biblioteca privada</p>
          <h2 id={`studio-${kind}-library-title`} className="serif">{copy.title}</h2>
        </div>
        {state === "ready" ? <p aria-label={`${items.length} ${items.length === 1 ? copy.singular : copy.plural} carregados`}>{items.length} {items.length === 1 ? copy.singular : copy.plural}</p> : null}
      </header>

      {state === "loading" ? <LibrarySkeleton plural={copy.plural} /> : null}

      {state === "error" ? (
        <div className="studio-structure-library__message" role="alert">
          <i aria-hidden="true" className="ph-light ph-cloud-slash" />
          <div>
            <strong>Não foi possível buscar suas {copy.plural} agora.</strong>
            <p>Seus documentos continuam seguros no Estúdio.</p>
            <button type="button" onClick={() => setReloadKey((key) => key + 1)}>Tentar novamente</button>
          </div>
        </div>
      ) : null}

      {state === "ready" && items.length === 0 ? (
        <div className="studio-structure-library__message studio-structure-library__message--empty">
          <i aria-hidden="true" className={`ph-light ${copy.icon}`} />
          <div>
            <strong>{copy.empty}</strong>
            <p>Dê forma a um documento para encontrá-lo aqui, sem duplicar sua escrita.</p>
          </div>
        </div>
      ) : null}

      {state === "ready" && items.length > 0 ? (
        <>
          <div className="studio-structure-library__tools">
            <label className="studio-structure-library__search">
              <span className="sr-only">Buscar {copy.plural} por título</span>
              <i aria-hidden="true" className="ph-light ph-magnifying-glass" />
              <input
                type="search"
                aria-label={`Buscar ${copy.plural} por título`}
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Buscar por título"
              />
            </label>
            <label>
              <span>Estado</span>
              <select aria-label={`Filtrar ${copy.plural} por estado`} value={status} onChange={(event) => setStatus(event.currentTarget.value)}>
                <option value="all">Todos</option>
                {statusOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span>Ordenar</span>
              <select aria-label={`Ordenar ${copy.plural}`} value={sort} onChange={(event) => setSort(event.currentTarget.value as SortMode)}>
                <option value="updated">Atualização recente</option>
                <option value="created">Criação recente</option>
                <option value="horizon">Horizonte próximo</option>
              </select>
            </label>
          </div>

          {visibleItems.length ? (
            <ul className="studio-structure-library__list" aria-label={`${copy.title} organizadas`}>
              {visibleItems.map((item) => <StructureRow item={item} onOpenDocument={onOpenDocument} key={item.id} />)}
            </ul>
          ) : (
            <div className="studio-structure-library__no-results" role="status">
              <strong>Nenhum resultado com estes filtros.</strong>
              <button type="button" onClick={() => { setSearch(""); setStatus("all"); }}>Limpar filtros</button>
            </div>
          )}

          {nextCursor ? (
            <div className="studio-structure-library__pagination">
              {pageError ? <p role="alert">A próxima página não carregou. Você pode tentar novamente.</p> : null}
              <button type="button" disabled={loadingMore} onClick={() => void loadMore()} aria-label={`Carregar mais ${copy.plural}`}>
                {loadingMore ? "Carregando…" : `Carregar mais ${copy.plural}`}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function StructureRow({ item, onOpenDocument }: { item: StudioStructure; onOpenDocument(documentId: string): void }) {
  const title = item.documentTitle?.trim() || "Pensamento sem título";
  const summary = structureSummary(item);
  const status = structureStatus(item);
  const relevantDate = structureRelevantDate(item);
  return (
    <li aria-label={title}>
      <button type="button" aria-label={`Abrir ${title}`} onClick={() => onOpenDocument(item.documentId)}>
        <span className="studio-structure-library__row-main">
          <strong>{title}</strong>
          {summary ? <span>{summary}</span> : null}
        </span>
        <span className="studio-structure-library__row-meta">
          <span className="studio-structure-library__status"><i aria-hidden="true" />{status.label}</span>
          {relevantDate ? <time dateTime={relevantDate.value}>{relevantDate.label}</time> : null}
          <i aria-hidden="true" className="ph-light ph-arrow-up-right" />
        </span>
      </button>
    </li>
  );
}

function LibrarySkeleton({ plural }: { plural: string }) {
  return (
    <div className="studio-structure-library__skeleton" role="status" aria-label={`Carregando ${plural}`}>
      <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
    </div>
  );
}

function structureSummary(item: StudioStructure) {
  const properties = item.propertiesJson;
  const candidates = item.kind === "goal"
    ? [properties.desired_outcome, properties.reason]
    : item.kind === "decision"
      ? [properties.decision, properties.context]
      : [properties.direction];
  return candidates.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim() ?? null;
}

function structureStatus(item: StudioStructure): { key: string; label: string } {
  if (item.kind === "goal") {
    const state = typeof item.propertiesJson.state === "string" ? item.propertiesJson.state : "";
    if (state === "in_focus") return { key: state, label: "Em foco" };
    if (state === "waiting") return { key: state, label: "Em espera" };
    if (state === "achieved") return { key: state, label: "Alcançada" };
    return { key: "open", label: "Em aberto" };
  }
  if (item.kind === "decision") {
    const learnings = item.propertiesJson.learnings;
    if (typeof learnings === "string" && learnings.trim()) return { key: "reviewed", label: "Revista" };
    if (typeof item.propertiesJson.review_date === "string" && item.propertiesJson.review_date) return { key: "review_scheduled", label: "Revisão marcada" };
    return { key: "recorded", label: "Registrada" };
  }
  const fronts = safeStringList(item.propertiesJson.fronts);
  const milestones = safeStringList(item.propertiesJson.milestones);
  return fronts.length || milestones.length
    ? { key: "structured", label: "Estruturado" }
    : { key: "draft", label: "Em definição" };
}

function structureRelevantDate(item: StudioStructure): { value: string; label: string } | null {
  const reviewDate = typeof item.propertiesJson.review_date === "string" ? item.propertiesJson.review_date : null;
  const decisionDate = typeof item.propertiesJson.decision_date === "string" ? item.propertiesJson.decision_date : null;
  const candidate = item.kind === "decision" ? reviewDate ?? item.horizonAt ?? decisionDate : item.horizonAt;
  if (!candidate) return null;
  const formatted = formatStudioCalendarDate(candidate);
  if (!formatted) return null;
  let prefix = "Horizonte";
  if (item.kind === "decision") prefix = reviewDate || item.horizonAt ? "Revisar" : "Decidida";
  return { value: candidate.slice(0, 10), label: `${prefix} ${formatted}` };
}

export function formatStudioCalendarDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return calendarDateFormatter.format(date);
}

function safeStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function uniqueStructures(items: StudioStructure[]) {
  const unique = new Map<string, StudioStructure>();
  for (const item of items) if (!unique.has(item.id)) unique.set(item.id, item);
  return [...unique.values()];
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("pt-BR").trim();
}

function structureSorter(mode: SortMode) {
  return (left: StudioStructure, right: StudioStructure) => {
    if (mode === "horizon") {
      const leftTime = relevantTimestamp(left);
      const rightTime = relevantTimestamp(right);
      if (leftTime !== rightTime) return leftTime - rightTime;
    }
    const key = mode === "created" ? "createdAt" : "updatedAt";
    return safeTimestamp(right[key]) - safeTimestamp(left[key]) || left.id.localeCompare(right.id);
  };
}

function relevantTimestamp(item: StudioStructure) {
  const relevant = structureRelevantDate(item)?.value;
  return relevant ? safeTimestamp(relevant, Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
}

function safeTimestamp(value: string, fallback = 0) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? fallback : timestamp;
}
