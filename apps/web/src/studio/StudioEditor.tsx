import Link from "@tiptap/extension-link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createStudioDocument,
  getStudioDocument,
  listStudioDocumentVersions,
  updateStudioDocument
} from "./studio-api";
import type { StudioDocument, StudioDocumentVersion } from "./studio.types";
import { useStudioAutosave, type AutosaveState, type StudioDocumentDraft } from "./useStudioAutosave";

type StudioEditorProps = {
  document: StudioDocument;
  onDocumentChange(document: StudioDocument): void;
  focusHeadingOnMount?: boolean;
  debounceMs?: number;
};

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

function formatVersionDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
  }).format(new Date(value));
}

export default function StudioEditor({
  document: sourceDocument,
  onDocumentChange,
  focusHeadingOnMount = false,
  debounceMs
}: StudioEditorProps) {
  const save = useCallback((draft: StudioDocumentDraft, expectedRevision: number, signal?: AbortSignal) => (
    updateStudioDocument(sourceDocument.id, {
      expected_revision: expectedRevision,
      title: draft.title,
      body_json: draft.bodyJson,
      body_text: draft.bodyText
    }, signal)
  ), [sourceDocument.id]);
  const autosave = useStudioAutosave(sourceDocument, save, { debounceMs });
  const [title, setTitle] = useState(autosave.initialDraft?.title ?? sourceDocument.title ?? "");
  const titleRef = useRef(title);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const notifiedRevisionRef = useRef(sourceDocument.revision);
  const [linkFieldOpen, setLinkFieldOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [resolving, setResolving] = useState<"reload" | "copy" | null>(null);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<StudioDocumentVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<StudioDocumentVersion | null>(null);
  const [versionsState, setVersionsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [restoring, setRestoring] = useState(false);

  titleRef.current = title;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer" } })
    ],
    content: documentContent(sourceDocument, autosave.initialDraft),
    editorProps: {
      attributes: {
        "aria-label": "Conteúdo do documento",
        class: "studio-editor__prose",
        role: "textbox"
      }
    },
    onUpdate({ editor: currentEditor }) {
      autosave.queueSave({
        title: titleRef.current.trim() || null,
        bodyJson: currentEditor.getJSON(),
        bodyText: currentEditor.getText()
      });
    }
  });

  const queueCurrent = useCallback((nextTitle: string) => {
    if (!editor) return;
    autosave.queueSave({
      title: nextTitle.trim() || null,
      bodyJson: editor.getJSON(),
      bodyText: editor.getText()
    });
  }, [autosave.queueSave, editor]);

  useEffect(() => {
    if (focusHeadingOnMount) headingRef.current?.focus();
  }, [focusHeadingOnMount]);

  useEffect(() => {
    if (autosave.document.revision === notifiedRevisionRef.current) return;
    notifiedRevisionRef.current = autosave.document.revision;
    onDocumentChange(autosave.document);
  }, [autosave.document, onDocumentChange]);

  useEffect(() => {
    if (sourceDocument.id === autosave.document.id) return;
    const recovered = autosave.initialDraft;
    const nextTitle = recovered?.title ?? sourceDocument.title ?? "";
    titleRef.current = nextTitle;
    setTitle(nextTitle);
    editor?.commands.setContent(documentContent(sourceDocument, recovered), { emitUpdate: false });
  }, [autosave.document.id, autosave.initialDraft, editor, sourceDocument]);

  useEffect(() => {
    if (!versionsOpen) return;
    const controller = new AbortController();
    setVersionsState("loading");
    void listStudioDocumentVersions(sourceDocument.id, fetch, controller.signal).then((loaded) => {
      if (controller.signal.aborted) return;
      const newestFirst = [...loaded].sort((left, right) => right.versionNumber - left.versionNumber);
      setVersions(newestFirst);
      setSelectedVersion((current) => current
        ? newestFirst.find((version) => version.id === current.id) ?? newestFirst[0] ?? null
        : newestFirst[0] ?? null);
      setVersionsState("ready");
    }).catch(() => {
      if (!controller.signal.aborted) setVersionsState("error");
    });
    return () => controller.abort();
  }, [sourceDocument.id, versionsOpen]);

  const applyDocument = useCallback((nextDocument: StudioDocument, discardLocalDraft = true) => {
    autosave.resolveConflict(nextDocument, discardLocalDraft);
    notifiedRevisionRef.current = nextDocument.revision;
    const nextTitle = nextDocument.title ?? "";
    titleRef.current = nextTitle;
    setTitle(nextTitle);
    editor?.commands.setContent(nextDocument.bodyJson, { emitUpdate: false });
    onDocumentChange(nextDocument);
  }, [autosave.resolveConflict, editor, onDocumentChange]);

  async function reloadServerVersion() {
    setResolving("reload");
    setResolutionError(null);
    const controller = new AbortController();
    try {
      const serverDocument = await getStudioDocument(sourceDocument.id, fetch, controller.signal);
      applyDocument(serverDocument);
    } catch {
      setResolutionError("Não foi possível buscar a versão do servidor agora.");
    } finally {
      setResolving(null);
    }
  }

  async function keepLocalCopy() {
    const local = autosave.conflictDraft;
    if (!local) return;
    setResolving("copy");
    setResolutionError(null);
    try {
      const copy = await createStudioDocument({
        title: local.title ? `${local.title} (cópia)` : "Cópia recuperada",
        body_json: local.bodyJson,
        body_text: local.bodyText,
        capture_mode: "text",
        capture_key: operationKey()
      });
      applyDocument(copy);
    } catch {
      setResolutionError("Sua cópia continua guardada neste dispositivo. Tente novamente quando estiver online.");
    } finally {
      setResolving(null);
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

  async function restoreSelectedVersion() {
    if (!selectedVersion || (autosave.state !== "saved" && autosave.state !== "idle")) return;
    setRestoring(true);
    setResolutionError(null);
    try {
      const restored = await updateStudioDocument(sourceDocument.id, {
        expected_revision: autosave.document.revision,
        body_json: selectedVersion.bodyJson,
        body_text: selectedVersion.bodyText
      });
      applyDocument(restored);
      setVersionsOpen(false);
    } catch (error) {
      setResolutionError(error instanceof Error && "status" in error && error.status === 409
        ? "O documento mudou enquanto o histórico estava aberto. Recarregue a versão do servidor."
        : "Não foi possível restaurar esta versão agora.");
    } finally {
      setRestoring(false);
    }
  }

  const hasUnsavedChanges = !["idle", "saved"].includes(autosave.state);

  return (
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
          <span className="studio-editor__save-status" role="status" aria-label="Estado do salvamento" data-state={autosave.state}>
            <i aria-hidden="true" className={`ph-light ${autosave.state === "saving" ? "ph-circle-notch" : autosave.state === "saved" ? "ph-check" : "ph-cloud"}`} />
            {saveLabels[autosave.state]}
          </span>
          <button type="button" className="studio-editor__history-trigger" onClick={() => setVersionsOpen(true)}>
            <i aria-hidden="true" className="ph-light ph-clock-counter-clockwise" />
            Ver histórico de versões
          </button>
        </div>
      </header>

      <div className="studio-editor__toolbar" role="toolbar" aria-label="Formatação do documento">
        <button type="button" aria-label="Negrito" aria-pressed={editor?.isActive("bold") ?? false} onClick={() => editor?.chain().focus().toggleBold().run()}>
          <i aria-hidden="true" className="ph-bold ph-text-b" />
        </button>
        <button type="button" aria-label="Itálico" aria-pressed={editor?.isActive("italic") ?? false} onClick={() => editor?.chain().focus().toggleItalic().run()}>
          <i aria-hidden="true" className="ph-bold ph-text-italic" />
        </button>
        <button type="button" aria-label="Lista com marcadores" aria-pressed={editor?.isActive("bulletList") ?? false} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
          <i aria-hidden="true" className="ph-bold ph-list-bullets" />
        </button>
        <button type="button" aria-label="Adicionar ou remover link" aria-expanded={linkFieldOpen} onClick={() => setLinkFieldOpen((open) => !open)}>
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

      {autosave.state === "offline" || autosave.state === "error" ? (
        <div className="studio-editor__notice" role="alert">
          <p>{autosave.state === "offline"
            ? "Sua escrita está guardada neste dispositivo e será enviada quando você tentar novamente."
            : "Sua escrita está preservada, mas o servidor não conseguiu salvá-la."}</p>
          <button type="button" onClick={() => void autosave.retry()}>Tentar salvar novamente</button>
        </div>
      ) : null}

      {autosave.state === "conflict" ? (
        <div className="studio-editor__notice studio-editor__notice--conflict" role="alert">
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

      {versionsOpen ? (
        <aside className="studio-versions" role="region" aria-label="Histórico de versões">
          <header>
            <div><p className="mono">Histórico</p><h3>Versões preservadas</h3></div>
            <button type="button" aria-label="Fechar histórico de versões" onClick={() => setVersionsOpen(false)}>
              <i aria-hidden="true" className="ph-light ph-x" />
            </button>
          </header>
          {versionsState === "loading" ? <p role="status">Carregando versões…</p> : null}
          {versionsState === "error" ? <p role="alert">Não foi possível carregar o histórico.</p> : null}
          {versionsState === "ready" ? (
            <div className="studio-versions__body">
              <div className="studio-versions__list" aria-label="Versões disponíveis">
                {versions.map((version) => (
                  <button
                    type="button"
                    key={version.id}
                    aria-current={selectedVersion?.id === version.id ? "true" : undefined}
                    onClick={() => setSelectedVersion(version)}
                  >
                    <strong>Versão {version.versionNumber}</strong>
                    <span>{formatVersionDate(version.createdAt)}</span>
                  </button>
                ))}
              </div>
              {selectedVersion ? (
                <div className="studio-versions__preview">
                  <div role="document" aria-label={`Prévia imutável da versão ${selectedVersion.versionNumber}`}>
                    {selectedVersion.bodyText || "Esta versão não possui texto."}
                  </div>
                  <button type="button" disabled={restoring || hasUnsavedChanges} onClick={() => void restoreSelectedVersion()}>
                    {restoring ? "Restaurando…" : "Restaurar como nova versão"}
                  </button>
                  {hasUnsavedChanges ? <small>Salve ou resolva as alterações atuais antes de restaurar.</small> : null}
                </div>
              ) : <p>Nenhuma versão disponível.</p>}
            </div>
          ) : null}
        </aside>
      ) : null}
    </article>
  );
}
