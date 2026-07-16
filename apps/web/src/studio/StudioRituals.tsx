import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { STUDIO_STRUCTURE_CONTRACT } from "@prymeira/baase-shared";
import {
  createStudioDocument,
  createStudioStructure,
  finishStudioRitualSession,
  listStudioRitualSessions,
  listStudioStructures,
  startStudioRitualSession,
  StudioApiError,
  updateStudioRitualSession
} from "./studio-api";
import type {
  StudioRitualCadence,
  StudioRitualSession,
  StudioStructure
} from "./studio.types";

const RITUAL_FIELDS = STUDIO_STRUCTURE_CONTRACT.ritual.properties;
const SESSION_DRAFT_PREFIX = "baase:studio:ritual-draft:";
const RITUAL_BUILDER_DRAFT_KEY = "baase:studio:ritual-builder-draft";

type SaveState = "saved" | "dirty" | "saving" | "offline" | "conflict" | "error";
type RitualMode = "list" | "builder" | "session";

export default function StudioRituals({ initialRitualId }: { initialRitualId?: string | null }) {
  const [rituals, setRituals] = useState<StudioStructure[]>([]);
  const [ritualNames, setRitualNames] = useState<Record<string, string>>({});
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [mode, setMode] = useState<RitualMode>("list");
  const [selectedRitual, setSelectedRitual] = useState<StudioStructure | null>(null);
  const [session, setSession] = useState<StudioRitualSession | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState("loading");
    void listStudioStructures({ kind: "ritual", lifecycle_status: "active", limit: 50 }, fetch, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        if (page.items.some((ritual) => ritual.documentTitle === undefined)) {
          throw new Error("STUDIO_RITUAL_TITLE_PROJECTION_MISSING");
        }
        setRituals(page.items);
        setLoadState("ready");
        if (initialRitualId) {
          const target = page.items.find((ritual) => ritual.id === initialRitualId);
          if (target) void openSession(target);
        }
      })
      .catch(() => { if (!controller.signal.aborted) setLoadState("error"); });
    return () => controller.abort();
  }, [initialRitualId, reloadKey]);

  useEffect(() => {
    if (!selectedRitual || !session || session.status !== "preparing") return;
    const controller = new AbortController();
    let timeout: number | undefined;
    const poll = async () => {
      try {
        const page = await listStudioRitualSessions(
          selectedRitual.id,
          { limit: 1 },
          controller.signal,
          fetch
        );
        if (controller.signal.aborted) return;
        const latest = page.items.find((item) => item.id === session.id);
        if (latest) setSession((current) => !current || latest.revision > current.revision ? latest : current);
      } catch {
        // Polling is enhancement-only: answers remain usable and locally durable.
      }
      if (!controller.signal.aborted) timeout = window.setTimeout(() => void poll(), 1_000);
    };
    timeout = window.setTimeout(() => void poll(), 400);
    return () => {
      controller.abort();
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [selectedRitual, session?.id, session?.status]);

  async function openSession(ritual: StudioStructure) {
    setBusy(true);
    setStartError(null);
    setSelectedRitual(ritual);
    setMode("session");
    try {
      setSession(await startStudioRitualSession(ritual.id));
    } catch (error) {
      setStartError(ritualErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function returnToList() {
    setMode("list");
    setSession(null);
    setSelectedRitual(null);
    setStartError(null);
  }

  return (
    <div className="studio-rituals">
      {mode === "list" ? (
        <RitualLibrary
          rituals={rituals}
          ritualNames={ritualNames}
          loadState={loadState}
          busy={busy}
          onRetry={() => setReloadKey((key) => key + 1)}
          onCreate={() => setMode("builder")}
          onStart={(ritual) => void openSession(ritual)}
        />
      ) : null}

      {mode === "builder" ? (
        <RitualBuilder
          busy={busy}
          onCancel={returnToList}
          onCreated={(ritual, name) => {
            setRituals((items) => [ritual, ...items]);
            setRitualNames((current) => ({ ...current, [ritual.id]: name }));
            setMode("list");
          }}
          setBusy={setBusy}
        />
      ) : null}

      {mode === "session" && selectedRitual ? (
        <div className="studio-ritual-session-shell">
          <button className="studio-rituals__back" type="button" onClick={returnToList}>
            <i aria-hidden="true" className="ph-light ph-arrow-left" /> Rituais
          </button>
          {startError ? (
            <div className="studio-ritual-state" role="alert">
              <h3>Não foi possível abrir o ritual.</h3>
              <p>{startError}</p>
              <button type="button" onClick={() => void openSession(selectedRitual)}>Tentar novamente</button>
            </div>
          ) : busy && !session ? (
            <RitualLoading />
          ) : session ? (
            <RitualSession
              ritual={selectedRitual}
              initialSession={session}
              onSessionChange={setSession}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RitualLibrary({ rituals, ritualNames, loadState, busy, onRetry, onCreate, onStart }: {
  rituals: StudioStructure[];
  ritualNames: Record<string, string>;
  loadState: "loading" | "ready" | "error";
  busy: boolean;
  onRetry(): void;
  onCreate(): void;
  onStart(ritual: StudioStructure): void;
}) {
  return (
    <section className="studio-ritual-library" aria-label="Rituais privados">
      <header>
        <div>
          <p className="mono">Ritmo privado</p>
          <h3>Revisões que devolvem perspectiva</h3>
          <p>Configure apenas o que ajuda. Cada sessão continua privada e pode começar mesmo sem IA.</p>
        </div>
        <button type="button" onClick={onCreate}>Criar ritual</button>
      </header>

      {loadState === "loading" ? <RitualLoading /> : null}
      {loadState === "error" ? (
        <div className="studio-ritual-state" role="alert">
          <p>Não foi possível carregar seus rituais. Nenhum conteúdo foi alterado.</p>
          <button type="button" onClick={onRetry}>Tentar novamente</button>
        </div>
      ) : null}
      {loadState === "ready" && rituals.length === 0 ? (
        <div className="studio-ritual-state studio-ritual-state--empty">
          <i aria-hidden="true" className="ph-light ph-calendar-dots" />
          <h3>Crie um momento que valha repetir.</h3>
          <p>Pode ser uma revisão semanal, uma pausa mensal ou uma reflexão sem agenda fixa.</p>
        </div>
      ) : null}
      {loadState === "ready" && rituals.length ? (
        <div className="studio-ritual-list">
          {rituals.map((ritual) => {
            const title = ritualNames[ritual.id] || ritualTitle(ritual);
            return (
              <article key={ritual.id} className="studio-ritual-row">
                <div>
                  <span className="studio-ritual-row__icon" aria-hidden="true"><i className="ph-light ph-calendar-check" /></span>
                  <div>
                    <h4>{title}</h4>
                    <p>{cadenceLabel(ritual)}</p>
                  </div>
                </div>
                <button type="button" disabled={busy} aria-label={`Iniciar ${title}`} onClick={() => onStart(ritual)}>Iniciar</button>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function RitualBuilder({ busy, onCancel, onCreated, setBusy }: {
  busy: boolean;
  onCancel(): void;
  onCreated(ritual: StudioStructure, name: string): void;
  setBusy(value: boolean): void;
}) {
  const initialDraftRef = useRef(readRitualBuilderDraft());
  const initialDraft = initialDraftRef.current;
  const [name, setName] = useState(initialDraft.name);
  const [intention, setIntention] = useState(initialDraft.intention);
  const [questions, setQuestions] = useState(initialDraft.questions);
  const [scheduled, setScheduled] = useState(initialDraft.scheduled);
  const [frequency, setFrequency] = useState<StudioRitualCadence["frequency"]>(initialDraft.frequency);
  const [localTime, setLocalTime] = useState(initialDraft.localTime);
  const [weekday, setWeekday] = useState(initialDraft.weekday);
  const [monthDay, setMonthDay] = useState(initialDraft.monthDay);
  const [timezone, setTimezone] = useState(initialDraft.timezone);
  const [error, setError] = useState<string | null>(null);
  const documentIdRef = useRef<string | null>(initialDraft.documentId);
  const captureKeyRef = useRef(initialDraft.captureKey || createIdempotencyKey());

  const canSave = Boolean(name.trim() && intention.trim()) && !busy;

  useEffect(() => {
    writeRitualBuilderDraft({
      name, intention, questions, scheduled, frequency, localTime, weekday, monthDay, timezone,
      documentId: documentIdRef.current,
      captureKey: captureKeyRef.current
    });
  }, [frequency, intention, localTime, monthDay, name, questions, scheduled, timezone, weekday]);

  useEffect(() => {
    if (!name.trim() && !intention.trim() && !questions.trim()) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [intention, name, questions]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      if (!documentIdRef.current) {
        const document = await createStudioDocument({
          title: name.trim(),
          body_json: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: intention.trim() }] }]
          },
          body_text: intention.trim(),
          capture_mode: "text",
          capture_key: captureKeyRef.current
        });
        documentIdRef.current = document.id;
        writeRitualBuilderDraft({
          name, intention, questions, scheduled, frequency, localTime, weekday, monthDay, timezone,
          documentId: document.id,
          captureKey: captureKeyRef.current
        });
      }
      const guideQuestions = questions.split("\n").map((question) => question.trim()).filter(Boolean);
      const cadence: StudioRitualCadence | null = scheduled ? {
        frequency,
        local_time: localTime,
        timezone,
        ...(frequency === "weekly" ? { weekdays: [weekday] } : {}),
        ...(frequency === "monthly" ? { month_day: monthDay } : {})
      } : null;
      const ritual = await createStudioStructure(documentIdRef.current, {
        kind: "ritual",
        cadence_json: cadence,
        properties_json: {
          [RITUAL_FIELDS.intention.key]: intention.trim(),
          ...(guideQuestions.length ? { [RITUAL_FIELDS.guideQuestions.key]: guideQuestions } : {})
        }
      });
      removeRitualBuilderDraft();
      onCreated(ritual, name.trim());
    } catch (caught) {
      setError(ritualErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="studio-ritual-builder" aria-label="Criar ritual" onSubmit={(event) => void save(event)}>
      <header>
        <div><p className="mono">Novo ritual</p><h3>Um bom ritmo começa simples.</h3></div>
        <button type="button" aria-label="Fechar criação de ritual" onClick={() => { removeRitualBuilderDraft(); onCancel(); }}><i aria-hidden="true" className="ph-light ph-x" /></button>
      </header>
      <label><span>Nome do ritual</span><input name="ritual-name" autoComplete="off" value={name} onChange={(event) => setName(event.currentTarget.value)} required /></label>
      <label><span>Intenção</span><textarea name="ritual-intention" autoComplete="off" value={intention} onChange={(event) => setIntention(event.currentTarget.value)} rows={3} required /></label>
      <label><span>Perguntas guia</span><textarea name="ritual-questions" autoComplete="off" value={questions} onChange={(event) => setQuestions(event.currentTarget.value)} rows={4} placeholder="Uma pergunta por linha" /></label>

      {!scheduled ? <button className="studio-ritual-builder__optional" type="button" onClick={() => setScheduled(true)}>Adicionar cadência</button> : (
        <fieldset className="studio-ritual-cadence">
          <legend>Cadência</legend>
          <div className="studio-ritual-cadence__grid">
            <label><span>Frequência</span><select value={frequency} onChange={(event) => setFrequency(event.currentTarget.value as StudioRitualCadence["frequency"])}><option value="daily">Diária</option><option value="weekly">Semanal</option><option value="monthly">Mensal</option></select></label>
            {frequency === "weekly" ? <label><span>Dia da semana</span><select value={weekday} onChange={(event) => setWeekday(Number(event.currentTarget.value))}>{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label> : null}
            {frequency === "monthly" ? <label><span>Dia do mês</span><input type="number" min={1} max={31} value={monthDay} onChange={(event) => setMonthDay(Number(event.currentTarget.value))} /></label> : null}
            <label><span>Horário</span><input aria-label="Horário do ritual" type="time" value={localTime} onChange={(event) => setLocalTime(event.currentTarget.value)} /></label>
            <label><span>Fuso horário</span><input value={timezone} onChange={(event) => setTimezone(event.currentTarget.value)} /></label>
          </div>
          <button type="button" onClick={() => setScheduled(false)}>Remover cadência</button>
        </fieldset>
      )}
      {error ? <p className="studio-ritual-form-error" role="alert">{error}</p> : null}
      <footer><button type="button" onClick={() => { removeRitualBuilderDraft(); onCancel(); }}>Cancelar</button><button className="primary" type="submit" disabled={!canSave}>{busy ? "Salvando…" : "Salvar ritual"}</button></footer>
    </form>
  );
}

function RitualSession({ ritual, initialSession, onSessionChange }: {
  ritual: StudioStructure;
  initialSession: StudioRitualSession;
  onSessionChange(session: StudioRitualSession): void;
}) {
  const [session, setSession] = useState(initialSession);
  const initialAnswersRef = useRef<Record<string, string>>({
    ...initialSession.answersJson,
    ...readRitualDraft(initialSession.id)
  });
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswersRef.current);
  const questions = useMemo(() => sessionQuestions(session, ritual), [session, ritual]);
  const [questionIndex, setQuestionIndex] = useState(() => firstUnansweredQuestion(
    sessionQuestions(initialSession, ritual),
    initialAnswersRef.current
  ));
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [actionError, setActionError] = useState<string | null>(null);
  const [localDraftStored, setLocalDraftStored] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [retryingPreparation, setRetryingPreparation] = useState(false);
  const [preparationRetryError, setPreparationRetryError] = useState<string | null>(null);
  const revisionRef = useRef(initialSession.revision);
  const answersRef = useRef(answers);
  const lastSavedRef = useRef(JSON.stringify(initialSession.answersJson));
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const localDraftStoredRef = useRef(true);
  const answerRef = useRef<HTMLTextAreaElement | null>(null);
  const question = questions[Math.min(questionIndex, Math.max(questions.length - 1, 0))]!;

  useEffect(() => {
    answersRef.current = answers;
    const serialized = JSON.stringify(answers);
    if (session.status !== "completed" && serialized !== lastSavedRef.current) {
      localDraftStoredRef.current = writeRitualDraft(session.id, answers);
      setLocalDraftStored(localDraftStoredRef.current);
      setSaveState("dirty");
    }
  }, [answers, session.id, session.status]);

  useEffect(() => {
    answerRef.current?.focus();
  }, [questionIndex]);

  useEffect(() => {
    if (initialSession.revision <= revisionRef.current) return;
    revisionRef.current = initialSession.revision;
    setSession(initialSession);
    const merged = { ...initialSession.answersJson, ...answersRef.current };
    answersRef.current = merged;
    setAnswers(merged);
    lastSavedRef.current = JSON.stringify(initialSession.answersJson);
    if (JSON.stringify(merged) !== lastSavedRef.current) setSaveState("dirty");
  }, [initialSession]);

  useEffect(() => {
    if (saveState !== "dirty") return;
    const timeout = window.setTimeout(() => { void persistAnswers(); }, 700);
    return () => window.clearTimeout(timeout);
  }, [answers, saveState]);

  function acceptSession(next: StudioRitualSession) {
    revisionRef.current = next.revision;
    setSession(next);
    onSessionChange(next);
  }

  async function persistAnswers() {
    if (session.status === "completed") return true;
    if (savePromiseRef.current) return savePromiseRef.current;
    const pending = drainAnswerSnapshots().finally(() => { savePromiseRef.current = null; });
    savePromiseRef.current = pending;
    return pending;
  }

  async function drainAnswerSnapshots() {
    setSaveState("saving");
    while (JSON.stringify(answersRef.current) !== lastSavedRef.current) {
      const snapshot = { ...answersRef.current };
      try {
        const updated = await updateStudioRitualSession(session.id, {
          expected_revision: revisionRef.current,
          answers: snapshot
        });
        acceptSession(updated);
        lastSavedRef.current = JSON.stringify(snapshot);
        setActionError(null);
      } catch (error) {
        if (isRitualConflict(error)) {
          setSaveState("conflict");
          setActionError("Esta sessão mudou em outra aba. Seu rascunho continua guardado; escolha qual versão deseja manter.");
        } else if (isOfflineError(error)) {
          setSaveState("offline");
          setActionError(localDraftStoredRef.current
            ? "Sua resposta ficou guardada neste navegador e ainda não chegou ao servidor."
            : "Sem conexão e sem espaço para guardar o rascunho no navegador. Mantenha esta página aberta e tente novamente.");
        } else {
          setSaveState("error");
          setActionError(ritualErrorMessage(error));
        }
        return false;
      }
    }
    removeRitualDraft(session.id);
    setSaveState("saved");
    return true;
  }

  async function continueSession() {
    if (!await persistAnswers()) return;
    setQuestionIndex((index) => Math.min(index + 1, questions.length - 1));
  }

  async function finish() {
    if (finishing) return;
    if (!await persistAnswers()) return;
    setFinishing(true);
    setSaveState("saving");
    try {
      const completed = await finishStudioRitualSession(session.id, {
        expected_revision: revisionRef.current,
        answers: { ...answersRef.current },
        request_synthesis: true
      });
      acceptSession(completed);
      setFinishing(false);
      lastSavedRef.current = JSON.stringify(completed.answersJson);
      removeRitualDraft(session.id);
      setSaveState("saved");
      setActionError(null);
    } catch (error) {
      setFinishing(false);
      if (isRitualConflict(error)) setSaveState("conflict");
      else if (isOfflineError(error)) setSaveState("offline");
      else setSaveState("error");
      setActionError(isRitualConflict(error)
        ? "Esta sessão mudou em outra aba. Recarregue antes de concluir."
        : ritualErrorMessage(error));
    }
  }

  async function retryPreparation() {
    if (retryingPreparation) return;
    setRetryingPreparation(true);
    setPreparationRetryError(null);
    try {
      if (!await persistAnswers()) return;
      const retried = await startStudioRitualSession(ritual.id);
      acceptSession(retried);
    } catch (error) {
      setPreparationRetryError(ritualErrorMessage(error));
    } finally {
      setRetryingPreparation(false);
    }
  }

  async function loadLatestSession() {
    const page = await listStudioRitualSessions(ritual.id, { limit: 1 });
    const latest = page.items.find((item) => item.id === session.id) ?? page.items[0];
    if (!latest) throw new Error("STUDIO_RITUAL_SESSION_NOT_FOUND");
    return latest;
  }

  async function keepLocalDraft() {
    setSaveState("saving");
    const localDraft = { ...readRitualDraft(session.id), ...answersRef.current };
    try {
      const latest = await loadLatestSession();
      if (latest.status === "completed") {
        setSaveState("conflict");
        setActionError("A sessão já foi concluída em outra aba. Seu rascunho continua guardado neste navegador.");
        return;
      }
      acceptSession(latest);
      lastSavedRef.current = JSON.stringify(latest.answersJson);
      const merged = { ...latest.answersJson, ...localDraft };
      answersRef.current = merged;
      setAnswers(merged);
      writeRitualDraft(session.id, merged);
      setSaveState("dirty");
      setActionError(null);
      await persistAnswers();
    } catch (error) {
      setSaveState("conflict");
      setActionError(isOfflineError(error)
        ? "Sem conexão para comparar as versões. Seu rascunho continua guardado neste navegador."
        : ritualErrorMessage(error));
    }
  }

  async function discardLocalDraft() {
    setSaveState("saving");
    try {
      const latest = await loadLatestSession();
      acceptSession(latest);
      answersRef.current = latest.answersJson;
      setAnswers(latest.answersJson);
      lastSavedRef.current = JSON.stringify(latest.answersJson);
      removeRitualDraft(session.id);
      setSaveState("saved");
      setActionError(null);
    } catch (error) {
      setSaveState("conflict");
      setActionError(isOfflineError(error)
        ? "Sem conexão para carregar a versão do servidor. Seu rascunho continua guardado neste navegador."
        : ritualErrorMessage(error));
    }
  }

  if (session.status === "completed") return (
    <CompletedRitual
      session={session}
      retrying={finishing}
      error={actionError}
      onRetry={() => void finish()}
    />
  );

  return (
    <article className="studio-ritual-session" aria-labelledby="studio-ritual-question">
      <header>
        <div>
          <p className="mono">Pergunta {questionIndex + 1} de {questions.length}</p>
          <h3>{preparationTitle(session) || ritualTitle(ritual)}</h3>
        </div>
        <SaveIndicator state={saveState} offlinePreserved={localDraftStored} />
      </header>

      <PreparedContext
        session={session}
        retrying={retryingPreparation}
        retryError={preparationRetryError}
        onRetry={() => void retryPreparation()}
      />

      <section className="studio-ritual-question" aria-label={`Pergunta ${questionIndex + 1}`}>
        <p className="studio-ritual-question__purpose">{question.purpose}</p>
        <h4 id="studio-ritual-question">{question.prompt}</h4>
        <label>
          <span className="sr-only">Resposta para {question.prompt}</span>
          <textarea
            ref={answerRef}
            aria-label={`Resposta para ${question.prompt}`}
            disabled={finishing}
            value={answers[question.prompt] ?? ""}
            onChange={(event) => {
              const value = event.currentTarget.value;
              const next = { ...answersRef.current, [question.prompt]: value };
              answersRef.current = next;
              localDraftStoredRef.current = writeRitualDraft(session.id, next);
              setLocalDraftStored(localDraftStoredRef.current);
              setSaveState("dirty");
              setAnswers(next);
            }}
            rows={7}
            placeholder="Escreva no seu ritmo. Sua resposta é salva enquanto você avança."
          />
        </label>
      </section>

      {actionError ? (
        <div className="studio-ritual-save-error" role="alert">
          <p>{actionError}</p>
          {saveState === "conflict"
            ? <div className="studio-ritual-save-error__actions">
              <button className="primary" type="button" onClick={() => void keepLocalDraft()}>Manter meu rascunho</button>
              <button type="button" onClick={() => void discardLocalDraft()}>Descartar rascunho local</button>
            </div>
            : <button type="button" onClick={() => void persistAnswers()}>Tentar salvar novamente</button>}
        </div>
      ) : null}

      <footer>
        {questionIndex > 0 ? <button type="button" disabled={finishing} onClick={() => setQuestionIndex((index) => index - 1)}>Pergunta anterior</button> : <span />}
        {questionIndex < questions.length - 1
          ? <button className="primary" type="button" disabled={finishing} onClick={() => void continueSession()}>Salvar e continuar</button>
          : <button className="primary" type="button" disabled={finishing} onClick={() => void finish()}>{finishing ? "Concluindo…" : "Concluir ritual"}</button>}
      </footer>
    </article>
  );
}

function PreparedContext({ session, retrying, retryError, onRetry }: {
  session: StudioRitualSession;
  retrying: boolean;
  retryError: string | null;
  onRetry(): void;
}) {
  const preparation = asRecord(session.preparationJson);
  const proposal = asRecord(preparation.proposal);
  const notes = stringList(proposal.preparation_notes);
  const context = asRecord(session.contextJson);
  const related = Array.isArray(context.related) ? context.related.map(asRecord) : [];
  if (session.status === "preparing") return (
    <div className="studio-ritual-context-status" role="status">
      <i aria-hidden="true" className="ph-light ph-circle-notch" />
      <span>Preparando contexto em segundo plano…</span>
    </div>
  );
  const preparationFailureCode = session.failureCode ?? context.preparationFailureCode;
  if (preparationFailureCode && session.preparationJson === null) return (
    <div className="studio-ritual-context-status studio-ritual-context-status--failed">
      <div role="status">
        <i aria-hidden="true" className="ph-light ph-cloud-slash" />
        <span>O contexto da IA não ficou disponível. Suas respostas continuam funcionando normalmente.</span>
      </div>
      <button type="button" disabled={retrying} onClick={onRetry}>
        {retrying ? "Preparando novamente…" : "Tentar preparar novamente"}
      </button>
      {retryError ? <p role="alert">{retryError}</p> : null}
    </div>
  );
  return (
    <details className="studio-ritual-context">
      <summary>Ver contexto preparado</summary>
      <div>
        {notes.length ? <section><h4>Antes de começar</h4><ul>{notes.map((note) => <li key={note}>{note}</li>)}</ul></section> : null}
        {related.length ? <section><h4>Pensamentos relacionados</h4><ul>{related.map((item, index) => <li key={`${String(item.documentId)}-${index}`}>{String(item.excerpt ?? "Registro relacionado")}</li>)}</ul></section> : null}
        {!notes.length && !related.length ? <p>O contexto foi preparado e permanece vinculado a esta sessão.</p> : null}
      </div>
    </details>
  );
}

function CompletedRitual({ session, retrying, error, onRetry }: {
  session: StudioRitualSession;
  retrying: boolean;
  error: string | null;
  onRetry(): void;
}) {
  const synthesis = asRecord(session.synthesisJson);
  const suggestions = [
    ...stringList(synthesis.decisions),
    ...stringList(synthesis.suggested_next_steps)
  ];
  return (
    <article className="studio-ritual-complete">
      <i aria-hidden="true" className="ph-light ph-check-circle" />
      <p className="mono">Respostas preservadas</p>
      <h3>Ritual concluído</h3>
      {typeof synthesis.summary === "string" ? <p>{synthesis.summary}</p> : <p>Suas respostas foram salvas. Você pode retomar esta revisão quando quiser.</p>}
      {suggestions.length ? (
        <section aria-label="Sugestões para revisar">
          <header><h4>Sugestões para revisar</h4><p>Nada foi aplicado automaticamente.</p></header>
          <ul>{suggestions.map((suggestion, index) => <li key={`${suggestion}-${index}`}><span>{suggestion}</span><small>Pendente</small></li>)}</ul>
        </section>
      ) : null}
      {session.synthesisJson === null && session.synthesisFailureCode ? (
        <div className="studio-ritual-save-error" role={error ? "alert" : "status"}>
          <p>{error || "Suas respostas estão seguras, mas a síntese não ficou pronta."}</p>
          <button type="button" disabled={retrying} onClick={onRetry}>{retrying ? "Gerando síntese…" : "Tentar gerar síntese"}</button>
        </div>
      ) : null}
    </article>
  );
}

function RitualLoading() {
  return <div className="studio-ritual-loading" role="status" aria-label="Carregando rituais"><span /><span /><span /></div>;
}

function SaveIndicator({ state, offlinePreserved }: { state: SaveState; offlinePreserved: boolean }) {
  const labels: Record<SaveState, string> = {
    saved: "Salvo",
    dirty: "Alterações locais",
    saving: "Salvando…",
    offline: offlinePreserved ? "Offline, resposta preservada" : "Offline, mantenha a página aberta",
    conflict: "Conflito entre abas",
    error: "Falha ao salvar"
  };
  return <span className={`studio-ritual-save-state studio-ritual-save-state--${state}`} role="status" aria-label="Estado do salvamento do ritual"><i aria-hidden="true" className={`ph-light ${state === "saved" ? "ph-check" : state === "saving" ? "ph-circle-notch" : "ph-cloud-slash"}`} />{labels[state]}</span>;
}

function sessionQuestions(session: StudioRitualSession, ritual: StudioStructure) {
  const preparation = asRecord(session.preparationJson);
  const proposal = asRecord(preparation.proposal);
  const agenda = Array.isArray(proposal.agenda) ? proposal.agenda.map(asRecord).flatMap((item) => (
    typeof item.prompt === "string" && item.prompt.trim()
      ? [{ prompt: item.prompt.trim(), purpose: typeof item.purpose === "string" ? item.purpose : "" }]
      : []
  )) : [];
  if (agenda.length) return agenda;
  const guideQuestions = stringList(ritual.propertiesJson[RITUAL_FIELDS.guideQuestions.key]);
  return (guideQuestions.length ? guideQuestions : ["O que você quer registrar nesta revisão?"])
    .map((prompt) => ({ prompt, purpose: "Sua leitura deste momento." }));
}

function firstUnansweredQuestion(
  questions: Array<{ prompt: string; purpose: string }>,
  answers: Record<string, string>
) {
  const index = questions.findIndex((question) => !(answers[question.prompt] ?? "").trim());
  return index < 0 ? Math.max(questions.length - 1, 0) : index;
}

function preparationTitle(session: StudioRitualSession) {
  const proposal = asRecord(asRecord(session.preparationJson).proposal);
  return typeof proposal.title === "string" ? proposal.title : null;
}

function ritualTitle(ritual: StudioStructure) {
  if (ritual.documentTitle?.trim()) return ritual.documentTitle.trim();
  const intention = ritual.propertiesJson[RITUAL_FIELDS.intention.key];
  return typeof intention === "string" && intention.trim() ? intention.trim() : "Ritual privado";
}

function cadenceLabel(ritual: StudioStructure) {
  if (!ritual.cadenceJson || !ritual.nextRunAt) return "Sem agenda fixa";
  try {
    const date = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: ritual.cadenceJson.timezone }).format(new Date(ritual.nextRunAt));
    return `Próxima sessão: ${date}`;
  } catch {
    return "Sessão configurada";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function ritualErrorMessage(error: unknown) {
  if (error instanceof StudioApiError) {
    if (error.code === "STUDIO_RITUAL_SESSION_CHANGED") return "A sessão mudou em outra aba. Recarregue antes de continuar.";
    if (error.status === 403 || error.status === 404) return "Este ritual não está disponível neste espaço privado.";
    return error.message || "Não foi possível concluir esta ação agora.";
  }
  return isOfflineError(error)
    ? "A conexão parece indisponível. Seu conteúdo local continua preservado."
    : "Não foi possível concluir esta ação agora.";
}

function isRitualConflict(error: unknown) {
  return error instanceof StudioApiError && error.code === "STUDIO_RITUAL_SESSION_CHANGED";
}

function isOfflineError(error: unknown) {
  return error instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);
}

function draftKey(sessionId: string) { return `${SESSION_DRAFT_PREFIX}${sessionId}`; }

function readRitualDraft(sessionId: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(draftKey(sessionId));
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {};
  } catch { return {}; }
}

function writeRitualDraft(sessionId: string, answers: Record<string, string>) {
  try {
    window.localStorage.setItem(draftKey(sessionId), JSON.stringify(answers));
    return true;
  } catch {
    return false;
  }
}

function removeRitualDraft(sessionId: string) {
  try { window.localStorage.removeItem(draftKey(sessionId)); } catch { /* best effort */ }
}

function safeTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

type RitualBuilderDraft = {
  name: string;
  intention: string;
  questions: string;
  scheduled: boolean;
  frequency: StudioRitualCadence["frequency"];
  localTime: string;
  weekday: number;
  monthDay: number;
  timezone: string;
  documentId: string | null;
  captureKey: string;
};

function emptyRitualBuilderDraft(): RitualBuilderDraft {
  return {
    name: "", intention: "", questions: "", scheduled: false, frequency: "weekly", localTime: "09:00",
    weekday: new Date().getDay(), monthDay: new Date().getDate(), timezone: safeTimezone(),
    documentId: null, captureKey: createIdempotencyKey()
  };
}

function readRitualBuilderDraft(): RitualBuilderDraft {
  const fallback = emptyRitualBuilderDraft();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RITUAL_BUILDER_DRAFT_KEY) || "null") as Partial<RitualBuilderDraft> | null;
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      ...fallback,
      name: typeof parsed.name === "string" ? parsed.name : fallback.name,
      intention: typeof parsed.intention === "string" ? parsed.intention : fallback.intention,
      questions: typeof parsed.questions === "string" ? parsed.questions : fallback.questions,
      scheduled: typeof parsed.scheduled === "boolean" ? parsed.scheduled : fallback.scheduled,
      frequency: parsed.frequency === "daily" || parsed.frequency === "weekly" || parsed.frequency === "monthly" ? parsed.frequency : fallback.frequency,
      localTime: typeof parsed.localTime === "string" ? parsed.localTime : fallback.localTime,
      weekday: Number.isInteger(parsed.weekday) ? parsed.weekday! : fallback.weekday,
      monthDay: Number.isInteger(parsed.monthDay) ? parsed.monthDay! : fallback.monthDay,
      timezone: typeof parsed.timezone === "string" ? parsed.timezone : fallback.timezone,
      documentId: typeof parsed.documentId === "string" ? parsed.documentId : null,
      captureKey: typeof parsed.captureKey === "string" ? parsed.captureKey : fallback.captureKey
    };
  } catch { return fallback; }
}

function writeRitualBuilderDraft(draft: RitualBuilderDraft) {
  try { window.localStorage.setItem(RITUAL_BUILDER_DRAFT_KEY, JSON.stringify(draft)); } catch { /* browser navigation guard remains */ }
}

function removeRitualBuilderDraft() {
  try { window.localStorage.removeItem(RITUAL_BUILDER_DRAFT_KEY); } catch { /* best effort */ }
}

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/gu, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

const weekdays = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
