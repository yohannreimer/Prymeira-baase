import { lazy, Suspense, useEffect, useState } from "react";
import StudioHome from "./StudioHome";
import StudioAssetProcessingStatus from "./StudioAssetProcessingStatus";
import { getStudioDocumentAssets } from "./studio-api";
import type { StudioAsset, StudioDocument } from "./studio.types";
import type { StudioCaptureOutcome } from "./UniversalCaptureComposer";
import "./studio.css";

const StudioEditor = lazy(() => import("./StudioEditor"));

type StudioSection = "home" | "inbox" | "all" | "goals" | "decisions" | "plans" | "rituals" | "collection" | "document";

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

const studioNavigation: StudioNavItem[] = [
  { key: "home", label: "Início", icon: "ph-house", title: "Um espaço para pensar com clareza.", description: "Registre o que importa e transforme notas em direção, no seu ritmo.", instruction: "Comece registrando uma ideia, decisão ou assunto que não pode se perder." },
  { key: "inbox", label: "Caixa de entrada", icon: "ph-tray", title: "Caixa de entrada", description: "Tudo o que você capturar chega aqui antes de ganhar um lugar definitivo.", instruction: "Novas capturas aparecerão aqui para você revisar e organizar." },
  { key: "all", label: "Tudo", icon: "ph-files", title: "Tudo", description: "Consulte seus registros em um só lugar, sem misturar o Estúdio com a operação da equipe.", instruction: "Seus documentos aparecerão aqui conforme forem criados." },
  { key: "goals", label: "Metas", icon: "ph-target", title: "Metas", description: "Mantenha os resultados que orientam suas escolhas sempre visíveis.", instruction: "Organize aqui as metas que merecem acompanhamento recorrente." },
  { key: "decisions", label: "Decisões", icon: "ph-signpost", title: "Decisões", description: "Registre escolhas, contexto e motivos para não depender da memória.", instruction: "As decisões identificadas nos seus documentos aparecerão aqui." },
  { key: "plans", label: "Planos", icon: "ph-map-trifold", title: "Planos", description: "Dê forma a caminhos possíveis antes de levá-los para a operação.", instruction: "Reúna planos em elaboração e próximos passos neste espaço." },
  { key: "rituals", label: "Rituais", icon: "ph-calendar-check", title: "Rituais", description: "Reserve momentos de revisão para manter prioridades e decisões vivas.", instruction: "Seus rituais de reflexão aparecerão aqui quando forem definidos." },
  { key: "collection", label: "Coleção", icon: "ph-folder-simple", title: "Coleção", description: "Agrupe documentos que pertencem ao mesmo contexto ou frente de pensamento.", instruction: "Escolha ou crie uma coleção para reunir documentos relacionados." },
  { key: "document", label: "Documento", icon: "ph-file-text", title: "Documento", description: "Escreva com calma e preserve o histórico do que mudou.", instruction: "Abra um documento existente ou crie um novo registro para começar." }
];

export default function StudioPage() {
  const [section, setSection] = useState<StudioSection>("home");
  const [selectedDocument, setSelectedDocument] = useState<StudioDocument | null>(null);
  const [assetState, setAssetState] = useState<DocumentAssetState>({
    documentId: null,
    assets: [],
    loading: false,
    error: false
  });
  const [assetsReloadKey, setAssetsReloadKey] = useState(0);
  const active = studioNavigation.find((item) => item.key === section) ?? studioNavigation[0]!;

  function openDocument(document: StudioDocument, outcome?: StudioCaptureOutcome) {
    setSelectedDocument(document);
    setAssetState({
      documentId: document.id,
      assets: outcome?.asset ? [outcome.asset] : [],
      loading: true,
      error: false
    });
    setSection("document");
  }

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
          ? { documentId, assets, loading: false, error: false }
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

  return (
    <section className="studio-screen screen" aria-labelledby="studio-title">
      <header className="studio-intro">
        <div>
          <p className="mono studio-eyebrow">Privado para você</p>
          <h1 className="serif" id="studio-title">Estúdio</h1>
        </div>
        <p>Um lugar reservado para capturar, organizar e amadurecer o que guia a empresa.</p>
      </header>

      <div className="studio-layout" data-testid="studio-layout">
        <nav className="studio-nav" aria-label="Seções do Estúdio">
          {studioNavigation.map((item) => (
            <button
              className="studio-nav__item"
              type="button"
              key={item.key}
              aria-current={section === item.key ? "page" : undefined}
              onClick={() => setSection(item.key)}
            >
              <i aria-hidden="true" className={`ph-light ${item.icon}`} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <section className="studio-content" aria-label="Conteúdo da seção" aria-live="polite">
          {section === "home" ? <StudioHome onOpenDocument={openDocument} /> : section === "document" && selectedDocument ? (
            <>
              <Suspense fallback={<StudioEditorSkeleton />}>
                <StudioEditor
                  document={selectedDocument}
                  focusHeadingOnMount
                  onDocumentChange={setSelectedDocument}
                />
              </Suspense>
              <DocumentAssets
                documentTitle={selectedDocument.title || "Sem título"}
                assets={assetState.documentId === selectedDocument.id ? assetState.assets : []}
                loading={assetState.documentId === selectedDocument.id ? assetState.loading : true}
                error={assetState.documentId === selectedDocument.id ? assetState.error : false}
                onRetry={() => setAssetsReloadKey((key) => key + 1)}
              />
            </>
          ) : (
            <>
              <div className="studio-content__heading">
                <p className="mono">{active.label}</p>
                <h2 className="serif">{active.title}</h2>
                <p>{active.description}</p>
              </div>
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

function StudioEditorSkeleton() {
  return (
    <div className="studio-editor-skeleton" role="status" aria-label="Abrindo caderno">
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
}

function DocumentAssets({
  documentTitle,
  assets,
  loading,
  error,
  onRetry
}: {
  documentTitle: string;
  assets: StudioAsset[];
  loading: boolean;
  error: boolean;
  onRetry(): void;
}) {
  return (
    <div className="studio-document-assets" aria-label="Materiais do documento">
      {assets.map((asset) => <StudioAssetProcessingStatus key={asset.id} asset={asset} />)}
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
