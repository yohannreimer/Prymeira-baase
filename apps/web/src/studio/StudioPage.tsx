import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import StudioHome from "./StudioHome";
import StudioAssetProcessingStatus from "./StudioAssetProcessingStatus";
import StudioMaterialComposer from "./StudioMaterialComposer";
import StudioLibrary from "./StudioLibrary";
import StudioSearch from "./StudioSearch";
import StudioCollections from "./StudioCollections";
import { getStudioDocument, getStudioDocumentAssets, StudioApiError } from "./studio-api";
import { sweepExpiredStudioDraftQuarantines } from "./studio-draft-storage";
import { useStudioCollections } from "./useStudioCollections";
import type { StudioAsset, StudioCitation, StudioDocument, StudioInternalCitationTarget } from "./studio.types";
import type { StudioCaptureOutcome } from "./UniversalCaptureComposer";
import type { StudioEditorHandle } from "./StudioEditor";
import "./studio.css";

const StudioEditor = lazy(() => import("./StudioEditor"));
const StudioRituals = lazy(() => import("./StudioRituals"));
const StudioPrivacySettings = lazy(() => import("./StudioPrivacySettings"));

type StudioSection = "home" | "inbox" | "all" | "goals" | "decisions" | "plans" | "rituals" | "collections" | "archive" | "privacy" | "document";

type StudioNavItem = {
  key: StudioSection;
  label: string;
  icon: string;
  title: string;
  description: string;
  instruction: string;
};

type DocumentAssetState = {
  documentId: string | null;
  assets: StudioAsset[];
  loading: boolean;
  error: boolean;
};

type DocumentOpenError = { kind: "unavailable" | "temporary"; documentId: string };

function validTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function retainFreshestAsset(byId: Map<string, StudioAsset>, asset: StudioAsset) {
  const known = byId.get(asset.id);
  if (!known) {
    byId.set(asset.id, asset);
    return;
  }
  const knownUpdatedAt = validTimestamp(known.updatedAt);
  const incomingUpdatedAt = validTimestamp(asset.updatedAt);
  if (incomingUpdatedAt !== null && (knownUpdatedAt === null || incomingUpdatedAt > knownUpdatedAt)) {
    byId.set(asset.id, asset);
  }
}

export function mergeAssets(current: StudioAsset[], incoming: StudioAsset[]): StudioAsset[] {
  const byId = new Map<string, StudioAsset>();
  for (const asset of current) retainFreshestAsset(byId, asset);
  for (const asset of incoming) retainFreshestAsset(byId, asset);
  return [...byId.values()]
    .map((asset, index) => ({ asset, index, createdAt: validTimestamp(asset.createdAt) }))
    .sort((left, right) => {
      if (left.createdAt !== null && right.createdAt !== null) {
        return left.createdAt - right.createdAt || left.index - right.index;
      }
      if (left.createdAt !== null) return -1;
      if (right.createdAt !== null) return 1;
      return left.index - right.index;
    })
    .map(({ asset }) => asset);
}

const studioNavigation: StudioNavItem[] = [
  { key: "home", label: "Início", icon: "ph-house", title: "Um espaço para pensar com clareza.", description: "Registre o que importa e transforme notas em direção, no seu ritmo.", instruction: "Comece registrando uma ideia, decisão ou assunto que não pode se perder." },
  { key: "inbox", label: "Entrada", icon: "ph-tray", title: "Entrada", description: "Tudo o que você capturar chega aqui antes de ganhar um lugar definitivo.", instruction: "Novas capturas aparecerão aqui para você revisar e organizar." },
  { key: "all", label: "Tudo", icon: "ph-files", title: "Tudo", description: "Consulte seus registros em um só lugar, sem misturar o Estúdio com a operação da equipe.", instruction: "Seus documentos aparecerão aqui conforme forem criados." },
  { key: "goals", label: "Metas", icon: "ph-target", title: "Metas", description: "Mantenha os resultados que orientam suas escolhas sempre visíveis.", instruction: "Organize aqui as metas que merecem acompanhamento recorrente." },
  { key: "decisions", label: "Decisões", icon: "ph-signpost", title: "Decisões", description: "Registre escolhas, contexto e motivos para não depender da memória.", instruction: "As decisões identificadas nos seus documentos aparecerão aqui." },
  { key: "plans", label: "Planos", icon: "ph-map-trifold", title: "Planos", description: "Dê forma a caminhos possíveis antes de levá-los para a operação.", instruction: "Reúna planos em elaboração e próximos passos neste espaço." },
  { key: "rituals", label: "Rituais", icon: "ph-calendar-check", title: "Rituais", description: "Reserve momentos de revisão para manter prioridades e decisões vivas.", instruction: "Seus rituais de reflexão aparecerão aqui quando forem definidos." },
  { key: "collections", label: "Coleções", icon: "ph-folder-simple", title: "Coleções", description: "Agrupe documentos que pertencem ao mesmo contexto ou frente de pensamento.", instruction: "Escolha ou crie uma coleção para reunir documentos relacionados." },
  { key: "archive", label: "Arquivo", icon: "ph-archive", title: "Arquivo", description: "Registros preservados fora da sua mesa principal.", instruction: "Documentos arquivados podem ser restaurados quando voltarem a importar." },
  { key: "privacy", label: "Privacidade", icon: "ph-shield-check", title: "Privacidade do Estúdio", description: "Leve uma cópia ou remova apenas o conteúdo deste espaço privado.", instruction: "" }
];

export default function StudioPage({ onOpenInternalSource }: {
  onOpenInternalSource?(target: StudioInternalCitationTarget, citation: StudioCitation): void;
}) {
  const [section, setSection] = useState<StudioSection>(() => sectionFromHash(window.location.hash));
  const [sectionAnnouncement, setSectionAnnouncement] = useState("");
  const [selectedRitualId, setSelectedRitualId] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<StudioDocument | null>(null);
  const [assetState, setAssetState] = useState<DocumentAssetState>({
    documentId: null,
    assets: [],
    loading: false,
    error: false
  });
  const [assetsReloadKey, setAssetsReloadKey] = useState(0);
  const [documentOpenError, setDocumentOpenError] = useState<DocumentOpenError | null>(null);
  const pageMountedRef = useRef(true);
  const searchOpenController = useRef<AbortController | null>(null);
  const documentRequestGeneration = useRef(0);
  const selectedDocumentId = useRef<string | null>(null);
  const documentErrorActionRef = useRef<HTMLButtonElement | null>(null);
  const editorRef = useRef<StudioEditorHandle>(null);
  const navigationRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const collectionStore = useStudioCollections();
  const active = studioNavigation.find((item) => item.key === section) ?? studioNavigation[0]!;
  const insertTranscript = useCallback((text: string) => (
    editorRef.current?.insertTextAtLastSelection(text) ?? false
  ), []);

  useEffect(() => {
    pageMountedRef.current = true;
    return () => {
      pageMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    sweepExpiredStudioDraftQuarantines();
  }, []);

  function openDocument(document: StudioDocument, outcome?: StudioCaptureOutcome, syncHistory = true) {
    documentRequestGeneration.current += 1;
    searchOpenController.current?.abort();
    searchOpenController.current = null;
    setDocumentOpenError(null);
    showDocument(document, outcome);
    if (syncHistory) window.history.pushState(null, "", `#estudio/document/${encodeURIComponent(document.id)}`);
  }

  function showDocument(document: StudioDocument, outcome?: StudioCaptureOutcome) {
    selectedDocumentId.current = document.id;
    setSelectedDocument(document);
    setAssetState({
      documentId: document.id,
      assets: outcome?.asset ? [outcome.asset] : [],
      loading: true,
      error: false
    });
    setSection("document");
  }

  function navigateSection(next: Exclude<StudioSection, "document">) {
    cancelDocumentOpen();
    setSelectedRitualId(null);
    setDocumentOpenError(null);
    setSection(next);
    const nextItem = studioNavigation.find((item) => item.key === next);
    if (nextItem) setSectionAnnouncement(`Seção ${nextItem.label} aberta.`);
    window.history.pushState(null, "", `#estudio/${next}`);
  }

  function moveNavigationFocus(event: ReactKeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    const lastIndex = studioNavigation.length - 1;
    const nextIndex = event.key === "ArrowDown" || event.key === "ArrowRight"
      ? (currentIndex + 1) % studioNavigation.length
      : event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? (currentIndex - 1 + studioNavigation.length) % studioNavigation.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? lastIndex
            : null;
    if (nextIndex === null) return;
    event.preventDefault();
    navigationRefs.current[nextIndex]?.focus();
  }

  function openRitual(ritualId: string) {
    cancelDocumentOpen();
    setDocumentOpenError(null);
    setSelectedRitualId(ritualId);
    setSection("rituals");
    window.history.pushState(null, "", "#estudio/rituals");
  }

  async function openDocumentById(documentId: string, syncHistory = true) {
    searchOpenController.current?.abort();
    const controller = new AbortController();
    searchOpenController.current = controller;
    const generation = ++documentRequestGeneration.current;
    selectedDocumentId.current = null;
    setSelectedDocument(null);
    setAssetState({ documentId: null, assets: [], loading: false, error: false });
    setSection("document");
    setDocumentOpenError(null);
    if (syncHistory) window.history.pushState(null, "", `#estudio/document/${encodeURIComponent(documentId)}`);
    try {
      const document = await getStudioDocument(documentId, fetch, controller.signal);
      if (!isCurrentDocumentRequest(controller, generation, documentId)) return;
      showDocument(document);
    } catch (error) {
      if (isCurrentDocumentRequest(controller, generation, documentId)) {
        const status = studioErrorStatus(error);
        const unavailable = status === 403 || status === 404;
        setDocumentOpenError({ kind: unavailable ? "unavailable" : "temporary", documentId });
      }
    } finally {
      if (searchOpenController.current === controller && documentRequestGeneration.current === generation) {
        searchOpenController.current = null;
      }
    }
  }

  function isCurrentDocumentRequest(controller: AbortController, generation: number, documentId: string) {
    const route = parseStudioHash(window.location.hash);
    return !controller.signal.aborted
      && searchOpenController.current === controller
      && documentRequestGeneration.current === generation
      && route.section === "document"
      && route.documentId === documentId;
  }

  function cancelDocumentOpen() {
    documentRequestGeneration.current += 1;
    searchOpenController.current?.abort();
    searchOpenController.current = null;
  }

  useEffect(() => () => searchOpenController.current?.abort(), []);

  useEffect(() => {
    function restoreInternalRoute() {
      const route = parseStudioHash(window.location.hash);
      if (route.section === "document") {
        if (route.documentId !== selectedDocumentId.current) void openDocumentById(route.documentId, false);
        else setSection("document");
      } else {
        cancelDocumentOpen();
        setDocumentOpenError(null);
        setSection(route.section);
      }
    }
    restoreInternalRoute();
    window.addEventListener("popstate", restoreInternalRoute);
    window.addEventListener("hashchange", restoreInternalRoute);
    return () => {
      window.removeEventListener("popstate", restoreInternalRoute);
      window.removeEventListener("hashchange", restoreInternalRoute);
    };
  }, []);

  useEffect(() => {
    if (!documentOpenError) return;
    documentErrorActionRef.current?.focus();
  }, [documentOpenError]);

  useEffect(() => {
    if (section !== "document" || !selectedDocument) return;
    const controller = new AbortController();
    const documentId = selectedDocument.id;
    setAssetState((current) => ({
      documentId,
      assets: current.documentId === documentId ? current.assets : [],
      loading: true,
      error: false
    }));
    void getStudioDocumentAssets(documentId, controller.signal).then((assets) => {
      if (!controller.signal.aborted) {
        setAssetState((current) => current.documentId === documentId
          ? { documentId, assets: mergeAssets(current.assets, assets), loading: false, error: false }
          : current);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setAssetState((current) => current.documentId === documentId
          ? { ...current, loading: false, error: true }
          : current);
      }
    });
    return () => controller.abort();
  }, [assetsReloadKey, section, selectedDocument?.id]);

  function attachDocumentAsset(asset: StudioAsset) {
    if (!pageMountedRef.current) return;
    if (selectedDocumentId.current !== asset.documentId) return;
    setAssetState((current) => current.documentId === asset.documentId
      ? { ...current, assets: mergeAssets(current.assets, [asset]) }
      : current);
  }

  return (
    <section className="studio-screen screen" aria-labelledby="studio-title">
      <header className="studio-intro">
        <div>
          <p className="mono studio-eyebrow">Privado para você</p>
          <h1 className="serif" id="studio-title">Estúdio</h1>
        </div>
        <p>Um lugar reservado para capturar, organizar e amadurecer o que guia a empresa.</p>
      </header>

      <p
        className="sr-only"
        role="status"
        aria-label="Mudança de seção"
        aria-live="polite"
        aria-atomic="true"
      >
        {sectionAnnouncement}
      </p>

      <div className="studio-layout" data-testid="studio-layout">
        <nav className="studio-nav" aria-label="Seções do Estúdio">
          {studioNavigation.map((item, index) => (
            <button
              className="studio-nav__item"
              type="button"
              key={item.key}
              ref={(node) => { navigationRefs.current[index] = node; }}
              aria-current={section === item.key ? "page" : undefined}
              onClick={() => navigateSection(item.key as Exclude<StudioSection, "document">)}
              onKeyDown={(event) => moveNavigationFocus(event, index)}
            >
              <i aria-hidden="true" className={`ph-light ${item.icon}`} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <section className="studio-content" aria-label="Conteúdo da seção">
          {section === "home" ? <StudioHome onOpenDocument={openDocument} onOpenRitual={openRitual} /> : section === "document" ? (
            selectedDocument ? <>
              <Suspense fallback={<StudioEditorSkeleton />}>
                <StudioEditor
                  key={selectedDocument.id}
                  ref={editorRef}
                  document={selectedDocument}
                  focusHeadingOnMount
                  onDocumentChange={(document) => {
                    selectedDocumentId.current = document.id;
                    setSelectedDocument(document);
                  }}
                  onOpenDocument={(documentId) => void openDocumentById(documentId)}
                  onOpenInternalSource={onOpenInternalSource}
                  materialRegion={(
                    <DocumentAssets
                      documentId={selectedDocument.id}
                      documentTitle={selectedDocument.title || "Sem título"}
                      assets={assetState.documentId === selectedDocument.id ? assetState.assets : []}
                      loading={assetState.documentId === selectedDocument.id ? assetState.loading : true}
                      error={assetState.documentId === selectedDocument.id ? assetState.error : false}
                      onAttached={attachDocumentAsset}
                      onRetry={() => setAssetsReloadKey((key) => key + 1)}
                      onInsertTranscript={insertTranscript}
                    />
                  )}
                />
              </Suspense>
            </> : documentOpenError ? (
              <DocumentOpenFailure
                error={documentOpenError}
                actionRef={documentErrorActionRef}
                onBack={() => navigateSection("all")}
                onRetry={() => void openDocumentById(documentOpenError.documentId, false)}
              />
            ) : <StudioEditorSkeleton />
          ) : section === "inbox" ? (
            <>
              <StudioSectionHeading item={active} />
              <StudioLibrary collections={collectionStore.collections} query={{ status: "active", inbox_state: "pending_review" }} onOpenDocument={openDocument} />
            </>
          ) : section === "all" ? (
            <>
              <StudioSectionHeading item={active} />
              <StudioSearch onOpenDocument={(documentId) => void openDocumentById(documentId)} />
              <StudioLibrary collections={collectionStore.collections} query={{ status: "active" }} onOpenDocument={openDocument} />
            </>
          ) : section === "collections" ? (
            <>
              <StudioSectionHeading item={active} />
              <StudioCollections store={collectionStore} onOpenDocument={openDocument} />
            </>
          ) : section === "rituals" ? (
            <>
              <StudioSectionHeading item={active} />
              <Suspense fallback={<StudioRitualsSkeleton />}>
                <StudioRituals initialRitualId={selectedRitualId} />
              </Suspense>
            </>
          ) : section === "archive" ? (
            <>
              <StudioSectionHeading item={active} />
              <StudioLibrary collections={collectionStore.collections} query={{ status: "archived" }} onOpenDocument={openDocument} />
            </>
          ) : section === "privacy" ? (
            <Suspense fallback={<StudioPrivacySkeleton />}>
              <StudioPrivacySettings />
            </Suspense>
          ) : (
            <>
              <StudioSectionHeading item={active} />
              <div className="studio-empty">
                <i aria-hidden="true" className={`ph-light ${active.icon}`} />
                <p>{active.instruction}</p>
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

function sectionFromHash(hash: string): StudioSection {
  return parseStudioHash(hash).section;
}

type StudioRoute =
  | { section: Exclude<StudioSection, "document"> }
  | { section: "document"; documentId: string };

function parseStudioHash(hash: string): StudioRoute {
  if (hash === "#estudio" || hash === "#estudio/" || hash === "#estudio/home") return { section: "home" };
  const documentMatch = hash.match(/^#estudio\/document\/([^/]+)$/u);
  if (documentMatch?.[1]) {
    try {
      const documentId = decodeURIComponent(documentMatch[1]);
      if (documentId && !documentId.includes("/")) return { section: "document", documentId };
    } catch {
      return { section: "home" };
    }
  }
  const sectionMatch = hash.match(/^#estudio\/([^/]+)$/u);
  const section = sectionMatch?.[1];
  return studioNavigation.some((item) => item.key === section)
    ? { section: section as Exclude<StudioSection, "document"> }
    : { section: "home" };
}

function studioErrorStatus(error: unknown) {
  if (error instanceof StudioApiError) return error.status;
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") return error.status;
  return null;
}

function StudioSectionHeading({ item }: { item: StudioNavItem }) {
  return (
    <div className="studio-content__heading">
      <p className="mono">{item.label}</p>
      <h2 className="serif">{item.title}</h2>
      <p>{item.description}</p>
    </div>
  );
}

function StudioEditorSkeleton() {
  return (
    <div className="studio-editor-skeleton" role="status" aria-label="Abrindo caderno">
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
}

function StudioRitualsSkeleton() {
  return (
    <div className="studio-ritual-loading" role="status" aria-label="Abrindo seus rituais">
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
}

function StudioPrivacySkeleton() {
  return (
    <div className="studio-editor-skeleton" role="status" aria-label="Abrindo privacidade">
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
}

function DocumentOpenFailure({
  error,
  actionRef,
  onBack,
  onRetry
}: {
  error: DocumentOpenError;
  actionRef: RefObject<HTMLButtonElement | null>;
  onBack(): void;
  onRetry(): void;
}) {
  return (
    <div className="studio-document-open-error" role="alert">
      <i aria-hidden="true" className="ph-light ph-file-x" />
      <h2 className="serif">{error.kind === "unavailable" ? "Este registro não está disponível." : "Não foi possível abrir este registro."}</h2>
      <p>{error.kind === "unavailable"
        ? "Ele pode ter sido removido, arquivado ou pertencer a outro espaço privado."
        : "Sua biblioteca continua segura. Tente novamente quando a conexão estiver estável."}</p>
      <div>
        {error.kind === "temporary" ? <button ref={actionRef} type="button" onClick={onRetry}>Tentar novamente</button> : null}
        <button ref={error.kind === "unavailable" ? actionRef : undefined} type="button" onClick={onBack}>Voltar para Tudo</button>
      </div>
    </div>
  );
}

function DocumentAssets({
  documentId,
  documentTitle,
  assets,
  loading,
  error,
  onAttached,
  onRetry,
  onInsertTranscript
}: {
  documentId: string;
  documentTitle: string;
  assets: StudioAsset[];
  loading: boolean;
  error: boolean;
  onAttached(asset: StudioAsset): void;
  onRetry(): void;
  onInsertTranscript(text: string): boolean | Promise<boolean>;
}) {
  return (
    <div className="studio-document-assets" role="region" aria-label="Materiais do documento">
      <StudioMaterialComposer documentId={documentId} onAttached={onAttached} />
      {assets.map((asset) => (
        <StudioAssetProcessingStatus
          key={asset.id}
          asset={asset}
          onInsertTranscript={onInsertTranscript}
        />
      ))}
      {loading && assets.length === 0 ? (
        <p
          className="studio-document-assets__status"
          role="status"
          aria-label={`Carregando materiais do documento ${documentTitle}`}
        >Carregando materiais preservados…</p>
      ) : null}
      {error ? (
        <div
          className="studio-document-assets__error"
          role="alert"
          aria-label={`Falha ao carregar materiais do documento ${documentTitle}`}
        >
          <span>Não foi possível carregar os materiais preservados agora.</span>
          <button type="button" onClick={onRetry}>Tentar novamente</button>
        </div>
      ) : null}
    </div>
  );
}
