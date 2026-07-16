import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  createStudioDocument,
  createStudioCheckpoint,
  getStudioDocument,
  createStudioExitCheckpoint,
  restoreStudioDocumentVersion,
  updateStudioDocument
} from "./studio-api";
import type { StudioCitation, StudioDocument, StudioDocumentVersion, StudioInternalCitationTarget } from "./studio.types";
import { createStudioEditorExtensions, studioEditorTextOptions } from "./studio-editor-content";
import { useStudioAutosave, type AutosaveState, type StudioDocumentDraft } from "./useStudioAutosave";
import RelatedThoughts from "./RelatedThoughts";
import StudioStructures from "./StudioStructures";
import StudioVersionDrawer from "./StudioVersionDrawer";

const StudioCopilot = lazy(() => import("./StudioCopilot"));

type StudioEditorProps = {
  document: StudioDocument;
  onDocumentChange(document: StudioDocument): void;
  focusHeadingOnMount?: boolean;
  debounceMs?: number;
  onOpenDocument?(documentId: string): void;
  onOpenInternalSource?(target: StudioInternalCitationTarget, citation: StudioCitation): void;
  materialRegion?: ReactNode;
};

export type StudioEditorHandle = {
  insertTextAtLastSelection(text: string): boolean;
  insertTextAtLastSelectionWithSnapshot(text: string): StudioEditorInsertionSnapshot | null;
};

export type StudioEditorInsertionSnapshot = {
  baseRevision: number;
  bodyJson: Record<string, unknown>;
  bodyText: string;
  signature: string;
};

function canonicalBodyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalBodyValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalBodyValue(child)]));
}

function insertionSignature(bodyJson: Record<string, unknown>, bodyText: string) {
  return JSON.stringify({ bodyJson: canonicalBodyValue(bodyJson), bodyText });
}

const saveLabels: Record<AutosaveState, string> = {
  idle: "Pronto para escrever",
  dirty: "Alterações locais",
  saving: "Salvando…",
  saved: "Salvo",
  offline: "Salvo neste dispositivo",
  conflict: "Atenção necessária",
  error: "Não foi possível salvar"
};

function documentContent(document: StudioDocument, recovered: StudioDocumentDraft | null) {
  return recovered?.bodyJson ?? document.bodyJson;
}

function operationKey() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const StudioEditor = forwardRef<StudioEditorHandle, StudioEditorProps>((props, ref) => (
  <StudioEditorSession key={props.document.id} ref={ref} {...props} />
));

StudioEditor.displayName = "StudioEditor";

export default StudioEditor;

const StudioEditorSession = forwardRef<StudioEditorHandle, StudioEditorProps>(function StudioEditorSession({
  document: sourceDocument,
  onDocumentChange,
  focusHeadingOnMount = false,
  debounceMs,
  onOpenDocument,
  onOpenInternalSource,
  materialRegion
}: StudioEditorProps, ref) {
  const save = useCallback((draft: StudioDocumentDraft, expectedRevision: number, signal?: AbortSignal) => (
    updateStudioDocument(sourceDocument.id, {
      expected_revision: expectedRevision,
      title: draft.title,
      body_json: draft.bodyJson,
      body_text: draft.bodyText
    }, signal)
  ), [sourceDocument.id]);
  const checkpoint = useCallback((expectedRevision: number, reason: "significant_pause" | "document_exit", signal?: AbortSignal) => (
    createStudioCheckpoint(
      sourceDocument.id,
      { expected_revision: expectedRevision, reason },
      signal,
      fetch,
      { keepalive: reason === "document_exit" }
    )
  ), [sourceDocument.id]);
  const exitCheckpoint = useCallback((knownRevision: number) => (
    createStudioExitCheckpoint(sourceDocument.id, { known_revision: knownRevision })
  ), [sourceDocument.id]);
  const autosave = useStudioAutosave(sourceDocument, save, { debounceMs, checkpoint, exitCheckpoint });
  const [title, setTitle] = useState(autosave.initialDraft?.title ?? sourceDocument.title ?? "");
  const titleRef = useRef(title);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const notifiedRevisionRef = useRef(sourceDocument.revision);
  const appliedSourceRevisionRef = useRef(sourceDocument.revision);
  const versionsTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreVersionsTriggerFocusRef = useRef(false);
  const conflictCopyOperationRef = useRef<{ signature: string; key: string } | null>(null);
  const editGenerationRef = useRef(0);
  const lastSelectionRef = useRef<{ from: number; to: number; isTextSelection: boolean } | null>(null);
  const asyncActionTokenRef = useRef(0);
  const sourceDocumentIdRef = useRef(sourceDocument.id);
  const [linkFieldOpen, setLinkFieldOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [resolving, setResolving] = useState<"reload" | "copy" | null>(null);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [versionFeedback, setVersionFeedback] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [selectedText, setSelectedText] = useState("");

  titleRef.current = title;
  sourceDocumentIdRef.current = sourceDocument.id;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: createStudioEditorExtensions(),
    content: documentContent(sourceDocument, autosave.initialDraft),
    editorProps: {
      attributes: {
        "aria-label": "Conteúdo do documento",
        class: "studio-editor__prose",
        role: "textbox"
      }
    },
    onUpdate({ editor: currentEditor }) {
      editGenerationRef.current += 1;
      autosave.queueSave({
        title: titleRef.current.trim() || null,
        bodyJson: currentEditor.getJSON(),
        bodyText: currentEditor.getText(studioEditorTextOptions)
      });
    },
    onSelectionUpdate({ editor: currentEditor }) {
      const selection = currentEditor.state.selection;
      const { from, to } = selection;
      lastSelectionRef.current = {
        from,
        to,
        isTextSelection: selection.$from.parent.inlineContent
          && selection.$to.parent.inlineContent
          && !("node" in selection)
      };
      setSelectedText(from === to ? "" : currentEditor.state.doc.textBetween(from, Math.min(to, from + 4_000), "\n"));
    }
  });

  function insertTextAtLastSelectionWithSnapshot(text: string): StudioEditorInsertionSnapshot | null {
    const normalizedText = text.trim();
    if (!editor || editor.isDestroyed || !normalizedText) return null;
    const paragraphs = normalizedText
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({
        type: "paragraph",
        content: [{ type: "text", text: line }]
      }));
    if (paragraphs.length === 0) return null;

    const currentDocument = editor.state.doc;
    const documentSize = currentDocument.content.size;
    const savedSelection = lastSelectionRef.current;
    const hasValidSelectionBounds = savedSelection !== null
      && savedSelection.isTextSelection
      && Number.isInteger(savedSelection.from)
      && Number.isInteger(savedSelection.to)
      && savedSelection.from > 0
      && savedSelection.to >= savedSelection.from
      && savedSelection.to < documentSize;
    const hasValidSelection = hasValidSelectionBounds
      && currentDocument.resolve(savedSelection.from).parent.inlineContent
      && currentDocument.resolve(savedSelection.to).parent.inlineContent;
    const chain = editor.chain().focus();
    let inserted: boolean;
    if (hasValidSelection) {
      inserted = chain
        .setTextSelection({ from: savedSelection!.from, to: savedSelection!.to })
        .insertContent(paragraphs)
        .run();
    } else {
      const isEmptyDocument = currentDocument.childCount === 0
        || (currentDocument.childCount === 1
          && currentDocument.firstChild?.isTextblock
          && currentDocument.firstChild.content.size === 0);
      const fallbackPosition = isEmptyDocument
        ? { from: 0, to: documentSize }
        : documentSize;
      inserted = chain.insertContentAt(fallbackPosition, paragraphs).run();
    }
    if (!inserted) return null;
    const bodyJson = editor.getJSON();
    const bodyText = editor.getText(studioEditorTextOptions);
    return {
      baseRevision: autosave.document.revision,
      bodyJson,
      bodyText,
      signature: insertionSignature(bodyJson, bodyText)
    };
  }

  useImperativeHandle(ref, () => ({
    insertTextAtLastSelection(text: string) {
      return insertTextAtLastSelectionWithSnapshot(text) !== null;
    },
    insertTextAtLastSelectionWithSnapshot
  }), [editor, autosave.document.revision]);

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor?.isActive("bold") ?? false,
      italic: currentEditor?.isActive("italic") ?? false,
      bulletList: currentEditor?.isActive("bulletList") ?? false,
      link: currentEditor?.isActive("link") ?? false
    })
  });

  const queueCurrent = useCallback((nextTitle: string) => {
    if (!editor) return;
    editGenerationRef.current += 1;
    autosave.queueSave({
      title: nextTitle.trim() || null,
      bodyJson: editor.getJSON(),
      bodyText: editor.getText(studioEditorTextOptions)
    });
  }, [autosave.queueSave, editor]);

  const getCurrentEditorDraft = useCallback((): StudioDocumentDraft => ({
    title: titleRef.current.trim() || null,
    bodyJson: editor?.getJSON() ?? autosave.currentDraft?.bodyJson ?? autosave.document.bodyJson,
    bodyText: editor?.getText(studioEditorTextOptions) ?? autosave.currentDraft?.bodyText ?? autosave.document.bodyText
  }), [autosave.currentDraft, autosave.document.bodyJson, autosave.document.bodyText, editor]);

  const captureEditorGeneration = useCallback(() => {
    const draft = getCurrentEditorDraft();
    return {
      documentId: sourceDocumentIdRef.current,
      revision: autosave.document.revision,
      generation: editGenerationRef.current,
      signature: JSON.stringify(draft)
    };
  }, [autosave.document.revision, getCurrentEditorDraft]);

  const isCurrentEditorGeneration = useCallback((snapshot: ReturnType<typeof captureEditorGeneration>) => (
    snapshot.documentId === sourceDocumentIdRef.current
    && snapshot.revision === autosave.document.revision
    && snapshot.generation === editGenerationRef.current
    && snapshot.signature === JSON.stringify(getCurrentEditorDraft())
  ), [autosave.document.revision, getCurrentEditorDraft]);

  useEffect(() => {
    if (focusHeadingOnMount) headingRef.current?.focus();
  }, [focusHeadingOnMount]);

  useEffect(() => {
    if (autosave.document.revision === notifiedRevisionRef.current) return;
    if (sourceDocument.id === autosave.document.id
      && sourceDocument.revision >= autosave.document.revision) {
      notifiedRevisionRef.current = autosave.document.revision;
      return;
    }
    notifiedRevisionRef.current = autosave.document.revision;
    onDocumentChange(autosave.document);
  }, [autosave.document, onDocumentChange, sourceDocument.id, sourceDocument.revision]);

  useEffect(() => {
    const adoptedRevision = autosave.adoptedSourceRevision;
    if (!editor
      || adoptedRevision === null
      || adoptedRevision <= appliedSourceRevisionRef.current
      || sourceDocument.id !== autosave.document.id
      || adoptedRevision !== autosave.document.revision) return;
    editGenerationRef.current += 1;
    appliedSourceRevisionRef.current = adoptedRevision;
    notifiedRevisionRef.current = adoptedRevision;
    const nextTitle = autosave.document.title ?? "";
    titleRef.current = nextTitle;
    setTitle(nextTitle);
    editor.commands.setContent(autosave.document.bodyJson, { emitUpdate: false });
  }, [autosave.adoptedSourceRevision, autosave.document, editor, sourceDocument.id]);

  useEffect(() => {
    if (!versionsOpen) {
      if (restoreVersionsTriggerFocusRef.current) {
        restoreVersionsTriggerFocusRef.current = false;
        versionsTriggerRef.current?.focus();
      }
    }
  }, [versionsOpen]);

  const conflictSignature = autosave.state === "conflict" && autosave.conflictDraft
    ? `${sourceDocument.id}:${JSON.stringify(autosave.conflictDraft)}`
    : null;

  useEffect(() => {
    if (!conflictSignature) {
      conflictCopyOperationRef.current = null;
      return;
    }
    if (conflictCopyOperationRef.current?.signature !== conflictSignature) {
      conflictCopyOperationRef.current = { signature: conflictSignature, key: operationKey() };
    }
  }, [conflictSignature]);

  const applyDocument = useCallback((nextDocument: StudioDocument, discardLocalDraft = true) => {
    editGenerationRef.current += 1;
    autosave.resolveConflict(nextDocument, discardLocalDraft);
    notifiedRevisionRef.current = nextDocument.revision;
    appliedSourceRevisionRef.current = nextDocument.revision;
    const nextTitle = nextDocument.title ?? "";
    titleRef.current = nextTitle;
    setTitle(nextTitle);
    editor?.commands.setContent(nextDocument.bodyJson, { emitUpdate: false });
    onDocumentChange(nextDocument);
  }, [autosave.resolveConflict, editor, onDocumentChange]);

  async function reloadServerVersion() {
    const token = ++asyncActionTokenRef.current;
    const snapshot = captureEditorGeneration();
    setResolving("reload");
    setResolutionError(null);
    const controller = new AbortController();
    try {
      const serverDocument = await getStudioDocument(sourceDocument.id, fetch, controller.signal);
      if (!isCurrentEditorGeneration(snapshot)) {
        if (asyncActionTokenRef.current === token) {
          setResolutionError("A versão do servidor foi carregada, mas não foi aplicada porque você continuou editando.");
        }
        return;
      }
      applyDocument(serverDocument);
    } catch {
      setResolutionError("Não foi possível buscar a versão do servidor agora.");
    } finally {
      if (asyncActionTokenRef.current === token) setResolving(null);
    }
  }

  async function keepLocalCopy() {
    const local = autosave.conflictDraft;
    if (!local) return;
    const signature = `${sourceDocument.id}:${JSON.stringify(local)}`;
    if (conflictCopyOperationRef.current?.signature !== signature) {
      conflictCopyOperationRef.current = { signature, key: operationKey() };
    }
    const token = ++asyncActionTokenRef.current;
    const snapshot = captureEditorGeneration();
    setResolving("copy");
    setResolutionError(null);
    try {
      const copy = await createStudioDocument({
        title: local.title ? `${local.title} (cópia)` : "Cópia recuperada",
        body_json: local.bodyJson,
        body_text: local.bodyText,
        capture_mode: "text",
        capture_key: conflictCopyOperationRef.current.key
      });
      if (!isCurrentEditorGeneration(snapshot)) {
        if (asyncActionTokenRef.current === token) {
          setResolutionError("A cópia foi criada, mas você continuou editando; sua versão atual permanece aberta.");
        }
        return;
      }
      applyDocument(copy);
    } catch {
      setResolutionError("Sua cópia continua guardada neste dispositivo. Tente novamente quando estiver online.");
    } finally {
      if (asyncActionTokenRef.current === token) setResolving(null);
    }
  }

  function applyLink() {
    if (!editor) return;
    const value = linkUrl.trim();
    if (!value) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: value }).run();
    setLinkFieldOpen(false);
    setLinkUrl("");
  }

  async function restoreVersion(selectedVersion: StudioDocumentVersion) {
    if (autosave.state !== "saved" && autosave.state !== "idle") return;
    const token = ++asyncActionTokenRef.current;
    const snapshot = captureEditorGeneration();
    setResolutionError(null);
    setVersionFeedback(null);
    try {
      const restored = await restoreStudioDocumentVersion(sourceDocument.id, selectedVersion.id, {
        expected_revision: autosave.document.revision
      });
      if (!isCurrentEditorGeneration(snapshot)) {
        autosave.markConflict(getCurrentEditorDraft());
        setResolutionError("A versão foi restaurada no servidor, mas sua edição mais recente permanece aberta para você decidir como continuar.");
        restoreVersionsTriggerFocusRef.current = true;
        setVersionsOpen(false);
        return;
      }
      applyDocument(restored.document);
      setVersionFeedback(`Versão ${selectedVersion.versionNumber} restaurada como uma nova versão.`);
      closeVersions();
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 409) {
        const currentDraft = isCurrentEditorGeneration(snapshot)
          ? {
              title: titleRef.current.trim() || null,
              bodyJson: selectedVersion.bodyJson,
              bodyText: selectedVersion.bodyText
            }
          : getCurrentEditorDraft();
        setResolutionError(isCurrentEditorGeneration(snapshot)
          ? null
          : "O servidor mudou durante a restauração. Sua edição mais recente foi preservada para você decidir como continuar.");
        autosave.markConflict(currentDraft);
        restoreVersionsTriggerFocusRef.current = true;
        setVersionsOpen(false);
      } else {
        setResolutionError("Não foi possível restaurar esta versão agora.");
        throw error;
      }
    }
  }

  const hasUnsavedChanges = !["idle", "saved"].includes(autosave.state);
  const canAcceptSuggestion = !hasUnsavedChanges && !autosave.storageUnavailable;
  const suggestionAcceptanceStatus = autosave.storageUnavailable
    ? "O armazenamento local está indisponível. Resolva o salvamento antes de aceitar uma proposta."
    : autosave.state === "saving" || autosave.state === "dirty"
      ? "Aguarde suas alterações serem salvas antes de aceitar a proposta."
      : autosave.state === "conflict"
        ? "Resolva o conflito de versões antes de aceitar a proposta."
        : "Tente salvar novamente antes de aceitar a proposta.";
  const saveLabel = autosave.state === "offline" && autosave.storageUnavailable
    ? "Servidor indisponível"
    : saveLabels[autosave.state];

  const closeVersions = useCallback(() => {
    restoreVersionsTriggerFocusRef.current = true;
    setVersionsOpen(false);
  }, []);

  return (
    <div className="studio-writing-layout">
    <article className="studio-editor" aria-labelledby="studio-document-heading">
      <h2
        className="sr-only"
        id="studio-document-heading"
        ref={headingRef}
        tabIndex={-1}
      >{autosave.document.title || "Captura sem título"}</h2>

      <header className="studio-editor__header">
        <label className="sr-only" htmlFor="studio-document-title">Título do documento</label>
        <input
          id="studio-document-title"
          className="studio-editor__title serif"
          aria-label="Título do documento"
          value={title}
          placeholder="Sem título"
          onChange={(event) => {
            const nextTitle = event.currentTarget.value;
            titleRef.current = nextTitle;
            setTitle(nextTitle);
            queueCurrent(nextTitle);
          }}
        />
        <div className="studio-editor__save-line">
          <span className="studio-editor__save-status" role="status" aria-live="polite" aria-atomic="true" aria-label="Estado do salvamento" data-state={autosave.state}>
            <i aria-hidden="true" className={`ph-light ${autosave.state === "saving" ? "ph-circle-notch" : autosave.state === "saved" ? "ph-check" : "ph-cloud"}`} />
            {saveLabel}
          </span>
          <button
            type="button"
            className="studio-editor__history-trigger"
            ref={versionsTriggerRef}
            aria-expanded={versionsOpen}
            aria-controls="studio-version-history"
            onClick={() => setVersionsOpen(true)}
          >
            <i aria-hidden="true" className="ph-light ph-clock-counter-clockwise" />
            Ver histórico de versões
          </button>
        </div>
        <StudioStructures documentId={sourceDocument.id} documentTitle={title.trim() || null} />
      </header>

      <div className="studio-editor__toolbar" role="toolbar" aria-label="Formatação do documento">
        <button type="button" aria-label="Negrito" aria-pressed={toolbarState?.bold ?? false} onClick={() => editor?.chain().focus().toggleBold().run()}>
          <i aria-hidden="true" className="ph-bold ph-text-b" />
        </button>
        <button type="button" aria-label="Itálico" aria-pressed={toolbarState?.italic ?? false} onClick={() => editor?.chain().focus().toggleItalic().run()}>
          <i aria-hidden="true" className="ph-bold ph-text-italic" />
        </button>
        <button type="button" aria-label="Lista com marcadores" aria-pressed={toolbarState?.bulletList ?? false} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
          <i aria-hidden="true" className="ph-bold ph-list-bullets" />
        </button>
        <button type="button" aria-label="Formatar hyperlink no texto" aria-expanded={linkFieldOpen} aria-pressed={toolbarState?.link ?? false} onClick={() => setLinkFieldOpen((open) => !open)}>
          <i aria-hidden="true" className="ph-bold ph-link" />
        </button>
      </div>
      {linkFieldOpen ? (
        <div className="studio-editor__link-field">
          <label htmlFor="studio-editor-link">Endereço do link</label>
          <input id="studio-editor-link" type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.currentTarget.value)} placeholder="https://" />
          <button type="button" onClick={applyLink}>Aplicar</button>
        </div>
      ) : null}

      <EditorContent editor={editor} className="studio-editor__canvas" />

      {autosave.storageUnavailable ? (
        <div
          className="studio-editor__notice"
          role="alert"
          aria-label="Armazenamento local indisponível"
        >
          <p>Não foi possível guardar neste dispositivo. Mantenha esta aba aberta: esta aba é a única cópia local das alterações ainda não enviadas.</p>
          <button type="button" onClick={() => void autosave.retry()}>Tentar salvar novamente</button>
        </div>
      ) : null}

      {autosave.state === "offline" || autosave.state === "error" ? (
        <div className="studio-editor__notice" role="alert">
          <p>{autosave.state === "offline"
            ? autosave.storageUnavailable
              ? "O servidor está indisponível. Sua escrita continua apenas nesta aba até uma nova tentativa."
              : "Sua escrita está guardada neste dispositivo e será enviada quando você tentar novamente."
              : "Sua escrita está preservada, mas o servidor não conseguiu salvá-la."}</p>
          <button type="button" onClick={() => void autosave.retry()}>Tentar salvar novamente</button>
        </div>
      ) : null}

      {autosave.recoveryWarning ? (
        <div
          className="studio-editor__resolution-error"
          role="alert"
          aria-label="Rascunho local inválido"
        >
          <p>
            {autosave.recoveryWarning}{" "}
            {autosave.recoveryQuarantined
              ? "Você pode descartá-lo agora; caso contrário, ele será removido automaticamente."
              : "O conteúdo inválido não foi aberto para proteger o Estúdio."}
          </p>
          {autosave.recoveryQuarantined ? (
            <button type="button" onClick={autosave.discardRecoveryWarning}>Descartar rascunho inválido</button>
          ) : null}
        </div>
      ) : null}

      {autosave.state === "conflict" ? (
        <div className="studio-editor__notice studio-editor__notice--conflict" role="alert" aria-label="Conflito de versões">
          <div>
            <strong>Há uma versão mais recente no servidor.</strong>
            <p>Escolha qual caminho seguir. Sua cópia local não será sobrescrita sem confirmação.</p>
          </div>
          <div className="studio-editor__notice-actions">
            <button type="button" disabled={resolving !== null} onClick={() => void reloadServerVersion()}>Recarregar versão do servidor</button>
            <button type="button" disabled={resolving !== null} onClick={() => void keepLocalCopy()}>Manter minha cópia como novo documento</button>
          </div>
        </div>
      ) : null}
      {resolutionError ? <p className="studio-editor__resolution-error" role="alert">{resolutionError}</p> : null}
      {versionFeedback ? <p className="studio-editor__version-feedback" role="status">{versionFeedback}</p> : null}

      <StudioVersionDrawer
        documentId={sourceDocument.id}
        open={versionsOpen}
        onClose={closeVersions}
        onRestore={restoreVersion}
        canRestore={!hasUnsavedChanges}
      />
      {materialRegion}
    </article>
    <aside className="studio-editor__context" aria-label="Conexões deste documento">
      <RelatedThoughts documentId={sourceDocument.id} onOpenDocument={onOpenDocument} />
    </aside>
    <Suspense fallback={<div className="studio-copilot-skeleton" role="status" aria-label="Abrindo copiloto"><span /><span /><span /></div>}>
      <StudioCopilot
        document={autosave.document}
        selectedText={selectedText}
        onDocumentChange={(nextDocument) => applyDocument(nextDocument)}
        suggestionAcceptance={{
          canAccept: canAcceptSuggestion,
          status: suggestionAcceptanceStatus,
          capture: captureEditorGeneration,
          isCurrent: isCurrentEditorGeneration,
          onConflict: () => {
            autosave.markConflict(getCurrentEditorDraft());
            setResolutionError("A proposta foi salva como nova versão no servidor, mas sua edição local mudou durante o aceite. Sua escrita foi preservada para você decidir como continuar.");
          }
        }}
        onOpenInternalSource={(target, citation) => {
          if (target.kind === "studio_document" && target.resourceId) onOpenDocument?.(target.resourceId);
          else onOpenInternalSource?.(target, citation);
        }}
      />
    </Suspense>
    </div>
  );
});
