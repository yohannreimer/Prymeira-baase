import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  acceptStudioSuggestion,
  dismissStudioSuggestion,
  startStudioAssistantTurn,
  StudioAssistantStreamError
} from "./studio-api";
import StudioCitations from "./StudioCitations";
import OperationPreview from "./OperationPreview";
import type {
  StudioCitation,
  StudioDocument,
  StudioInternalCitationTarget,
  StudioOperationDraft,
  StudioSuggestion
} from "./studio.types";

type Props = {
  document: StudioDocument;
  selectedText?: string;
  onDocumentChange(document: StudioDocument): void;
  onOpenInternalSource?(target: StudioInternalCitationTarget, citation: StudioCitation): void;
  suggestionAcceptance?: StudioSuggestionAcceptanceGuard;
};

export type StudioEditorAcceptanceSnapshot = {
  documentId: string;
  revision: number;
  generation: number;
  signature: string;
};

export type StudioSuggestionAcceptanceGuard = {
  canAccept: boolean;
  status: string;
  capture(): StudioEditorAcceptanceSnapshot;
  isCurrent(snapshot: StudioEditorAcceptanceSnapshot): boolean;
  onConflict(): void;
};

type AssistantTurn = {
  id: number;
  prompt: string;
  response: string;
  citations: StudioCitation[];
  suggestion: StudioSuggestion | null;
  status: "streaming" | "complete" | "cancelled" | "error";
};

type StudioCopilotRequest = {
  message: string;
  research: boolean;
  suggestion: boolean;
  selection: string;
  operationalContext: NonNullable<Parameters<typeof startStudioAssistantTurn>[0]["operationalContext"]> | null;
};

const WIDTH_KEY = "baase:studio:copilot-width";
const MIN_WIDTH = 300;
const MAX_WIDTH = 520;
const OPERATIONAL_RESOURCE_TYPES = [
  "dashboard", "task", "routine", "process", "training", "announcement", "people"
] as const;

export default function StudioCopilot({ document, selectedText = "", onDocumentChange, onOpenInternalSource, suggestionAcceptance }: Props) {
  const [open, setOpen] = useState(true);
  const [compact, setCompact] = useState(() => window.matchMedia?.("(max-width: 900px)").matches ?? false);
  const [width, setWidth] = useState(readWidth);
  const [prompt, setPrompt] = useState("");
  const [allowResearch, setAllowResearch] = useState(false);
  const [useOperationalContext, setUseOperationalContext] = useState(false);
  const [operationalFrom, setOperationalFrom] = useState(() => relativeDate(-30));
  const [operationalTo, setOperationalTo] = useState(() => relativeDate(0));
  const [requestSuggestion, setRequestSuggestion] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState("Copiloto pronto.");
  const panelRef = useRef<HTMLElement>(null);
  const openTriggerRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const streamErrorRef = useRef<HTMLDivElement>(null);
  const liveStatusRef = useRef<HTMLParagraphElement>(null);
  const generationRef = useRef(0);
  const turnIdRef = useRef(0);
  const activeRef = useRef<ReturnType<typeof startStudioAssistantTurn> | null>(null);
  const retryRef = useRef<StudioCopilotRequest | null>(null);
  const bufferedDeltasRef = useRef(new Map<number, string[]>());
  const deltaFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 900px)");
    if (!media) return;
    const update = () => setCompact(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => () => {
    generationRef.current += 1;
    activeRef.current?.controller.abort();
    discardBufferedDeltas();
    window.document.body.style.overflow = "";
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    activeRef.current?.controller.abort();
    activeRef.current = null;
    discardBufferedDeltas();
    setConversationId(null);
    setTurns([]);
    setStreaming(false);
    setStreamError(null);
    setLiveStatus("Copiloto pronto.");
  }, [document.id]);

  useEffect(() => {
    if (!open) queueMicrotask(() => openTriggerRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (streamError) streamErrorRef.current?.focus();
  }, [streamError]);

  useEffect(() => {
    if (liveStatus.startsWith("Resposta interrompida por você")) liveStatusRef.current?.focus();
  }, [liveStatus]);

  useEffect(() => {
    if (!compact || !open) {
      documentBodyUnlock();
      return;
    }
    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    queueMicrotask(() => composerRef.current?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        queueMicrotask(() => openTriggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href]"
      ));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.document.addEventListener("keydown", keydown);
    return () => {
      window.document.removeEventListener("keydown", keydown);
      window.document.body.style.overflow = previousOverflow;
    };
  }, [compact, open]);

  async function send(request: StudioCopilotRequest = {
    message: prompt.trim(), research: allowResearch, suggestion: requestSuggestion && !selectedText.trim(),
    selection: selectedText.trim().slice(0, 4_000),
    operationalContext: useOperationalContext ? {
      from: operationalFrom || null,
      to: operationalTo || null,
      resourceTypes: [...OPERATIONAL_RESOURCE_TYPES],
      personIds: []
    } : null
  }) {
    if (!request.message || streaming) return;
    setPrompt("");
    setAllowResearch(false);
    setStreamError(null);
    retryRef.current = request;
    const id = ++turnIdRef.current;
    const generation = ++generationRef.current;
    setTurns((current) => [...current, { id, prompt: request.message, response: "", citations: [], suggestion: null, status: "streaming" }]);
    setStreaming(true);
    setLiveStatus("Gerando resposta…");
    const isCurrent = () => generationRef.current === generation;
    const stream = startStudioAssistantTurn({
      conversationId,
      documentId: document.id,
      message: request.message,
      allowExternalResearch: request.research,
      requestTextSuggestion: request.suggestion,
      selectedTextContext: request.selection || null,
      operationalContext: request.operationalContext ? {
        ...request.operationalContext,
        resourceTypes: [...request.operationalContext.resourceTypes]
      } : null
    }, {
      onRun(run) { if (isCurrent()) setConversationId(run.conversationId); },
      onDelta(text) { if (isCurrent()) queueDelta(id, text); },
      onCitation(citation) { if (isCurrent()) patchTurn(id, (turn) => ({ ...turn, citations: [...turn.citations, citation] })); },
      onSuggestion(suggestion) { if (isCurrent()) patchTurn(id, (turn) => ({ ...turn, suggestion })); },
      onDone() {
        if (!isCurrent()) return;
        flushDeltas();
        patchTurn(id, (turn) => ({ ...turn, status: "complete" }));
        setLiveStatus("Resposta concluída.");
      }
    });
    activeRef.current = stream;
    try {
      await stream.finished;
    } catch (error) {
      if (isCurrent() && !stream.controller.signal.aborted) {
        flushDeltas();
        patchTurn(id, (turn) => ({ ...turn, status: "error" }));
        setStreamError(error instanceof StudioAssistantStreamError && error.code === "STUDIO_ASSISTANT_INCOMPLETE"
          ? "A resposta foi interrompida antes de terminar. Você pode tentar novamente."
          : "O copiloto não conseguiu concluir esta resposta. Seu documento continua salvo.");
        setLiveStatus("Resposta interrompida. Tente novamente se desejar.");
      }
    } finally {
      if (isCurrent()) { setStreaming(false); activeRef.current = null; }
    }
  }

  function patchTurn(id: number, update: (turn: AssistantTurn) => AssistantTurn) {
    setTurns((current) => current.map((turn) => turn.id === id ? update(turn) : turn));
  }

  function queueDelta(id: number, text: string) {
    const buffered = bufferedDeltasRef.current.get(id);
    if (buffered) buffered.push(text);
    else bufferedDeltasRef.current.set(id, [text]);
    if (deltaFrameRef.current !== null) return;
    deltaFrameRef.current = window.requestAnimationFrame(() => {
      deltaFrameRef.current = null;
      flushDeltas();
    });
  }

  function flushDeltas() {
    if (deltaFrameRef.current !== null) window.cancelAnimationFrame(deltaFrameRef.current);
    deltaFrameRef.current = null;
    const buffered = bufferedDeltasRef.current;
    if (!buffered.size) return;
    bufferedDeltasRef.current = new Map<number, string[]>();
    setTurns((current) => current.map((turn) => {
      const deltas = buffered.get(turn.id);
      return deltas ? { ...turn, response: turn.response + deltas.join("") } : turn;
    }));
  }

  function discardBufferedDeltas() {
    bufferedDeltasRef.current.clear();
    if (deltaFrameRef.current !== null) window.cancelAnimationFrame(deltaFrameRef.current);
    deltaFrameRef.current = null;
  }

  function cancel() {
    const activeTurnId = turnIdRef.current;
    flushDeltas();
    generationRef.current += 1;
    activeRef.current?.controller.abort();
    activeRef.current = null;
    patchTurn(activeTurnId, (turn) => ({ ...turn, status: "cancelled" }));
    setStreaming(false);
    setStreamError(null);
    setLiveStatus("Resposta interrompida por você. É possível tentar novamente.");
  }

  function beginResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (compact) return;
    const startX = event.clientX;
    const startWidth = width;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => setWidth(clampWidth(startWidth + startX - moveEvent.clientX));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      setWidth((current) => { persistWidth(current); return current; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  }

  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
    const next = event.key === "ArrowLeft" ? width + 16
      : event.key === "ArrowRight" ? width - 16
        : event.key === "Home" ? MIN_WIDTH
          : event.key === "End" ? MAX_WIDTH
            : null;
    if (next === null) return;
    event.preventDefault();
    const bounded = clampWidth(next);
    setWidth(bounded);
    persistWidth(bounded);
  }

  if (!open) return <button ref={openTriggerRef} className="studio-copilot-open" type="button" onClick={() => setOpen(true)}>
    <i className="ph-light ph-sparkle" aria-hidden="true" /> Pensar com a IA
  </button>;

  return <>
    {compact ? <button className="studio-copilot__backdrop" type="button" aria-label="Fechar copiloto" onClick={() => setOpen(false)} /> : null}
    <aside
      ref={panelRef}
      className="studio-copilot"
      style={compact ? undefined : { width }}
      role={compact ? "dialog" : "complementary"}
      aria-modal={compact ? "true" : undefined}
      aria-label="Copiloto do Estúdio"
    >
      {!compact ? <button className="studio-copilot__resize" type="button" role="separator" aria-orientation="vertical"
        aria-label="Redimensionar copiloto" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width}
        onKeyDown={resizeWithKeyboard} onPointerDown={beginResize} /> : null}
      <header className="studio-copilot__header">
        <div><p className="mono">Ao seu lado</p><h2>Copiloto</h2></div>
        <button type="button" aria-label="Recolher copiloto" onClick={() => {
          setOpen(false);
          if (compact) queueMicrotask(() => openTriggerRef.current?.focus());
        }}><i className="ph-light ph-sidebar-simple" aria-hidden="true" /></button>
      </header>

      <p ref={liveStatusRef} className="sr-only" role="status" aria-live="polite" aria-atomic="true" tabIndex={-1}>{liveStatus}</p>
      <div className="studio-copilot__conversation">
        {!turns.length ? <div className="studio-copilot__welcome">
          <p>Use este espaço para questionar, organizar ou confrontar o que você está escrevendo.</p>
          <span>A IA propõe. Você decide o que entra.</span>
        </div> : null}
        {turns.map((turn) => <article className="studio-copilot-turn" key={turn.id}>
          <p className="studio-copilot-turn__prompt">{turn.prompt}</p>
          <div className="studio-copilot-turn__answer">{turn.response || (turn.status === "streaming" ? <span className="studio-copilot__thinking">Pensando…</span> : null)}</div>
          {turn.status === "cancelled" ? <p className="studio-copilot-turn__status">Resposta interrompida.</p> : null}
          <StudioCitations citations={turn.citations} onOpenInternal={onOpenInternalSource} />
          {turn.suggestion ? <SuggestionCard suggestion={turn.suggestion} onDocumentChange={onDocumentChange}
            onOpenInternalSource={onOpenInternalSource} acceptance={suggestionAcceptance} sessionDocumentId={document.id}
            sessionDocumentTitle={document.title} /> : null}
        </article>)}
      </div>

      {streamError ? <div ref={streamErrorRef} className="studio-copilot__error" role="alert" tabIndex={-1}>
        <p>{streamError}</p><button type="button" onClick={() => retryRef.current && void send({ ...retryRef.current, research: allowResearch })}>Tentar novamente</button>
      </div> : null}
      {!streaming && turns.at(-1)?.status === "cancelled" && retryRef.current ? <div className="studio-copilot__retry-cancelled">
        <button type="button" onClick={() => {
          const retry = retryRef.current;
          if (retry) void send({ ...retry, research: allowResearch });
        }}>Tentar novamente</button>
      </div> : null}

      <form className="studio-copilot__composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        {selectedText.trim() ? <p className="studio-copilot__selection"><i className="ph-light ph-quotes" aria-hidden="true" /> Usando apenas o trecho selecionado ({Math.min([...selectedText].length, 4_000)} caracteres)</p> : null}
        <label htmlFor="studio-copilot-prompt">O que você quer entender melhor?</label>
        <textarea ref={composerRef} id="studio-copilot-prompt" rows={3} value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} disabled={streaming} />
        <div className="studio-copilot__options">
          <label><input type="checkbox" checked={useOperationalContext} onChange={(event) => setUseOperationalContext(event.currentTarget.checked)} /> Usar dados da operação nesta pergunta</label>
          {useOperationalContext ? <fieldset className="studio-copilot__operational-period">
            <legend>Período consultado</legend>
            <label htmlFor="studio-operational-from">Início do período operacional<input id="studio-operational-from" type="date" value={operationalFrom} max={operationalTo || undefined} onChange={(event) => setOperationalFrom(event.currentTarget.value)} /></label>
            <label htmlFor="studio-operational-to">Fim do período operacional<input id="studio-operational-to" type="date" value={operationalTo} min={operationalFrom || undefined} onChange={(event) => setOperationalTo(event.currentTarget.value)} /></label>
            <small>Tarefas, rotinas e demais fontes internas aparecerão separadas da pesquisa pública.</small>
          </fieldset> : null}
          <label><input type="checkbox" checked={allowResearch} onChange={(event) => setAllowResearch(event.currentTarget.checked)} /> Pesquisar na internet nesta pergunta</label>
          <label><input type="checkbox" disabled={Boolean(selectedText.trim())} checked={requestSuggestion && !selectedText.trim()} onChange={(event) => setRequestSuggestion(event.currentTarget.checked)} /> {selectedText.trim() ? "Seleção ativa: proposta de documento indisponível" : "Criar proposta revisável"}</label>
        </div>
        <div className="studio-copilot__actions">
          {streaming ? <button type="button" onClick={cancel}>Parar resposta</button> : null}
          <button className="primary" type="submit" disabled={!prompt.trim() || streaming}>Enviar</button>
        </div>
      </form>
    </aside>
  </>;
}

function SuggestionCard({ suggestion, onDocumentChange, onOpenInternalSource, acceptance, sessionDocumentId, sessionDocumentTitle }: {
  suggestion: StudioSuggestion;
  onDocumentChange(document: StudioDocument): void;
  onOpenInternalSource?(target: StudioInternalCitationTarget, citation: StudioCitation): void;
  acceptance?: StudioSuggestionAcceptanceGuard;
  sessionDocumentId: string;
  sessionDocumentTitle: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(suggestion.payload.proposal.title ?? "");
  const [body, setBody] = useState(suggestion.payload.proposal.bodyText);
  const [state, setState] = useState<"pending" | "accepting" | "dismissing" | "accepted" | "dismissed" | "error" | "conflict">("pending");
  const [operationOpen, setOperationOpen] = useState(false);
  const [operationDrafts, setOperationDrafts] = useState<StudioOperationDraft[] | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const decisionRef = useRef<HTMLParagraphElement>(null);
  const operationTriggerRef = useRef<HTMLButtonElement>(null);
  const operationWasOpenRef = useRef(false);
  const decisionGenerationRef = useRef(0);
  const decisionControllerRef = useRef<AbortController | null>(null);
  const activeIdentityRef = useRef({ documentId: sessionDocumentId, suggestionId: suggestion.id });
  activeIdentityRef.current = { documentId: sessionDocumentId, suggestionId: suggestion.id };

  useLayoutEffect(() => () => {
    decisionGenerationRef.current += 1;
    decisionControllerRef.current?.abort();
    decisionControllerRef.current = null;
  }, [sessionDocumentId, suggestion.id]);

  useEffect(() => {
    if (state === "dismissed") decisionRef.current?.focus();
    if (state === "error" || state === "conflict") errorRef.current?.focus();
  }, [state]);

  useEffect(() => {
    if (operationOpen) {
      operationWasOpenRef.current = true;
      return;
    }
    if (operationWasOpenRef.current) {
      operationWasOpenRef.current = false;
      operationTriggerRef.current?.focus();
    }
  }, [operationOpen]);

  async function accept() {
    if (state !== "pending" && state !== "error") return;
    if (acceptance && !acceptance.canAccept) return;
    const editorSnapshot = acceptance?.capture();
    const controller = new AbortController();
    decisionControllerRef.current?.abort();
    decisionControllerRef.current = controller;
    const generation = ++decisionGenerationRef.current;
    const identity = { documentId: sessionDocumentId, suggestionId: suggestion.id };
    const isCurrent = () => (
      decisionGenerationRef.current === generation
      && !controller.signal.aborted
      && activeIdentityRef.current.documentId === identity.documentId
      && activeIdentityRef.current.suggestionId === identity.suggestionId
    );
    setState("accepting");
    try {
      const edited = title !== (suggestion.payload.proposal.title ?? "") || body !== suggestion.payload.proposal.bodyText;
      const document = await acceptStudioSuggestion(suggestion.id, edited ? {
        ...suggestion.payload.proposal,
        title: title.trim() || null,
        bodyText: body,
        bodyJson: plainTextDocument(body)
      } : suggestion.payload.proposal, controller.signal);
      if (!isCurrent()) return;
      if (acceptance && editorSnapshot && !acceptance.isCurrent(editorSnapshot)) {
        acceptance.onConflict();
        setState("conflict");
        return;
      }
      setState("accepted");
      onDocumentChange(document);
    } catch {
      if (isCurrent()) setState("error");
    } finally {
      if (isCurrent()) decisionControllerRef.current = null;
    }
  }

  async function dismiss() {
    if (state !== "pending" && state !== "error") return;
    const controller = new AbortController();
    decisionControllerRef.current?.abort();
    decisionControllerRef.current = controller;
    const generation = ++decisionGenerationRef.current;
    const identity = { documentId: sessionDocumentId, suggestionId: suggestion.id };
    const isCurrent = () => (
      decisionGenerationRef.current === generation
      && !controller.signal.aborted
      && activeIdentityRef.current.documentId === identity.documentId
      && activeIdentityRef.current.suggestionId === identity.suggestionId
    );
    setState("dismissing");
    try {
      await dismissStudioSuggestion(suggestion.id, controller.signal);
      if (isCurrent()) setState("dismissed");
    }
    catch { if (isCurrent()) setState("error"); }
    finally { if (isCurrent()) decisionControllerRef.current = null; }
  }

  if (state === "dismissed") return <p ref={decisionRef} className="studio-suggestion__decision" role="status" tabIndex={-1}>Proposta dispensada.</p>;
  return <section className="studio-suggestion" aria-label="Proposta revisável da IA">
    <header><p className="mono">Proposta, não alteração</p><button type="button" disabled={state !== "pending" && state !== "error"} onClick={() => setEditing((value) => !value)}>{editing ? "Ver prévia" : "Editar"}</button></header>
    <div className="studio-suggestion__reasoning">
      <section><h4>Fatos</h4>{suggestion.payload.facts.length ? suggestion.payload.facts.map((item, index) => <p key={index}>{item.statement}</p>) : <p>Nenhum fato confirmado.</p>}</section>
      <section><h4>Inferências</h4>{suggestion.payload.inferences.length ? suggestion.payload.inferences.map((item, index) => <p key={index}>{item.statement}<small>{item.basis} · confiança {item.confidence}</small></p>) : <p>Nenhuma inferência.</p>}</section>
      <section><h4>Lacunas</h4>{suggestion.payload.gaps.length ? suggestion.payload.gaps.map((item, index) => <p key={index}>{item.question}<small>{item.reason}</small></p>) : <p>Nenhuma lacuna identificada.</p>}</section>
    </div>
    <section className="studio-suggestion__proposal" aria-labelledby={`studio-suggestion-proposal-${suggestion.id}`}>
      <h4 id={`studio-suggestion-proposal-${suggestion.id}`}>Proposta</h4>
    {editing ? <div className="studio-suggestion__edit">
      <label>Título<input name={`studio-suggestion-${suggestion.id}-title`} autoComplete="off" value={title} onChange={(event) => setTitle(event.currentTarget.value)} /></label>
      <label>Texto<textarea name={`studio-suggestion-${suggestion.id}-body`} autoComplete="off" rows={8} value={body} onChange={(event) => setBody(event.currentTarget.value)} /></label>
    </div> : <div className="studio-suggestion__preview"><h4>{title || "Sem título"}</h4><p>{body}</p></div>}
    </section>
    <StudioCitations citations={suggestion.payload.citations} onOpenInternal={onOpenInternalSource} />
    {operationOpen && operationDrafts ? <OperationPreview
      suggestionId={suggestion.id}
      sourceDocument={{ id: sessionDocumentId, title: sessionDocumentTitle }}
      drafts={operationDrafts}
      onClose={() => setOperationOpen(false)}
      onNavigate={(link) => onOpenInternalSource?.(
        { kind: link.resourceType, resourceId: link.resourceId },
        {
          sourceType: "operational_resource", sourceId: link.resourceId, url: null,
          label: title.trim() || suggestion.payload.proposal.title || "Recurso criado",
          excerpt: "Criado a partir de uma reflexão no Estúdio do Dono.", observedAt: link.createdAt,
          periodFrom: null, periodTo: null, metadata: { resourceType: link.resourceType, origin: "owner_studio" }
        }
      )}
    /> : null}
    {acceptance && !acceptance.canAccept && state !== "conflict" ? <p className="studio-suggestion__guard" role="status">{acceptance.status}</p> : null}
    {state === "conflict" ? <p ref={errorRef} tabIndex={-1} role="alert">A proposta chegou ao servidor, mas sua edição local mudou. Sua escrita foi preservada para você resolver o conflito.</p> : null}
    {state === "error" ? <p ref={errorRef} tabIndex={-1} role="alert">A proposta não foi aplicada. O texto original continua intacto.</p> : null}
    <footer>
      {!operationOpen ? <button ref={operationTriggerRef} type="button" disabled={state !== "pending" && state !== "error"} onClick={() => {
        setOperationDrafts([operationDraftFromSuggestion(suggestion, title, body)]);
        setOperationOpen(true);
      }}>Levar para a operação</button> : null}
      <button type="button" disabled={["accepting", "dismissing", "accepted", "conflict"].includes(state)} onClick={() => void dismiss()}>{state === "dismissing" ? "Dispensando…" : "Dispensar"}</button>
      <button className="primary" type="button" disabled={["accepting", "dismissing", "accepted", "conflict"].includes(state) || (acceptance ? !acceptance.canAccept : false)} onClick={() => void accept()}>{state === "accepted" ? "Aplicada em nova versão" : state === "accepting" ? "Aplicando…" : "Aceitar como nova versão"}</button>
    </footer>
  </section>;
}

function operationDraftFromSuggestion(suggestion: StudioSuggestion, editedTitle: string, editedBody: string): StudioOperationDraft {
  const title = (editedTitle.trim() || suggestion.payload.proposal.title?.trim() || "Próximo passo").slice(0, 160);
  return {
    resource_type: "task",
    payload: {
      title,
      area_id: null,
      assignee_profile_id: null,
      due_date: relativeDate(1),
      due_hint: null,
      approval_mode: "direct",
      evidence_policy: "optional",
      checklist_items: editedBody.split("\n").map((item) => item.trim()).filter(Boolean).slice(0, 8).map((item) => item.slice(0, 180))
    }
  };
}

function plainTextDocument(text: string): Record<string, unknown> {
  return { type: "doc", content: text.split(/\n\n+/u).map((paragraph) => ({
    type: "paragraph",
    content: paragraph ? [{ type: "text", text: paragraph }] : []
  })) };
}

function readWidth() {
  try { return clampWidth(Number(window.localStorage.getItem(WIDTH_KEY)) || 380); }
  catch { return 380; }
}
function persistWidth(width: number) { try { window.localStorage.setItem(WIDTH_KEY, String(clampWidth(width))); } catch { /* optional preference */ } }
function clampWidth(width: number) { return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width))); }
function documentBodyUnlock() { /* compact cleanup is owned by the effect cleanup */ }

function relativeDate(offsetDays: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}
