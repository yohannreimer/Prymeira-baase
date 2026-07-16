import { memo, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import {
  addStudioDocumentToCollection,
  archiveStudioDocument,
  listStudioCollections,
  listStudioDocuments,
  removeStudioDocumentFromCollection,
  restoreStudioDocument,
  updateStudioDocument
} from "./studio-api";
import type { StudioCollection, StudioDocument, StudioDocumentPage, StudioDocumentStatus } from "./studio.types";

export type StudioLibraryQuery = {
  status: StudioDocumentStatus;
  inbox_state?: "pending_review" | "reviewed";
  collection_id?: string;
};

type StudioLibraryProps = {
  query: StudioLibraryQuery;
  onOpenDocument(document: StudioDocument): void;
  collections?: StudioCollection[];
  loadDocuments?: (query: { status: StudioDocumentStatus; limit: number; cursor?: string; inbox_state?: "pending_review" | "reviewed"; collection_id?: string }, signal: AbortSignal) => Promise<StudioDocumentPage>;
  loadCollections?: (signal: AbortSignal) => Promise<StudioCollection[]>;
  updateDocument?: typeof defaultUpdateDocument;
  archiveDocument?: typeof archiveStudioDocument;
  restoreDocument?: typeof restoreStudioDocument;
  addMembership?: typeof addStudioDocumentToCollection;
  removeMembership?: typeof removeStudioDocumentFromCollection;
};

type Rollback = { document: StudioDocument; index: number };

const PAGE_SIZE = 30;
const EMPTY_MEMBERSHIPS: string[] = [];
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric" });

export default function StudioLibrary({
  query,
  onOpenDocument,
  collections: sharedCollections,
  loadDocuments = defaultLoadDocuments,
  loadCollections = defaultLoadCollections,
  updateDocument = defaultUpdateDocument,
  archiveDocument = archiveStudioDocument,
  restoreDocument = restoreStudioDocument,
  addMembership = addStudioDocumentToCollection,
  removeMembership = removeStudioDocumentFromCollection
}: StudioLibraryProps) {
  const [documents, setDocuments] = useState<StudioDocument[]>([]);
  const [loadedCollections, setLoadedCollections] = useState<StudioCollection[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [expandedCollectionsId, setExpandedCollectionsId] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Record<string, string[]>>({});
  const [liveMessage, setLiveMessage] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const operationControllers = useRef(new Set<AbortController>());
  const membershipLocks = useRef(new Map<string, number>());
  const membershipActual = useRef(new Map<string, Set<string>>());
  const membershipDesired = useRef(new Map<string, Set<string>>());
  const membershipRevision = useRef(new Map<string, number>());
  const titleRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pendingFocusIndex = useRef<number | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const emptyRef = useRef<HTMLDivElement | null>(null);
  const rowActionsRef = useRef<StudioLibraryRowActions>(undefined!);
  const queryKey = `${query.status}:${query.inbox_state ?? "all"}:${query.collection_id ?? "all"}`;
  const queryGeneration = useRef(0);
  const collections = sharedCollections ?? loadedCollections;

  useEffect(() => {
    const generation = ++queryGeneration.current;
    const controller = new AbortController();
    setLoading(true);
    setLoadingMore(false);
    setLoadError(false);
    setDocuments([]);
    setCursor(null);
    setActiveIndex(0);
    setExpandedCollectionsId(null);
    setConfirmingId(null);
    void loadDocuments({ status: query.status, limit: PAGE_SIZE, inbox_state: query.inbox_state, collection_id: query.collection_id }, controller.signal).then((page) => {
      if (controller.signal.aborted || queryGeneration.current !== generation) return;
      setDocuments(uniqueDocuments(page.items));
      hydrateMemberships(page.collectionsByDocumentId, false);
      setCursor(page.nextCursor);
      setLoading(false);
    }).catch((error: unknown) => {
      if (controller.signal.aborted || queryGeneration.current !== generation || isAbortError(error)) return;
      setLoadError(true);
      setLoading(false);
    });
    return () => controller.abort();
  }, [loadDocuments, query.collection_id, query.inbox_state, query.status, queryKey]);

  useEffect(() => {
    if (sharedCollections) return;
    const controller = new AbortController();
    void loadCollections(controller.signal).then((items) => {
      if (!controller.signal.aborted) setLoadedCollections(items);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [loadCollections, sharedCollections]);

  useEffect(() => () => {
    operationControllers.current.forEach((controller) => controller.abort());
  }, []);

  useEffect(() => () => {
    operationControllers.current.forEach((controller) => controller.abort());
    operationControllers.current.clear();
    membershipLocks.current.clear();
    membershipActual.current.clear();
    membershipDesired.current.clear();
    membershipRevision.current.clear();
  }, [queryKey]);

  const visibleDocuments = useMemo(() => documents, [documents]);

  useEffect(() => {
    if (pendingFocusIndex.current === null) return;
    const index = Math.min(pendingFocusIndex.current, visibleDocuments.length - 1);
    pendingFocusIndex.current = null;
    const frame = window.requestAnimationFrame(() => index < 0 ? emptyRef.current?.focus() : titleRefs.current[index]?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [visibleDocuments]);

  useEffect(() => {
    if (confirmingId) confirmButtonRef.current?.focus();
  }, [confirmingId]);

  async function loadNextPage() {
    if (!cursor || loadingMore) return;
    const generation = queryGeneration.current;
    const controller = trackController(operationControllers.current);
    setLoadingMore(true);
    try {
      const page = await loadDocuments({ status: query.status, limit: PAGE_SIZE, cursor, inbox_state: query.inbox_state, collection_id: query.collection_id }, controller.signal);
      if (controller.signal.aborted || queryGeneration.current !== generation) return;
      setDocuments((current) => uniqueDocuments([...current, ...page.items]));
      hydrateMemberships(page.collectionsByDocumentId, true);
      setCursor(page.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted && queryGeneration.current === generation && !isAbortError(error)) setLiveMessage("Não foi possível carregar mais registros.");
    } finally {
      if (queryGeneration.current === generation) setLoadingMore(false);
      operationControllers.current.delete(controller);
    }
  }

  async function review(document: StudioDocument) {
    const controller = trackController(operationControllers.current);
    try {
      await updateDocument(document.id, { expected_revision: document.revision, inbox_state: "reviewed" }, controller.signal);
      if (controller.signal.aborted) return;
      removeWithFocus(document);
      setLiveMessage(`${document.title || "Documento"} marcado como revisado.`);
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) setLiveMessage("Não foi possível concluir a revisão agora.");
    } finally {
      operationControllers.current.delete(controller);
    }
  }

  async function archive(document: StudioDocument) {
    const rollback = removeOptimistically(document);
    setConfirmingId(null);
    const controller = trackController(operationControllers.current);
    try {
      await archiveDocument(document.id, controller.signal);
      if (!controller.signal.aborted) setLiveMessage(`${document.title || "Documento"} arquivado.`);
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) {
        restoreRollback(rollback);
        setLiveMessage(`Não foi possível arquivar ${document.title || "o documento"}. O registro voltou para a lista.`);
      }
    } finally {
      operationControllers.current.delete(controller);
    }
  }

  async function restore(document: StudioDocument) {
    const rollback = removeOptimistically(document);
    const controller = trackController(operationControllers.current);
    try {
      await restoreDocument(document.id, controller.signal);
      if (!controller.signal.aborted) setLiveMessage(`${document.title || "Documento"} restaurado.`);
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) {
        restoreRollback(rollback);
        setLiveMessage(`Não foi possível restaurar ${document.title || "o documento"}.`);
      }
    } finally {
      operationControllers.current.delete(controller);
    }
  }

  function removeOptimistically(document: StudioDocument): Rollback {
    const index = documents.findIndex((item) => item.id === document.id);
    pendingFocusIndex.current = Math.max(0, index);
    setDocuments((current) => current.filter((item) => item.id !== document.id));
    setActiveIndex((current) => Math.max(0, Math.min(current, visibleDocuments.length - 2)));
    return { document, index };
  }

  function removeWithFocus(document: StudioDocument) {
    const index = documents.findIndex((item) => item.id === document.id);
    pendingFocusIndex.current = Math.max(0, index);
    setDocuments((current) => current.filter((item) => item.id !== document.id));
    setActiveIndex((current) => Math.max(0, Math.min(current, visibleDocuments.length - 2)));
  }

  function restoreRollback({ document, index }: Rollback) {
    pendingFocusIndex.current = Math.max(0, index);
    setDocuments((current) => {
      if (current.some((item) => item.id === document.id)) return current;
      const next = [...current];
      next.splice(Math.max(0, index), 0, document);
      return next;
    });
  }

  async function toggleMembership(documentId: string, collectionId: string, checked: boolean) {
    const generation = queryGeneration.current;
    const desired = new Set(membershipDesired.current.get(documentId) ?? memberships[documentId] ?? []);
    if (checked) desired.add(collectionId);
    else desired.delete(collectionId);
    membershipDesired.current.set(documentId, desired);
    membershipRevision.current.set(documentId, (membershipRevision.current.get(documentId) ?? 0) + 1);
    setMembershipSet(documentId, desired);
    if (membershipLocks.current.get(documentId) === generation) return;
    membershipLocks.current.set(documentId, generation);

    while (queryGeneration.current === generation) {
      const actual = membershipActual.current.get(documentId) ?? new Set<string>();
      const wanted = membershipDesired.current.get(documentId) ?? new Set<string>();
      const addition = firstDifference(wanted, actual);
      const removal = addition ? undefined : firstDifference(actual, wanted);
      const nextCollectionId = addition ?? removal;
      if (!nextCollectionId) break;
      const target = Boolean(addition);
      const requestedRevision = membershipRevision.current.get(documentId) ?? 0;
      const controller = trackController(operationControllers.current);
      try {
        const canonical = target
          ? await addMembership(nextCollectionId, documentId, controller.signal)
          : await removeMembership(nextCollectionId, documentId, controller.signal);
        if (controller.signal.aborted || queryGeneration.current !== generation) break;
        const canonicalIds = new Set(canonical.map((collection) => collection.id));
        membershipActual.current.set(documentId, canonicalIds);
        if ((membershipRevision.current.get(documentId) ?? 0) === requestedRevision) {
          membershipDesired.current.set(documentId, new Set(canonicalIds));
          setMembershipSet(documentId, canonicalIds);
        } else {
          setMembershipSet(documentId, membershipDesired.current.get(documentId) ?? canonicalIds);
        }
        setLiveMessage(target ? "Documento adicionado à coleção." : "Documento removido da coleção.");
      } catch (error) {
        if (!controller.signal.aborted && queryGeneration.current === generation && !isAbortError(error)) {
          const canonical = new Set(membershipActual.current.get(documentId) ?? []);
          membershipDesired.current.set(documentId, canonical);
          membershipRevision.current.set(documentId, (membershipRevision.current.get(documentId) ?? 0) + 1);
          setMembershipSet(documentId, canonical);
          setLiveMessage("Não foi possível atualizar a coleção. A seleção anterior foi restaurada.");
        }
        break;
      } finally {
        operationControllers.current.delete(controller);
      }
    }
    if (membershipLocks.current.get(documentId) === generation) membershipLocks.current.delete(documentId);
  }

  function setMembershipSet(documentId: string, selected: ReadonlySet<string>) {
    setMemberships((current) => {
      return { ...current, [documentId]: Array.from(selected) };
    });
  }

  function hydrateMemberships(context: Record<string, StudioCollection[]>, merge: boolean) {
    if (!merge) {
      membershipActual.current.clear();
      membershipDesired.current.clear();
      membershipRevision.current.clear();
    }
    for (const [documentId, documentCollections] of Object.entries(context)) {
      const ids = new Set(documentCollections.map((collection) => collection.id));
      membershipActual.current.set(documentId, ids);
      membershipDesired.current.set(documentId, new Set(ids));
      membershipRevision.current.set(documentId, 0);
    }
    setMemberships((current) => {
      const next = merge ? { ...current } : {};
      for (const [documentId, documentCollections] of Object.entries(context)) {
        next[documentId] = documentCollections.map((collection) => collection.id);
      }
      return next;
    });
  }

  function moveFocus(current: number, direction: 1 | -1) {
    if (visibleDocuments.length === 0) return;
    const next = (current + direction + visibleDocuments.length) % visibleDocuments.length;
    setActiveIndex(next);
    titleRefs.current[next]?.focus();
  }

  rowActionsRef.current = {
    changeActiveIndex: setActiveIndex,
    open: onOpenDocument,
    moveFocus,
    review,
    restore,
    archive,
    changeConfirming: setConfirmingId,
    changeOrganizing: setExpandedCollectionsId,
    changeMembership: toggleMembership
  };

  return (
    <section className="studio-library" aria-label={query.status === "archived" ? "Documentos arquivados" : query.inbox_state ? "Entrada" : "Biblioteca do Estúdio"}>
      <p className="sr-only" role="status" aria-live="polite">{liveMessage}</p>
      {loading ? <LibrarySkeleton /> : null}
      {loadError ? <p className="studio-library__error" role="alert">Não foi possível abrir seus registros agora.</p> : null}
      {!loading && !loadError && visibleDocuments.length === 0 && !cursor ? (
        <div ref={emptyRef} tabIndex={-1} className="studio-library__empty">
          <i aria-hidden="true" className={`ph-light ${query.status === "archived" ? "ph-archive" : "ph-notebook"}`} />
          <p>{query.status === "archived" ? "Seu arquivo está livre por enquanto." : query.inbox_state ? "Toda captura já foi revisada." : "Seu próximo registro pode começar sem uma categoria."}</p>
        </div>
      ) : null}

      {visibleDocuments.length ? (
        <div className="studio-library__list" role="list">
          {visibleDocuments.map((document, index) => (
            <StudioLibraryRow
              key={document.id}
              document={document}
              index={index}
              active={activeIndex === index}
              isOrganizing={expandedCollectionsId === document.id}
              isConfirming={confirmingId === document.id}
              selectedCollections={memberships[document.id] ?? EMPTY_MEMBERSHIPS}
              collections={collections}
              inbox={Boolean(query.inbox_state)}
              status={query.status}
              titleRefs={titleRefs}
              confirmButtonRef={confirmButtonRef}
              actionsRef={rowActionsRef}
            />
          ))}
        </div>
      ) : null}

      {cursor ? <button className="studio-library__more" type="button" disabled={loadingMore} onClick={() => void loadNextPage()}>{loadingMore ? "Carregando…" : "Carregar mais"}</button> : null}
    </section>
  );
}

type StudioLibraryRowProps = {
  document: StudioDocument;
  index: number;
  active: boolean;
  isOrganizing: boolean;
  isConfirming: boolean;
  selectedCollections: string[];
  collections: StudioCollection[];
  inbox: boolean;
  status: StudioDocumentStatus;
  titleRefs: MutableRefObject<Array<HTMLButtonElement | null>>;
  confirmButtonRef: RefObject<HTMLButtonElement | null>;
  actionsRef: MutableRefObject<StudioLibraryRowActions>;
};

type StudioLibraryRowActions = {
  changeActiveIndex(index: number): void;
  open(document: StudioDocument): void;
  moveFocus(index: number, direction: 1 | -1): void;
  review(document: StudioDocument): Promise<void>;
  restore(document: StudioDocument): Promise<void>;
  archive(document: StudioDocument): Promise<void>;
  changeConfirming(documentId: string | null): void;
  changeOrganizing(documentId: string | null): void;
  changeMembership(documentId: string, collectionId: string, checked: boolean): Promise<void>;
};

const StudioLibraryRow = memo(function StudioLibraryRow({
  document,
  index,
  active,
  isOrganizing,
  isConfirming,
  selectedCollections,
  collections,
  inbox,
  status,
  titleRefs,
  confirmButtonRef,
  actionsRef
}: StudioLibraryRowProps) {
  return (
    <article className="studio-library-row" role="listitem" aria-label={document.title || "Sem título"}>
      <div className="studio-library-row__main">
        <button
          ref={(node) => { titleRefs.current[index] = node; }}
          type="button"
          className="studio-library-row__open"
          tabIndex={active ? 0 : -1}
          onFocus={() => actionsRef.current.changeActiveIndex(index)}
          onClick={() => actionsRef.current.open(document)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); actionsRef.current.moveFocus(index, 1); }
            else if (event.key === "ArrowUp") { event.preventDefault(); actionsRef.current.moveFocus(index, -1); }
          }}
        >
          <span className="studio-library-row__title">{document.title || "Sem título"}</span>
          <span className="studio-library-row__excerpt">{document.bodyText || "Registro sem texto."}</span>
        </button>
        <time dateTime={document.updatedAt}>{formatDate(document.updatedAt)}</time>
      </div>

      <div className="studio-library-row__actions">
        {inbox ? <button type="button" onClick={() => void actionsRef.current.review(document)}>Marcar como revisado</button> : null}
        {status === "active" && collections.length ? (
          <button type="button" aria-expanded={isOrganizing} onClick={() => actionsRef.current.changeOrganizing(isOrganizing ? null : document.id)}>Organizar em coleções</button>
        ) : null}
        {status === "archived" ? (
          <button type="button" onClick={() => void actionsRef.current.restore(document)}>Restaurar</button>
        ) : isConfirming ? (
          <span className="studio-library-row__confirm">
            <span>Arquivar este registro?</span>
            <button ref={confirmButtonRef} type="button" onClick={() => void actionsRef.current.archive(document)}>Confirmar arquivo</button>
            <button type="button" onClick={() => actionsRef.current.changeConfirming(null)}>Cancelar</button>
          </span>
        ) : <button type="button" onClick={() => actionsRef.current.changeConfirming(document.id)}>Arquivar</button>}
      </div>

      {isOrganizing ? (
        <fieldset className="studio-library-row__collections">
          <legend>Coleções</legend>
          {collections.map((collection) => (
            <label key={collection.id}>
              <input
                type="checkbox"
                checked={selectedCollections.includes(collection.id)}
                onChange={(event) => void actionsRef.current.changeMembership(document.id, collection.id, event.target.checked)}
              />
              <span>{collection.name}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
    </article>
  );
}, sameStudioLibraryRow);

function sameStudioLibraryRow(previous: StudioLibraryRowProps, next: StudioLibraryRowProps) {
  return previous.document === next.document
    && previous.index === next.index
    && previous.active === next.active
    && previous.isOrganizing === next.isOrganizing
    && previous.isConfirming === next.isConfirming
    && previous.selectedCollections === next.selectedCollections
    && previous.collections === next.collections
    && previous.inbox === next.inbox
    && previous.status === next.status;
}

function LibrarySkeleton() {
  return <div className="studio-library__skeleton" role="status" aria-label="Carregando registros"><span /><span /><span /></div>;
}

function defaultLoadDocuments(query: { status: StudioDocumentStatus; limit: number; cursor?: string; inbox_state?: "pending_review" | "reviewed"; collection_id?: string }, signal: AbortSignal) {
  return listStudioDocuments(query, fetch, signal);
}

function defaultLoadCollections(signal: AbortSignal) {
  return listStudioCollections(fetch, signal);
}

function defaultUpdateDocument(
  documentId: string,
  input: { expected_revision: number; inbox_state: "reviewed" },
  signal: AbortSignal
) {
  return updateStudioDocument(documentId, input, signal);
}

function uniqueDocuments(documents: StudioDocument[]) {
  const seen = new Set<string>();
  return documents.filter((document) => {
    if (seen.has(document.id)) return false;
    seen.add(document.id);
    return true;
  });
}

function firstDifference(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  for (const value of left) if (!right.has(value)) return value;
  return undefined;
}

function trackController(store: Set<AbortController>) {
  const controller = new AbortController();
  store.add(controller);
  return controller;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
