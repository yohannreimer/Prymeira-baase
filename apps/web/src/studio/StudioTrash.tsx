import { useEffect, useRef, useState } from "react";
import { listStudioDocuments, permanentlyDeleteStudioDocument, restoreStudioDocumentFromTrash } from "./studio-api";
import type { StudioDocument, StudioDocumentPage } from "./studio.types";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const PAGE_SIZE = 30;
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" });

type Props = {
  now?: () => Date;
  loadDocuments?: (query: { status: "trashed"; limit: number; cursor?: string }, signal: AbortSignal) => Promise<StudioDocumentPage>;
  restoreDocument?: (documentId: string, signal?: AbortSignal) => Promise<StudioDocument>;
  permanentlyDeleteDocument?: (documentId: string, signal?: AbortSignal) => Promise<void>;
};

export default function StudioTrash({
  now = () => new Date(),
  loadDocuments = defaultLoadDocuments,
  restoreDocument = restoreStudioDocumentFromTrash,
  permanentlyDeleteDocument = permanentlyDeleteStudioDocument
}: Props) {
  const [documents, setDocuments] = useState<StudioDocument[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [liveMessage, setLiveMessage] = useState("");
  const [operationError, setOperationError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<StudioDocument | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void loadDocuments({ status: "trashed", limit: PAGE_SIZE }, controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      setDocuments(unique(page.items));
      setCursor(page.nextCursor);
      setLoading(false);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted || isAbortError(reason)) return;
      setError(true);
      setLoading(false);
    });
    return () => controller.abort();
  }, [loadDocuments, reload]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await loadDocuments({ status: "trashed", limit: PAGE_SIZE, cursor }, new AbortController().signal);
      setDocuments((current) => unique([...current, ...page.items]));
      setCursor(page.nextCursor);
    } catch (reason) {
      if (!isAbortError(reason)) setLiveMessage("Não foi possível carregar mais itens da lixeira.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function restore(document: StudioDocument) {
    setOperationError("");
    setBusyId(document.id);
    try {
      await restoreDocument(document.id, new AbortController().signal);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setLiveMessage(`${displayTitle(document)} restaurado.`);
      focusRemainingContent();
    } catch (reason) {
      if (!isAbortError(reason)) {
        const message = `Não foi possível restaurar ${displayTitle(document)}.`;
        setLiveMessage(message);
        setOperationError(message);
      }
    } finally { setBusyId(null); }
  }

  async function deleteForever(document: StudioDocument) {
    setOperationError("");
    setBusyId(document.id);
    try {
      await permanentlyDeleteDocument(document.id, new AbortController().signal);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setLiveMessage(`${displayTitle(document)} excluído definitivamente.`);
      setConfirming(null);
      focusRemainingContent();
    } catch (reason) {
      if (!isAbortError(reason)) {
        const message = `Não foi possível excluir ${displayTitle(document)} definitivamente.`;
        setLiveMessage(message);
        setOperationError(message);
      }
    } finally { setBusyId(null); }
  }

  function closeDialog() {
    setConfirming(null);
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }

  function focusRemainingContent() {
    requestAnimationFrame(() => {
      const nextAction = sectionRef.current?.querySelector<HTMLElement>(".studio-trash-row button");
      if (nextAction) nextAction.focus();
      else sectionRef.current?.focus();
    });
  }

  return <section ref={sectionRef} tabIndex={-1} className="studio-trash" aria-label="Lixeira do Estúdio">
    <p className="sr-only" role="status" aria-live="polite">{liveMessage}</p>
    <div className="studio-trash__notice"><i className="ph-light ph-clock-countdown" aria-hidden="true" /><p>Os registros permanecem aqui por 30 dias antes da exclusão automática.</p></div>
    {operationError ? <p className="studio-trash__operation-error" role="alert">{operationError}</p> : null}
    {loading ? <div className="studio-trash__loading" role="status" aria-label="Abrindo lixeira"><span /><span /><span /></div> : null}
    {error ? <div className="studio-trash__error" role="alert"><p>Não foi possível abrir a lixeira agora.</p><button type="button" onClick={() => setReload((value) => value + 1)}>Tentar novamente</button></div> : null}
    {!loading && !error && documents.length === 0 ? <div className="studio-trash__empty"><i className="ph-light ph-trash" aria-hidden="true" /><p>A lixeira está vazia.</p><span>Nada precisa da sua atenção aqui.</span></div> : null}
    {documents.length ? <div className="studio-trash__list" role="list">{documents.map((document) => {
      const title = displayTitle(document);
      return <article className="studio-trash-row" role="listitem" aria-label={title} key={document.id}>
        <div className="studio-trash-row__body"><h3>{title}</h3><p>{retentionLabel(document.trashedAt, now())}</p><time dateTime={document.trashedAt ?? undefined}>{deletionDateLabel(document.trashedAt)}</time></div>
        <div className="studio-trash-row__actions">
          <button disabled={busyId === document.id} type="button" onClick={() => void restore(document)} aria-label={`Restaurar ${title}`}>Restaurar</button>
          <button disabled={busyId === document.id} type="button" className="studio-trash-row__delete" aria-label={`Excluir definitivamente ${title}`} onClick={(event) => { returnFocusRef.current = event.currentTarget; setConfirming(document); }}>Excluir definitivamente</button>
        </div>
      </article>;
    })}</div> : null}
    {cursor ? <button className="studio-trash__more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Carregando…" : "Carregar mais"}</button> : null}
    {confirming ? <PermanentDeleteDialog document={confirming} busy={busyId === confirming.id} onCancel={closeDialog} onConfirm={() => void deleteForever(confirming)} /> : null}
  </section>;
}

function PermanentDeleteDialog({ document: studioDocument, busy, onCancel, onConfirm }: { document: StudioDocument; busy: boolean; onCancel(): void; onConfirm(): void }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const phrase = confirmationPhrase(studioDocument);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) { event.preventDefault(); onCancel(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled)") ?? [])];
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && globalThis.document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && globalThis.document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    globalThis.document.addEventListener("keydown", handleKey);
    return () => globalThis.document.removeEventListener("keydown", handleKey);
  }, [busy, onCancel]);
  return <div className="studio-trash-dialog__backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <div ref={dialogRef} className="studio-trash-dialog" role="dialog" aria-modal="true" aria-labelledby="studio-trash-dialog-title" aria-describedby="studio-trash-dialog-description">
      <p className="mono">Ação irreversível</p><h2 id="studio-trash-dialog-title" className="serif">Excluir definitivamente?</h2>
      <p id="studio-trash-dialog-description">Este registro, suas versões e materiais não poderão ser recuperados.</p>
      <label>Digite <strong>{phrase}</strong> para confirmar<input ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} aria-label={`Digite ${phrase} para confirmar`} autoComplete="off" /></label>
      <div><button type="button" disabled={busy} onClick={onCancel}>Cancelar</button><button type="button" disabled={busy || value !== phrase} onClick={onConfirm}>{busy ? "Excluindo…" : "Excluir definitivamente"}</button></div>
    </div>
  </div>;
}

function defaultLoadDocuments(query: { status: "trashed"; limit: number; cursor?: string }, signal: AbortSignal) { return listStudioDocuments(query, fetch, signal); }
function displayTitle(document: StudioDocument) { return document.title?.trim() || "Documento sem título"; }
function confirmationPhrase(document: StudioDocument) { return document.title?.trim() || "EXCLUIR"; }
function deletionDateLabel(value?: string | null) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? `Movido em ${dateFormatter.format(date)}` : "Data de exclusão indisponível"; }
function retentionLabel(value: string | null | undefined, now: Date) { const timestamp = value ? Date.parse(value) : Number.NaN; if (Number.isNaN(timestamp)) return "Prazo de retenção indisponível"; const days = Math.max(0, Math.ceil((timestamp + RETENTION_MS - now.getTime()) / 86_400_000)); return days === 1 ? "Excluído automaticamente em 1 dia" : `Excluído automaticamente em ${days} dias`; }
function unique(items: StudioDocument[]) { return [...new Map(items.map((item) => [item.id, item])).values()]; }
function isAbortError(error: unknown) { return error instanceof DOMException && error.name === "AbortError"; }
