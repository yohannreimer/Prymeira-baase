import { useCallback, useEffect, useState } from "react";
import { getStudioHome } from "./studio-api";
import type { StudioDocument, StudioHome as StudioHomeModel, StudioNextRitual } from "./studio.types";
import UniversalCaptureComposer, { type StudioCaptureOutcome } from "./UniversalCaptureComposer";

type StudioHomeProps = {
  onOpenDocument(document: StudioDocument, outcome?: StudioCaptureOutcome): void;
  onOpenRitual?(ritualId: string): void;
  loadHome?: (signal?: AbortSignal) => Promise<StudioHomeModel>;
};

const loadDefaultHome = (signal?: AbortSignal) => getStudioHome(fetch, signal);

function documentLabel(document: StudioDocument) {
  return document.title?.trim() || document.bodyText.trim().split(/\s+/u).slice(0, 8).join(" ") || "Captura sem título";
}

function DocumentLink({ document, onOpen }: { document: StudioDocument; onOpen(document: StudioDocument): void }) {
  return (
    <button className="studio-document-link" type="button" onClick={() => onOpen(document)}>
      <span>{documentLabel(document)}</span>
      <small>{document.bodyText || "Registro pronto para receber suas próximas palavras."}</small>
      <i aria-hidden="true" className="ph-light ph-arrow-up-right" />
    </button>
  );
}

function EmptyInvitation({ children }: { children: string }) {
  return <p className="studio-home__invitation">{children}</p>;
}

function NextRitual({ ritual, onOpen }: { ritual: StudioNextRitual; onOpen?(ritualId: string): void }) {
  const date = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(ritual.scheduledFor));
  return (
    <button
      className="studio-ritual-preview"
      type="button"
      aria-label={`Iniciar ${ritual.title}`}
      onClick={() => onOpen?.(ritual.id)}
    >
      <i aria-hidden="true" className="ph-light ph-calendar-check" />
      <div><strong>{ritual.title}</strong><span>{date}</span></div>
      <i aria-hidden="true" className="ph-light ph-arrow-right" />
    </button>
  );
}

function StudioHomeSkeleton() {
  return (
    <div className="studio-home-skeleton" role="status" aria-label="Carregando sua mesa">
      <div className="studio-skeleton-grid" aria-hidden="true">
        <span className="studio-skeleton studio-skeleton--wide" />
        <span className="studio-skeleton" />
        <span className="studio-skeleton" />
      </div>
    </div>
  );
}

export default function StudioHome({ onOpenDocument, onOpenRitual, loadHome = loadDefaultHome }: StudioHomeProps) {
  const [home, setHome] = useState<StudioHomeModel | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void loadHome(controller.signal).then((loadedHome) => {
      if (!controller.signal.aborted) setHome(loadedHome);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => controller.abort();
  }, [loadHome, reloadKey]);

  const retry = useCallback(() => setReloadKey((key) => key + 1), []);

  const continuing = home?.recentDocuments[0];
  const recentDocuments = home?.recentDocuments.slice(0, 6) ?? [];
  const nextRitual = home?.nextRituals[0];

  return (
    <div className="studio-home">
      <div className="studio-home__welcome">
        <p className="mono">Mesa tranquila</p>
        <h2 className="serif">Um espaço para pensar com clareza.</h2>
        <p>Registre primeiro. Você decide depois se quer organizar, aprofundar ou apenas guardar.</p>
      </div>

      <UniversalCaptureComposer onCaptured={onOpenDocument} />

      {!home && !error ? <StudioHomeSkeleton /> : null}
      {!home && error ? (
        <div className="studio-home-error" role="alert">
          <p>Não foi possível preparar sua mesa agora.</p>
          <button type="button" onClick={retry}>Tentar novamente</button>
        </div>
      ) : null}

      {home ? <div className="studio-home__flow">
        <section className="studio-home-section studio-home-section--continue" aria-labelledby="studio-continue-title">
          <h3 id="studio-continue-title">Continue de onde parou</h3>
          {continuing
            ? <DocumentLink document={continuing} onOpen={onOpenDocument} />
            : <EmptyInvitation>Seu próximo registro pode começar aqui, sem precisar de categoria.</EmptyInvitation>}
        </section>

        <section className="studio-home-section" aria-labelledby="studio-focus-title">
          <h3 id="studio-focus-title">Em foco</h3>
          {home.focusedDocuments.length
            ? <div className="studio-document-list">{home.focusedDocuments.slice(0, 4).map((document) => <DocumentLink key={document.id} document={document} onOpen={onOpenDocument} />)}</div>
            : <EmptyInvitation>Marque um pensamento quando quiser mantê-lo por perto.</EmptyInvitation>}
        </section>

        <section className="studio-home-section" aria-labelledby="studio-recents-title">
          <h3 id="studio-recents-title">Recentes</h3>
          {recentDocuments.length
            ? <div className="studio-document-list">{recentDocuments.map((document) => <DocumentLink key={document.id} document={document} onOpen={onOpenDocument} />)}</div>
            : <EmptyInvitation>Suas capturas recentes vão se reunir aqui, prontas para retomar.</EmptyInvitation>}
        </section>

        {nextRitual ? (
          <section className="studio-home-section" aria-labelledby="studio-ritual-title">
            <h3 id="studio-ritual-title">Próximo ritual</h3>
            <NextRitual ritual={nextRitual} onOpen={onOpenRitual} />
          </section>
        ) : null}
      </div> : null}
    </div>
  );
}
