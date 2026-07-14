import { useEffect, useRef, useState } from "react";
import StudioHome from "./StudioHome";
import StudioAssetProcessingStatus from "./StudioAssetProcessingStatus";
import { getStudioDocumentAssets } from "./studio-api";
import type { StudioAsset, StudioDocument } from "./studio.types";
import type { StudioCaptureOutcome } from "./UniversalCaptureComposer";
import "./studio.css";

type StudioSection = "home" | "inbox" | "all" | "goals" | "decisions" | "plans" | "rituals" | "collection" | "document";

type StudioNavItem = {
  key: StudioSection;
  label: string;
  icon: string;
  title: string;
  description: string;
  instruction: string;
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
  const [selectedCaptureOutcome, setSelectedCaptureOutcome] = useState<StudioCaptureOutcome | null>(null);
  const [selectedAssets, setSelectedAssets] = useState<StudioAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState(false);
  const [assetsReloadKey, setAssetsReloadKey] = useState(0);
  const documentHeadingRef = useRef<HTMLHeadingElement>(null);
  const active = studioNavigation.find((item) => item.key === section) ?? studioNavigation[0]!;

  function openDocument(document: StudioDocument, outcome?: StudioCaptureOutcome) {
    setSelectedDocument(document);
    setSelectedCaptureOutcome(outcome ?? null);
    setSelectedAssets(outcome?.asset ? [outcome.asset] : []);
    setSection("document");
  }

  useEffect(() => {
    if (section !== "document" || !selectedDocument) return;
    documentHeadingRef.current?.focus();
  }, [section, selectedDocument?.id]);

  useEffect(() => {
    if (section !== "document" || !selectedDocument) return;
    const controller = new AbortController();
    setAssetsLoading(true);
    setAssetsError(false);
    void getStudioDocumentAssets(selectedDocument.id, controller.signal).then((assets) => {
      if (!controller.signal.aborted) setSelectedAssets(assets);
    }).catch(() => {
      if (!controller.signal.aborted) setAssetsError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setAssetsLoading(false);
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
          {section === "home" ? <StudioHome onOpenDocument={openDocument} /> : (
            <>
              <div className="studio-content__heading">
                <p className="mono">{active.label}</p>
                <h2
                  className="serif"
                  ref={section === "document" ? documentHeadingRef : undefined}
                  tabIndex={section === "document" ? -1 : undefined}
                >{section === "document" && selectedDocument
                  ? selectedDocument.title || "Captura sem título"
                  : active.title}</h2>
                <p>{section === "document" && selectedDocument
                  ? selectedAssets.length || selectedCaptureOutcome?.asset
                    ? "O documento e o material original estão guardados. O estado abaixo acompanha o processamento real."
                    : "Sua captura está guardada. O caderno completo será aberto aqui."
                  : active.description}</p>
              </div>
              <div className="studio-empty">
                <i aria-hidden="true" className={`ph-light ${active.icon}`} />
                <p>{section === "document" && selectedDocument
                  ? selectedDocument.bodyText || active.instruction
                  : active.instruction}</p>
              </div>
              {section === "document" && selectedDocument ? (
                <div className="studio-document-assets" aria-label="Materiais do documento">
                  {selectedAssets.map((asset) => (
                    <StudioAssetProcessingStatus key={asset.id} asset={asset} />
                  ))}
                  {assetsLoading && selectedAssets.length === 0 ? (
                    <p className="studio-document-assets__status" role="status">Carregando materiais preservados…</p>
                  ) : null}
                  {assetsError ? (
                    <div className="studio-document-assets__error" role="alert">
                      <span>Não foi possível carregar os materiais preservados agora.</span>
                      <button type="button" onClick={() => setAssetsReloadKey((key) => key + 1)}>Tentar novamente</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
