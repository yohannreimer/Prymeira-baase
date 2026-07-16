import { useEffect, useMemo, useRef, useState } from "react";
import { listStudioDocumentVersions } from "./studio-api";
import type { StudioCheckpointReason, StudioDocumentVersion } from "./studio.types";

const PAGE_SIZE = 10;

const reasonLabels: Record<StudioCheckpointReason | "legacy_autosave", string> = {
  significant_pause: "Pausa na escrita",
  document_exit: "Ao fechar o documento",
  structure_changed: "Estrutura atualizada",
  accepted_ai_suggestion: "Proposta da IA aceita",
  transcript_inserted: "Transcrição inserida",
  restored: "Versão restaurada",
  manual: "Versão preservada",
  legacy_autosave: "Salvamento anterior"
};

type StudioVersionDrawerProps = {
  documentId: string;
  open: boolean;
  onClose(): void;
  onRestore(version: StudioDocumentVersion): Promise<void>;
  canRestore?: boolean;
  restoreBlockedMessage?: string;
};

export default function StudioVersionDrawer({
  documentId,
  open,
  onClose,
  onRestore,
  canRestore = true,
  restoreBlockedMessage = "Salve ou resolva as alterações atuais antes de restaurar."
}: StudioVersionDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const focusFirstVersionRef = useRef(false);
  const [versions, setVersions] = useState<StudioDocumentVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [reloadKey, setReloadKey] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const checkpoints = useMemo(() => versions.filter((version) => !version.isLegacy), [versions]);
  const legacy = useMemo(() => versions.filter((version) => version.isLegacy), [versions]);
  const selected = versions.find((version) => version.id === selectedId) ?? null;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState("loading");
    setVisibleCount(PAGE_SIZE);
    setLegacyOpen(false);
    setRestoreError(null);
    void listStudioDocumentVersions(documentId, fetch, controller.signal).then((loaded) => {
      if (controller.signal.aborted) return;
      const newestFirst = [...loaded].sort((left, right) => right.versionNumber - left.versionNumber);
      setVersions(newestFirst);
      setSelectedId((current) => newestFirst.some((version) => version.id === current)
        ? current
        : newestFirst.find((version) => !version.isLegacy)?.id ?? newestFirst[0]?.id ?? null);
      setState("ready");
    }).catch(() => {
      if (!controller.signal.aborted) setState("error");
    });
    return () => controller.abort();
  }, [documentId, open, reloadKey]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    headingRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(drawerRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        headingRef.current?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const activeElement = window.document.activeElement;
      const atInitialAnchor = activeElement === headingRef.current || activeElement === drawerRef.current;
      const outsideDrawer = activeElement === null || !drawerRef.current?.contains(activeElement);
      if (event.shiftKey && (activeElement === first || atInitialAnchor || outsideDrawer)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || atInitialAnchor || outsideDrawer)) {
        event.preventDefault();
        first.focus();
      }
    }

    function handleFocusIn(event: FocusEvent) {
      const target = event.target;
      if (target instanceof Node && !drawerRef.current?.contains(target)) headingRef.current?.focus();
    }

    window.document.addEventListener("keydown", handleKeyDown);
    window.document.addEventListener("focusin", handleFocusIn);
    return () => {
      window.document.removeEventListener("keydown", handleKeyDown);
      window.document.removeEventListener("focusin", handleFocusIn);
      window.document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!focusFirstVersionRef.current || state === "loading") return;
    if (state === "ready") {
      focusFirstVersionRef.current = false;
      drawerRef.current?.querySelector<HTMLButtonElement>(".studio-version-drawer__version")?.focus();
    } else if (state === "error") {
      retryRef.current?.focus();
    }
  }, [state]);

  if (!open) return null;

  function retry() {
    focusFirstVersionRef.current = true;
    setReloadKey((key) => key + 1);
  }

  async function restore() {
    if (!selected || !canRestore || restoring) return;
    if (!window.confirm(`Restaurar a versão ${selected.versionNumber} como uma nova versão?`)) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      await onRestore(selected);
    } catch {
      setRestoreError("Não foi possível restaurar esta versão agora.");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="studio-version-drawer-layer">
      <button
        className="studio-version-drawer__backdrop"
        data-testid="studio-version-backdrop"
        type="button"
        aria-label="Fechar histórico de versões"
        onClick={onClose}
      />
      <aside
        id="studio-version-history"
        className="studio-version-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-history-title"
      >
        <header className="studio-version-drawer__header">
          <div>
            <p className="mono">Documento</p>
            <h2 id="studio-history-title" ref={headingRef} tabIndex={-1}>Histórico de versões</h2>
          </div>
          <button type="button" aria-label="Fechar histórico" onClick={onClose}>
            <i aria-hidden="true" className="ph-light ph-x" />
          </button>
        </header>

        <div className="studio-version-drawer__scroll">
          {state === "loading" ? <p className="studio-version-drawer__state" role="status">Carregando versões…</p> : null}
          {state === "error" ? (
            <div className="studio-version-drawer__state" role="alert">
              <p>Não foi possível carregar o histórico.</p>
              <button ref={retryRef} type="button" onClick={retry}>Tentar carregar versões novamente</button>
            </div>
          ) : null}
          {state === "ready" && versions.length === 0 ? (
            <p className="studio-version-drawer__state">Nenhuma versão preservada ainda.</p>
          ) : null}
          {state === "ready" && checkpoints.length > 0 ? (
            <section aria-labelledby="studio-checkpoints-title">
              <div className="studio-version-drawer__section-heading">
                <h3 id="studio-checkpoints-title">Checkpoints</h3>
                <span>{checkpoints.length}</span>
              </div>
              <div className="studio-version-drawer__list">
                {checkpoints.slice(0, visibleCount).map((version, index) => (
                  <VersionButton
                    key={version.id}
                    version={version}
                    current={index === 0}
                    selected={selectedId === version.id}
                    onSelect={() => setSelectedId(version.id)}
                  />
                ))}
              </div>
              {visibleCount < checkpoints.length ? (
                <button
                  className="studio-version-drawer__load"
                  type="button"
                  onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                >Carregar versões anteriores</button>
              ) : null}
            </section>
          ) : null}

          {state === "ready" && legacy.length > 0 ? (
            <section className="studio-version-drawer__legacy">
              <button
                type="button"
                className="studio-version-drawer__legacy-toggle"
                aria-expanded={legacyOpen}
                aria-controls="studio-legacy-versions"
                onClick={() => setLegacyOpen((expanded) => !expanded)}
              >
                <span aria-expanded={legacyOpen}>Histórico anterior</span>
                <span>{legacy.length}</span>
                <i aria-hidden="true" className={`ph-light ${legacyOpen ? "ph-caret-up" : "ph-caret-down"}`} />
              </button>
              {legacyOpen ? (
                <div id="studio-legacy-versions" className="studio-version-drawer__list">
                  {legacy.map((version) => (
                    <VersionButton
                      key={version.id}
                      version={version}
                      current={false}
                      selected={selectedId === version.id}
                      onSelect={() => setSelectedId(version.id)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {state === "ready" && selected ? (
            <section className="studio-version-drawer__preview" aria-labelledby="studio-version-preview-title">
              <div className="studio-version-drawer__section-heading">
                <h3 id="studio-version-preview-title">Prévia</h3>
                <span>Versão {selected.versionNumber}</span>
              </div>
              <div role="document" aria-label={`Prévia imutável da versão ${selected.versionNumber}`}>
                {selected.bodyText || "Esta versão não possui texto."}
              </div>
              <button type="button" disabled={restoring || !canRestore} onClick={() => void restore()}>
                {restoring ? "Restaurando…" : "Restaurar como nova versão"}
              </button>
              {!canRestore ? <small>{restoreBlockedMessage}</small> : null}
              {restoreError ? <p role="alert">{restoreError}</p> : null}
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function VersionButton({
  version,
  current,
  selected,
  onSelect
}: {
  version: StudioDocumentVersion;
  current: boolean;
  selected: boolean;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      className="studio-version-drawer__version"
      aria-label={`Versão ${version.versionNumber}${current ? ", atual" : ""}: ${version.title?.trim() || reasonLabels[version.checkpointReason ?? "legacy_autosave"]}`}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
    >
      <span className="studio-version-drawer__version-topline">
        <strong>{current ? "Versão atual" : `Versão ${version.versionNumber}`}</strong>
        <time dateTime={version.createdAt}>{formatVersionDate(version.createdAt)}</time>
      </span>
      <span className="studio-version-drawer__version-title">{version.title?.trim() || `Versão ${version.versionNumber}`}</span>
      <small>{reasonLabels[version.checkpointReason ?? "legacy_autosave"]}</small>
    </button>
  );
}

function formatVersionDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function focusableElements(container: HTMLElement | null) {
  if (!container) return [];
  return [...container.querySelectorAll<HTMLElement>(
    "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"
  )].filter((element) => !element.hasAttribute("hidden"));
}
