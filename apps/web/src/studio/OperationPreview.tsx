import { useEffect, useRef, useState } from "react";
import { confirmStudioOperationPreview, createStudioOperationPreview } from "./studio-api";
import type { StudioOperationDraft, StudioOperationalLink, StudioOperationPreview as Preview } from "./studio.types";

type Props = {
  suggestionId: string;
  sourceDocument: { id: string; title: string | null };
  drafts: StudioOperationDraft[];
  onNavigate?(link: StudioOperationalLink): void;
  onClose?(): void;
};

const RESOURCE_LABELS = {
  task: "Tarefa pontual",
  routine: "Rotina",
  process: "Processo em rascunho",
  announcement: "Comunicado em rascunho"
} as const;

export default function OperationPreview({ suggestionId, sourceDocument, drafts: initialDrafts, onNavigate, onClose }: Props) {
  const [drafts, setDrafts] = useState(() => structuredClone(initialDrafts));
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [links, setLinks] = useState<StudioOperationalLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<"preview" | "confirmation" | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const loadRef = useRef<Promise<Preview[]> | null>(null);
  const confirmationKeysRef = useRef(initialDrafts.map(() => crypto.randomUUID()));
  const confirmationGuardRef = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const pending = loadRef.current ?? Promise.all(initialDrafts.map((draft) => (
      createStudioOperationPreview(suggestionId, draft)
    )));
    loadRef.current = pending;
    void pending.then((loaded) => {
      if (!active) return;
      setPreviews(loaded);
      setLoading(false);
    }, () => {
      if (!active) return;
      setError("preview");
      setLoading(false);
    });
    return () => { active = false; };
  }, [initialDrafts, suggestionId, loadAttempt]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => { headingRef.current?.focus(); }, []);

  useEffect(() => {
    if (links.length) resultRef.current?.focus();
  }, [links.length]);

  const valid = drafts.length > 0 && drafts.every(validDraft);
  const countLabel = `${drafts.length} ${drafts.length === 1 ? "registro" : "registros"}`;

  async function confirm() {
    if (confirmationGuardRef.current || confirming || !valid || previews.length !== drafts.length) return;
    confirmationGuardRef.current = true;
    setConfirming(true);
    setError(null);
    try {
      const created = await Promise.all(previews.map((preview, index) => confirmStudioOperationPreview(
        suggestionId,
        preview.id,
        confirmationKeysRef.current[index]!,
        drafts[index]!
      )));
      setLinks(created);
    } catch {
      setError("confirmation");
      confirmationGuardRef.current = false;
    } finally {
      setConfirming(false);
    }
  }

  function retryPreview() {
    loadRef.current = null;
    setLoadAttempt((value) => value + 1);
  }

  if (links.length) return <section ref={resultRef} className="studio-operation-result" role="region" aria-label="Recurso criado"
    aria-live="polite" aria-atomic="true" tabIndex={-1}>
    <header>
      <span className="studio-operation-result__mark"><i className="ph-light ph-check" aria-hidden="true" /></span>
      <div><p className="mono">Origem preservada</p><h3>{links.length === 1 ? "Movimento criado" : `${links.length} movimentos criados`}</h3></div>
    </header>
    <p className="studio-operation-result__source">A reflexão continua no Estúdio · {sourceDocument.title || "Documento sem título"}</p>
    <div className="studio-operation-result__links">
      {links.map((link, index) => <article key={link.id}>
        <div><small>{RESOURCE_LABELS[link.resourceType]}</small><strong>{draftTitle(drafts[index]!)}</strong></div>
        <button type="button" onClick={() => onNavigate?.(link)}>Abrir {resourceNoun(link.resourceType)}</button>
      </article>)}
    </div>
  </section>;

  return <section className="studio-operation-preview" role="region" aria-label="Prévia operacional">
    <header className="studio-operation-preview__header">
      <div><p className="mono">Revisar antes de criar</p><h3 ref={headingRef} tabIndex={-1}>Da clareza para a operação</h3></div>
      {onClose ? <button type="button" aria-label="Fechar prévia operacional" onClick={onClose}><i className="ph-light ph-x" aria-hidden="true" /></button> : null}
    </header>
    <div className="studio-operation-preview__origin">
      <span>{countLabel}</span>
      <p><small>Documento de origem</small><strong>{sourceDocument.title || "Documento sem título"}</strong></p>
    </div>
    {loading ? <div className="studio-operation-preview__loading" role="status">Preparando uma prévia segura…</div> : null}
    {error === "preview" ? <div className="studio-operation-preview__error">
      <p ref={errorRef} role="alert" tabIndex={-1}>Não foi possível preparar a prévia. Nada foi criado.</p>
      <button type="button" onClick={retryPreview}>Tentar preparar novamente</button>
    </div> : null}
    {!loading && error !== "preview" ? <div className="studio-operation-preview__records">
      {drafts.map((draft, index) => <details key={`${draft.resource_type}-${index}`} open={index === 0 || drafts.length === 1}>
        <summary>
          <span>{index + 1}. {RESOURCE_LABELS[draft.resource_type]}</span>
          <strong>{draftTitle(draft)}</strong>
        </summary>
        <div className="studio-operation-preview__record">
          <MissingReferences draft={draft} />
          <DraftEditor draft={draft} index={index} onChange={(next) => setDrafts((current) => (
            current.map((item, itemIndex) => itemIndex === index ? next : item)
          ))} />
        </div>
      </details>)}
    </div> : null}
    {error === "confirmation" ? <div className="studio-operation-preview__error">
      <p ref={errorRef} role="alert" tabIndex={-1}>A criação não foi confirmada. A mesma chave segura será usada na nova tentativa.</p>
      <button type="button" onClick={() => void confirm()}>Tentar confirmação novamente</button>
    </div> : null}
    <footer>
      <p><i className="ph-light ph-lock-key" aria-hidden="true" /> Nada será criado sem esta confirmação final.</p>
      <button className="primary" type="button" disabled={loading || confirming || !valid || previews.length !== drafts.length}
        onClick={() => void confirm()}>{confirming ? "Criando com segurança…" : `Confirmar e criar ${countLabel}`}</button>
    </footer>
  </section>;
}

function DraftEditor({ draft, index, onChange }: { draft: StudioOperationDraft; index: number; onChange(draft: StudioOperationDraft): void }) {
  const id = `studio-operation-${index}`;
  if (draft.resource_type === "task") {
    const payload = draft.payload;
    const update = (patch: Partial<typeof payload>) => onChange({ ...draft, payload: { ...payload, ...patch } });
    return <div className="studio-operation-fields">
      <TextField id={`${id}-title`} label="Título" value={payload.title} required onChange={(title) => update({ title })} />
      <TextField id={`${id}-area`} label="Área" value={payload.area_id ?? ""} placeholder="Sem área definida" onChange={(area_id) => update({ area_id: area_id || null })} />
      <TextField id={`${id}-assignee`} label="Responsável" value={payload.assignee_profile_id ?? ""} placeholder="Sem responsável definido" onChange={(assignee_profile_id) => update({ assignee_profile_id: assignee_profile_id || null })} />
      <label htmlFor={`${id}-due`}>Data de vencimento<input id={`${id}-due`} name={`${id}-due`} autoComplete="off" type="date" required value={payload.due_date} onChange={(event) => update({ due_date: event.currentTarget.value })} /></label>
      <TextField id={`${id}-hint`} label="Orientação de prazo" value={payload.due_hint ?? ""} onChange={(due_hint) => update({ due_hint: due_hint || null })} />
      <SelectField id={`${id}-approval`} label="Aprovação" value={payload.approval_mode} options={approvalOptions} onChange={(approval_mode) => update({ approval_mode: approval_mode as typeof payload.approval_mode })} />
      <SelectField id={`${id}-evidence`} label="Evidência" value={payload.evidence_policy} options={evidenceOptions} onChange={(evidence_policy) => update({ evidence_policy: evidence_policy as typeof payload.evidence_policy })} />
      <TextListEditor id={`${id}-checklist`} className="wide" legend="Checklist / passos" addLabel="Adicionar item ao checklist"
        itemLabel={(position) => `Item ${position} do checklist`} removeLabel={(position) => `Remover item ${position} do checklist`}
        values={payload.checklist_items} onChange={(checklist_items) => update({ checklist_items })} />
    </div>;
  }
  if (draft.resource_type === "routine") {
    const payload = draft.payload;
    const update = (patch: Partial<typeof payload>) => onChange({ ...draft, payload: { ...payload, ...patch } });
    return <div className="studio-operation-fields">
      <TextField id={`${id}-title`} label="Título" value={payload.title} required onChange={(title) => update({ title })} />
      <TextField id={`${id}-area`} label="Área" value={payload.area_id ?? ""} placeholder="Sem área definida" onChange={(area_id) => update({ area_id: area_id || null })} />
      <SelectField id={`${id}-frequency`} label="Frequência" value={payload.frequency} options={frequencyOptions} onChange={(frequency) => update({ frequency: frequency as typeof payload.frequency })} />
      <WeekdayEditor id={`${id}-weekdays`} values={payload.weekdays} onChange={(weekdays) => update({ weekdays })} />
      <TextField id={`${id}-hint`} label="Limite" value={payload.due_hint ?? ""} onChange={(due_hint) => update({ due_hint: due_hint || null })} />
      <TextListEditor id={`${id}-assignees`} legend="Responsáveis" addLabel="Adicionar responsável"
        itemLabel={(position) => `Responsável ${position}`} removeLabel={(position) => `Remover responsável ${position}`}
        values={payload.assignee_profile_ids} onChange={(assignee_profile_ids) => update({ assignee_profile_ids })} />
      <SelectField id={`${id}-execution`} label="Execução" value={payload.execution_mode} options={executionOptions} onChange={(execution_mode) => update({ execution_mode: execution_mode as typeof payload.execution_mode })} />
      <SelectField id={`${id}-approval`} label="Aprovação" value={payload.approval_mode} options={approvalOptions} onChange={(approval_mode) => update({ approval_mode: approval_mode as typeof payload.approval_mode })} />
      <SelectField id={`${id}-evidence`} label="Evidência" value={payload.evidence_policy} options={evidenceOptions} onChange={(evidence_policy) => update({ evidence_policy: evidence_policy as typeof payload.evidence_policy })} />
      <fieldset className="studio-operation-steps wide"><legend>Checklist / etapas · {payload.task_templates.length}</legend>
        {payload.task_templates.map((step, stepIndex) => <div key={stepIndex} className="studio-operation-step">
          <div className="studio-operation-step__header"><strong>{step.title || `Etapa ${stepIndex + 1}`}</strong>
            <button type="button" aria-label={`Remover etapa ${stepIndex + 1}`} onClick={() => update({ task_templates: removeAt(payload.task_templates, stepIndex) })}><i className="ph-light ph-trash" aria-hidden="true" /></button></div>
          <TextField id={`${id}-step-${stepIndex}-title`} label={`Título da etapa ${stepIndex + 1}`} value={step.title} required onChange={(title) => updateStep(update, payload, stepIndex, { title })} />
          <TextField id={`${id}-step-${stepIndex}-process`} label="Processo relacionado" value={step.process_id ?? ""} onChange={(process_id) => updateStep(update, payload, stepIndex, { process_id: process_id || null })} />
          <TextField id={`${id}-step-${stepIndex}-assignee`} label="Responsável da etapa" value={step.assignee_profile_id ?? ""} onChange={(assignee_profile_id) => updateStep(update, payload, stepIndex, { assignee_profile_id: assignee_profile_id || null })} />
          <TextField id={`${id}-step-${stepIndex}-hint`} label="Limite da etapa" value={step.due_hint ?? ""} onChange={(due_hint) => updateStep(update, payload, stepIndex, { due_hint: due_hint || null })} />
          <SelectField id={`${id}-step-${stepIndex}-approval`} label="Aprovação da etapa" value={step.approval_mode} options={approvalOptions} onChange={(approval_mode) => updateStep(update, payload, stepIndex, { approval_mode: approval_mode as typeof step.approval_mode })} />
          <SelectField id={`${id}-step-${stepIndex}-evidence`} label="Evidência da etapa" value={step.evidence_policy} options={evidenceOptions} onChange={(evidence_policy) => updateStep(update, payload, stepIndex, { evidence_policy: evidence_policy as typeof step.evidence_policy })} />
        </div>)}
        <button className="studio-operation-add" type="button" onClick={() => update({ task_templates: [...payload.task_templates, emptyRoutineStep()] })}><i className="ph-light ph-plus" aria-hidden="true" /> Adicionar etapa</button>
      </fieldset>
    </div>;
  }
  if (draft.resource_type === "process") {
    const payload = draft.payload;
    const update = (patch: Partial<typeof payload>) => onChange({ ...draft, payload: { ...payload, ...patch } });
    const ownerId = payload.owner?.type === "person" ? payload.owner.person_id : payload.owner?.role_template_id ?? "";
    return <div className="studio-operation-fields">
      <TextField id={`${id}-title`} label="Título" value={payload.title} required onChange={(title) => update({ title })} />
      <TextField id={`${id}-area`} label="Área" value={payload.area_id ?? ""} placeholder="Sem área definida" onChange={(area_id) => update({ area_id: area_id || null })} />
      <label className="wide" htmlFor={`${id}-body`}>Conteúdo do processo<textarea id={`${id}-body`} name={`${id}-body`} autoComplete="off" rows={7} required value={payload.body} onChange={(event) => update({ body: event.currentTarget.value })} /></label>
      <TextField id={`${id}-summary`} label="Resumo" value={payload.summary ?? ""} onChange={(summary) => update({ summary: summary || null })} />
      <SelectField id={`${id}-owner-type`} label="Tipo de responsável" value={payload.owner?.type ?? "none"} options={[{ value: "none", label: "Não definido" }, { value: "person", label: "Pessoa" }, { value: "role", label: "Cargo" }]} onChange={(type) => update({ owner: type === "none" ? null : type === "person" ? { type: "person", person_id: ownerId } : { type: "role", role_template_id: ownerId } })} />
      <TextField id={`${id}-owner`} label="Responsável" value={ownerId} onChange={(value) => update({ owner: !payload.owner ? null : payload.owner.type === "person" ? { type: "person", person_id: value } : { type: "role", role_template_id: value } })} />
    </div>;
  }
  const payload = draft.payload;
  const update = (patch: Partial<typeof payload>) => onChange({ ...draft, payload: { ...payload, ...patch } });
  const audienceType = payload.audience.type;
  const audienceId = audienceType === "area" ? payload.audience.area_id
    : audienceType === "role" ? payload.audience.role_template_id
      : audienceType === "person" ? payload.audience.profile_id : "";
  return <div className="studio-operation-fields">
    <TextField id={`${id}-title`} label="Título" value={payload.title} required onChange={(title) => update({ title })} />
    <label className="wide" htmlFor={`${id}-body`}>Mensagem<textarea id={`${id}-body`} name={`${id}-body`} autoComplete="off" rows={6} required value={payload.body} onChange={(event) => update({ body: event.currentTarget.value })} /></label>
    <SelectField id={`${id}-type`} label="Tipo" value={payload.type} options={announcementTypeOptions} onChange={(type) => update({ type: type as typeof payload.type })} />
    <SelectField id={`${id}-requirement`} label="Confirmação" value={payload.requirement} options={requirementOptions} onChange={(requirement) => update({ requirement: requirement as typeof payload.requirement })} />
    <SelectField id={`${id}-audience-type`} label="Tipo de público" value={audienceType} options={audienceOptions} onChange={(type) => update({
      audience: type === "all" ? { type } : type === "area" ? { type, area_id: audienceId }
        : type === "role" ? { type, role_template_id: audienceId } : { type: "person", profile_id: audienceId }
    })} />
    {audienceType !== "all" ? <TextField id={`${id}-audience-id`} label="Referência do público" value={audienceId} required onChange={(value) => update({
      audience: audienceType === "area" ? { type: "area", area_id: value }
        : audienceType === "role" ? { type: "role", role_template_id: value } : { type: "person", profile_id: value }
    })} /> : null}
    <TextField id={`${id}-process`} label="Processo relacionado" value={payload.related_process_id ?? ""} onChange={(related_process_id) => update({ related_process_id: related_process_id || null })} />
    <TextField id={`${id}-training`} label="Treinamento relacionado" value={payload.related_training_id ?? ""} onChange={(related_training_id) => update({ related_training_id: related_training_id || null })} />
    <fieldset className="studio-operation-steps wide"><legend>Quiz / perguntas · {payload.quiz_questions.length}</legend>
      {payload.quiz_questions.map((question, questionIndex) => <div className="studio-operation-step" key={questionIndex}>
        <div className="studio-operation-step__header"><strong>{question.prompt || `Pergunta ${questionIndex + 1}`}</strong>
          <button type="button" aria-label={`Remover pergunta ${questionIndex + 1}`} onClick={() => update({ quiz_questions: removeAt(payload.quiz_questions, questionIndex) })}><i className="ph-light ph-trash" aria-hidden="true" /></button></div>
        <TextField id={`${id}-question-${questionIndex}-prompt`} label={`Pergunta ${questionIndex + 1}`} value={question.prompt} required onChange={(prompt) => updateQuizQuestion(update, payload, questionIndex, { prompt })} />
        <label htmlFor={`${id}-question-${questionIndex}-options`}>Opções da pergunta {questionIndex + 1}
          <textarea id={`${id}-question-${questionIndex}-options`} name={`${id}-question-${questionIndex}-options`} autoComplete="off" rows={Math.max(3, question.options.length)} required
            value={question.options.map(optionLine).join("\n")} onChange={(event) => updateQuizQuestion(update, payload, questionIndex, { options: optionLines(event.currentTarget.value) })} />
        </label>
        <TextField id={`${id}-question-${questionIndex}-correct`} label="ID da opção correta" value={question.correct_option_id} required onChange={(correct_option_id) => updateQuizQuestion(update, payload, questionIndex, { correct_option_id })} />
        <TextField id={`${id}-question-${questionIndex}-explanation`} label="Explicação" value={question.explanation ?? ""} onChange={(explanation) => updateQuizQuestion(update, payload, questionIndex, { explanation: explanation || null })} />
      </div>)}
      <button className="studio-operation-add" type="button" onClick={() => update({ quiz_questions: [...payload.quiz_questions, emptyQuizQuestion()] })}><i className="ph-light ph-plus" aria-hidden="true" /> Adicionar pergunta</button>
    </fieldset>
  </div>;
}

function TextField({ id, label, value, placeholder, required, onChange }: { id: string; label: string; value: string; placeholder?: string; required?: boolean; onChange(value: string): void }) {
  return <label htmlFor={id}>{label}<input id={id} name={id} autoComplete="off" value={value} placeholder={placeholder} required={required} onChange={(event) => onChange(event.currentTarget.value)} /></label>;
}

function SelectField({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Array<{ value: string; label: string }>; onChange(value: string): void }) {
  return <label htmlFor={id}>{label}<select id={id} name={id} autoComplete="off" value={value} onChange={(event) => onChange(event.currentTarget.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function TextListEditor({ id, className, legend, itemLabel, addLabel, removeLabel, values, onChange }: {
  id: string;
  className?: string;
  legend: string;
  itemLabel(position: number): string;
  addLabel: string;
  removeLabel(position: number): string;
  values: string[];
  onChange(values: string[]): void;
}) {
  return <fieldset className={`studio-operation-list ${className ?? ""}`.trim()}>
    <legend>{legend} · {values.length}</legend>
    {values.map((value, index) => <div className="studio-operation-list__row" key={index}>
      <TextField id={`${id}-${index}`} label={itemLabel(index + 1)} value={value} required onChange={(next) => onChange(replaceAt(values, index, next))} />
      <button type="button" aria-label={removeLabel(index + 1)} onClick={() => onChange(removeAt(values, index))}><i className="ph-light ph-trash" aria-hidden="true" /></button>
    </div>)}
    <button className="studio-operation-add" type="button" onClick={() => onChange([...values, ""])}><i className="ph-light ph-plus" aria-hidden="true" /> {addLabel}</button>
  </fieldset>;
}

type RoutineWeekday = Extract<StudioOperationDraft, { resource_type: "routine" }>["payload"]["weekdays"][number];
function WeekdayEditor({ id, values, onChange }: { id: string; values: RoutineWeekday[]; onChange(values: RoutineWeekday[]): void }) {
  return <fieldset className="studio-operation-list">
    <legend>Dias da semana · {values.length}</legend>
    {values.map((value, index) => <div className="studio-operation-list__row" key={index}>
      <SelectField id={`${id}-${index}`} label={`Dia da semana ${index + 1}`} value={value} options={weekdayOptions}
        onChange={(next) => onChange(replaceAt(values, index, next as RoutineWeekday))} />
      <button type="button" aria-label={`Remover dia da semana ${index + 1}`} onClick={() => onChange(removeAt(values, index))}><i className="ph-light ph-trash" aria-hidden="true" /></button>
    </div>)}
    <button className="studio-operation-add" type="button" onClick={() => onChange([...values, firstAvailableWeekday(values)])}><i className="ph-light ph-plus" aria-hidden="true" /> Adicionar dia da semana</button>
  </fieldset>;
}

function MissingReferences({ draft }: { draft: StudioOperationDraft }) {
  const missing = missingReferences(draft);
  if (!missing.length) return <p className="studio-operation-preview__references ok"><i className="ph-light ph-check-circle" aria-hidden="true" /> Referências prontas para revisão</p>;
  return <div className="studio-operation-preview__references"><span><i className="ph-light ph-info" aria-hidden="true" /> Referências ainda abertas</span>{missing.map((item) => <em key={item}>{item}</em>)}</div>;
}

function missingReferences(draft: StudioOperationDraft) {
  const missing: string[] = [];
  if ("area_id" in draft.payload && !draft.payload.area_id) missing.push("Área não definida");
  if (draft.resource_type === "task" && !draft.payload.assignee_profile_id) missing.push("Responsável não definido");
  if (draft.resource_type === "routine" && !draft.payload.assignee_profile_ids.length) missing.push("Responsáveis não definidos");
  if (draft.resource_type === "process" && !draft.payload.owner) missing.push("Responsável não definido");
  return missing;
}

function validDraft(draft: StudioOperationDraft) {
  if (!draft.payload.title.trim()) return false;
  if (draft.resource_type === "task") return /^\d{4}-\d{2}-\d{2}$/u.test(draft.payload.due_date)
    && draft.payload.checklist_items.every((item) => Boolean(item.trim()));
  if (draft.resource_type === "routine") {
    const weekdaysValid = draft.payload.frequency === "weekly" ? draft.payload.weekdays.length === 1
      : (draft.payload.frequency === "monthly" || draft.payload.frequency === "on_demand") ? draft.payload.weekdays.length === 0 : true;
    return draft.payload.task_templates.length > 0
      && draft.payload.task_templates.every((item) => Boolean(item.title.trim()))
      && draft.payload.assignee_profile_ids.every((item) => Boolean(item.trim()))
      && new Set(draft.payload.assignee_profile_ids).size === draft.payload.assignee_profile_ids.length
      && new Set(draft.payload.weekdays).size === draft.payload.weekdays.length
      && weekdaysValid;
  }
  if (draft.resource_type === "process") return Boolean(draft.payload.body.trim())
    && (!draft.payload.owner || (draft.payload.owner.type === "person"
      ? Boolean(draft.payload.owner.person_id.trim()) : Boolean(draft.payload.owner.role_template_id.trim())));
  const audienceValid = draft.payload.audience.type === "all" || (draft.payload.audience.type === "area"
    ? Boolean(draft.payload.audience.area_id.trim()) : draft.payload.audience.type === "role"
      ? Boolean(draft.payload.audience.role_template_id.trim()) : Boolean(draft.payload.audience.profile_id.trim()));
  const quizValid = draft.payload.requirement !== "quiz_confirmation" || (draft.payload.quiz_questions.length > 0
    && draft.payload.quiz_questions.every((question) => Boolean(question.prompt.trim())
      && question.options.length >= 2
      && question.options.every((option) => Boolean(option.id.trim()) && Boolean(option.label.trim()))
      && question.options.some((option) => option.id === question.correct_option_id)));
  return Boolean(draft.payload.body.trim()) && audienceValid && quizValid;
}

function updateStep(
  update: (patch: Partial<Extract<StudioOperationDraft, { resource_type: "routine" }>["payload"]>) => void,
  payload: Extract<StudioOperationDraft, { resource_type: "routine" }>["payload"],
  index: number,
  patch: Partial<Extract<StudioOperationDraft, { resource_type: "routine" }>["payload"]["task_templates"][number]>
) {
  update({ task_templates: payload.task_templates.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) });
}

function updateQuizQuestion(
  update: (patch: Partial<Extract<StudioOperationDraft, { resource_type: "announcement" }>["payload"]>) => void,
  payload: Extract<StudioOperationDraft, { resource_type: "announcement" }>["payload"],
  index: number,
  patch: Partial<Extract<StudioOperationDraft, { resource_type: "announcement" }>["payload"]["quiz_questions"][number]>
) {
  update({ quiz_questions: payload.quiz_questions.map((question, questionIndex) => questionIndex === index ? { ...question, ...patch } : question) });
}

function optionLines(value: string) {
  return value.split("\n").map((item) => {
    const separator = item.indexOf(":");
    return separator >= 0
      ? { id: item.slice(0, separator).trim(), label: item.slice(separator + 1).trim() }
      : { id: "", label: item };
  });
}
function optionLine(option: { id: string; label: string }) { return option.id || option.label ? `${option.id}: ${option.label}` : ""; }
function replaceAt<T>(values: T[], index: number, value: T) { return values.map((item, itemIndex) => itemIndex === index ? value : item); }
function removeAt<T>(values: T[], index: number) { return values.filter((_, itemIndex) => itemIndex !== index); }
function firstAvailableWeekday(values: RoutineWeekday[]) {
  return (weekdayOptions.find((option) => !values.includes(option.value as RoutineWeekday))?.value ?? "mon") as RoutineWeekday;
}
function emptyRoutineStep(): Extract<StudioOperationDraft, { resource_type: "routine" }>["payload"]["task_templates"][number] {
  return { title: "", process_id: null, assignee_profile_id: null, due_hint: null, approval_mode: "direct", evidence_policy: "optional" };
}
function emptyQuizQuestion(): Extract<StudioOperationDraft, { resource_type: "announcement" }>["payload"]["quiz_questions"][number] {
  return { prompt: "", options: [{ id: "", label: "" }, { id: "", label: "" }], correct_option_id: "", explanation: null };
}
function draftTitle(draft: StudioOperationDraft) { return draft.payload.title || "Sem título"; }
function resourceNoun(type: StudioOperationDraft["resource_type"]) { return ({ task: "tarefa", routine: "rotina", process: "processo", announcement: "comunicado" } as const)[type]; }

const approvalOptions = [{ value: "direct", label: "Conclusão direta" }, { value: "approval_required", label: "Exige aprovação" }];
const evidenceOptions = [
  { value: "optional", label: "Opcional" }, { value: "photo_required", label: "Foto obrigatória" },
  { value: "comment_required", label: "Comentário obrigatório" }, { value: "photo_or_comment_required", label: "Foto ou comentário" }
];
const frequencyOptions = [
  { value: "daily", label: "Diária" }, { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensal" }, { value: "on_demand", label: "Sob demanda" }
];
const executionOptions = [{ value: "shared", label: "Compartilhada" }, { value: "individual", label: "Uma execução por responsável" }];
const announcementTypeOptions = [
  { value: "simple", label: "Simples" }, { value: "process_change", label: "Mudança de processo" },
  { value: "mandatory_training", label: "Treinamento obrigatório" }
];
const requirementOptions = [
  { value: "none", label: "Sem confirmação" }, { value: "read_confirmation", label: "Confirmar leitura" },
  { value: "quiz_confirmation", label: "Responder quiz" }
];
const audienceOptions = [
  { value: "all", label: "Toda a empresa" }, { value: "area", label: "Área" },
  { value: "role", label: "Cargo" }, { value: "person", label: "Pessoa" }
];
const weekdayOptions = [
  { value: "mon", label: "Segunda-feira" }, { value: "tue", label: "Terça-feira" },
  { value: "wed", label: "Quarta-feira" }, { value: "thu", label: "Quinta-feira" },
  { value: "fri", label: "Sexta-feira" }, { value: "sat", label: "Sábado" },
  { value: "sun", label: "Domingo" }
];
