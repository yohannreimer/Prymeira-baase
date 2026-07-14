import { useEffect, useMemo, useRef, useState } from "react";
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
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric" });

export default function StudioLibrary({
  query,
  onOpenDocument,
  loadDocuments = defaultLoadDocuments,
  loadCollections = defaultLoadCollections,
  updateDocument = defaultUpdateDocument,
  archiveDocument = archiveStudioDocument,
  restoreDocument = restoreStudioDocument,
  addMembership = addStudioDocumentToCollection,
  removeMembership = removeStudioDocumentFromCollection
}: StudioLibraryProps) {
  const [documents, setDocuments] = useState<StudioDocument[]>([]);
  const [collections, setCollections] = useState<StudioCollection[]>([]);
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
  const membershipLocks = useRef(new Set<string>());
  const membershipActual = useRef(new Map<string, boolean>());
  const membershipDesired = useRef(new Map<string, boolean>());
  const titleRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pendingFocusIndex = useRef<number | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const emptyRef = useRef<HTMLDivElement | null>(null);
  const queryKey = `${query.status}:${query.inbox_state ?? "all"}:${query.collection_id ?? "all"}`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    setDocuments([]);
    setCursor(null);
    setActiveIndex(0);
    void loadDocuments({ status: query.status, limit: PAGE_SIZE, inbox_state: query.inbox_state, collection_id: query.collection_id }, controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      setDocuments(uniqueDocuments(page.items));
      hydrateMemberships(page.collectionsByDocumentId, false);
      setCursor(page.nextCursor);
      setLoading(false);
    }).catch((error: unknown) => {
      if (controller.signal.aborted || isAbortError(error)) return;
      setLoadError(true);
      setLoading(false);
    });
    return () => controller.abort();
  }, [loadDocuments, query.collection_id, query.inbox_state, query.status, queryKey]);

  useEffect(() => {
    const controller = new AbortController();
    void loadCollections(controller.signal).then((items) => {
      if (!controller.signal.aborted) setCollections(items);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [loadCollections]);

  useEffect(() => () => {
    operationControllers.current.forEach((controller) => controller.abort());
  }, []);

  useEffect(() => () => {
    operationControllers.current.forEach((controller) => controller.abort());
    operationControllers.current.clear();
    membershipLocks.current.clear();
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
    const controller = trackController(operationControllers.current);
    setLoadingMore(true);
    try {
      const page = await loadDocuments({ status: query.status, limit: PAGE_SIZE, cursor, inbox_state: query.inbox_state, collection_id: query.collection_id }, controller.signal);
      if (controller.signal.aborted) return;
      setDocuments((current) => uniqueDocuments([...current, ...page.items]));
      hydrateMemberships(page.collectionsByDocumentId, true);
      setCursor(page.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) setLiveMessage("Não foi possível carregar mais registros.");
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
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
    removeOptimistically(document);
    const controller = trackController(operationControllers.current);
    try {
      await restoreDocument(document.id, controller.signal);
      if (!controller.signal.aborted) setLiveMessage(`${document.title || "Documento"} restaurado.`);
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) {
        setDocuments((current) => uniqueDocuments([...current, document]));
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
    const lockKey = `${documentId}:${collectionId}`;
    membershipDesired.current.set(lockKey, checked);
    setMembershipValue(documentId, collectionId, checked);
    if (membershipLocks.current.has(lockKey)) return;
    membershipLocks.current.add(lockKey);
    while (membershipActual.current.get(lockKey) !== membershipDesired.current.get(lockKey)) {
      const target = membershipDesired.current.get(lockKey) ?? false;
      const controller = trackController(operationControllers.current);
      try {
        if (target) await addMembership(collectionId, documentId, controller.signal);
        else await removeMembership(collectionId, documentId, controller.signal);
        if (controller.signal.aborted) break;
        membershipActual.current.set(lockKey, target);
        setLiveMessage(target ? "Documento adicionado à coleção." : "Documento removido da coleção.");
      } catch (error) {
        if (!controller.signal.aborted && !isAbortError(error)) {
          const actual = membershipActual.current.get(lockKey) ?? false;
          membershipDesired.current.set(lockKey, actual);
          setMembershipValue(documentId, collectionId, actual);
          setLiveMessage("Não foi possível atualizar a coleção. A seleção anterior foi restaurada.");
        }
        break;
      } finally {
        operationControllers.current.delete(controller);
      }
    }
    membershipLocks.current.delete(lockKey);
  }

  function setMembershipValue(documentId: string, collectionId: string, checked: boolean) {
    setMemberships((current) => {
      const previous = current[documentId] ?? [];
      const next = checked ? Array.from(new Set([...previous, collectionId])) : previous.filter((id) => id !== collectionId);
      return { ...current, [documentId]: next };
    });
  }

  function hydrateMemberships(context: Record<string, StudioCollection[]>, merge: boolean) {
    if (!merge) {
      membershipActual.current.clear();
      membershipDesired.current.clear();
    }
    for (const [documentId, documentCollections] of Object.entries(context)) {
      for (const collection of documentCollections) {
        const key = `${documentId}:${collection.id}`;
        membershipActual.current.set(key, true);
        membershipDesired.current.set(key, true);
      }
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
          {visibleDocuments.map((document, index) => {
            const isOrganizing = expandedCollectionsId === document.id;
            const selectedCollections = memberships[document.id] ?? [];
            return (
              <article className="studio-library-row" role="listitem" aria-label={document.title || "Sem título"} key={document.id}>
                <div className="studio-library-row__main">
                  <button
                    ref={(node) => { titleRefs.current[index] = node; }}
                    type="button"
                    className="studio-library-row__open"
                    tabIndex={activeIndex === index ? 0 : -1}
                    onFocus={() => setActiveIndex(index)}
                    onClick={() => onOpenDocument(document)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(index, 1); }
                      else if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(index, -1); }
                    }}
                  >
                    <span className="studio-library-row__title">{document.title || "Sem título"}</span>
                    <span className="studio-library-row__excerpt">{document.bodyText || "Registro sem texto."}</span>
                  </button>
                  <time dateTime={document.updatedAt}>{formatDate(document.updatedAt)}</time>
                </div>

                <div className="studio-library-row__actions">
                  {query.inbox_state ? <button type="button" onClick={() => void review(document)}>Marcar como revisado</button> : null}
                  {query.status === "active" && collections.length ? (
                    <button type="button" aria-expanded={isOrganizing} onClick={() => setExpandedCollectionsId(isOrganizing ? null : document.id)}>Organizar em coleções</button>
                  ) : null}
                  {query.status === "archived" ? (
                    <button type="button" onClick={() => void restore(document)}>Restaurar</button>
                  ) : confirmingId === document.id ? (
                    <span className="studio-library-row__confirm">
                      <span>Arquivar este registro?</span>
                      <button ref={confirmButtonRef} type="button" onClick={() => void archive(document)}>Confirmar arquivo</button>
                      <button type="button" onClick={() => setConfirmingId(null)}>Cancelar</button>
                    </span>
                  ) : <button type="button" onClick={() => setConfirmingId(document.id)}>Arquivar</button>}
                </div>

                {isOrganizing ? (
                  <fieldset className="studio-library-row__collections">
                    <legend>Coleções</legend>
                    {collections.map((collection) => (
                      <label key={collection.id}>
                        <input
                          type="checkbox"
                          checked={selectedCollections.includes(collection.id)}
                          onChange={(event) => void toggleMembership(document.id, collection.id, event.target.checked)}
                        />
                        <span>{collection.name}</span>
                      </label>
                    ))}
                  </fieldset>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {cursor ? <button className="studio-library__more" type="button" disabled={loadingMore} onClick={() => void loadNextPage()}>{loadingMore ? "Carregando…" : "Carregar mais"}</button> : null}
    </section>
  );
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
