import { useEffect, useState } from "react";
import { STUDIO_STRUCTURE_CONTRACT } from "@prymeira/baase-shared";
import type { StudioStructure } from "./studio.types";

const DECISION_FIELDS = STUDIO_STRUCTURE_CONTRACT.decision.properties;

export type DecisionDetailsValue = {
  horizon_at: string | null;
  properties_json: Record<string, unknown>;
};

type DecisionDetailsProps = {
  structure?: StudioStructure | null;
  busy?: boolean;
  error?: string | null;
  onSave(value: DecisionDetailsValue): void | Promise<void>;
};

function text(properties: Record<string, unknown>, key: string) {
  return typeof properties[key] === "string" ? properties[key] : "";
}

export default function DecisionDetails({ structure = null, busy = false, error, onSave }: DecisionDetailsProps) {
  const properties = structure?.propertiesJson ?? {};
  const [decision, setDecision] = useState(() => text(properties, DECISION_FIELDS.decision.key));
  const [context, setContext] = useState(() => text(properties, DECISION_FIELDS.context.key));
  const [decisionDate, setDecisionDate] = useState(() => text(properties, DECISION_FIELDS.decisionDate.key));
  const [reviewDate, setReviewDate] = useState(() => text(properties, DECISION_FIELDS.reviewDate.key));
  const [learnings, setLearnings] = useState(() => text(properties, DECISION_FIELDS.learnings.key));

  useEffect(() => {
    const next = structure?.propertiesJson ?? {};
    setDecision(text(next, DECISION_FIELDS.decision.key));
    setContext(text(next, DECISION_FIELDS.context.key));
    setDecisionDate(text(next, DECISION_FIELDS.decisionDate.key));
    setReviewDate(text(next, DECISION_FIELDS.reviewDate.key));
    setLearnings(text(next, DECISION_FIELDS.learnings.key));
  }, [structure]);

  function save() {
    if (!decision.trim() || busy) return;
    const nextProperties = { ...properties, [DECISION_FIELDS.decision.key]: decision.trim() };
    setOptional(nextProperties, DECISION_FIELDS.context.key, context);
    setOptional(nextProperties, DECISION_FIELDS.decisionDate.key, decisionDate);
    setOptional(nextProperties, DECISION_FIELDS.reviewDate.key, reviewDate);
    setOptional(nextProperties, DECISION_FIELDS.learnings.key, learnings);
    void onSave({
      properties_json: nextProperties,
      horizon_at: reviewDate ? new Date(`${reviewDate}T00:00:00.000Z`).toISOString() : null
    });
  }

  return (
    <form className="studio-structure-form" aria-label="Detalhes da decisão" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <label><span>{DECISION_FIELDS.decision.label}</span><textarea aria-label={DECISION_FIELDS.decision.label} value={decision} onChange={(event) => setDecision(event.currentTarget.value)} rows={3} required /></label>
      <label><span>{DECISION_FIELDS.context.label}</span><textarea aria-label={DECISION_FIELDS.context.label} value={context} onChange={(event) => setContext(event.currentTarget.value)} rows={4} /></label>
      <div className="studio-structure-form__field-grid">
        <label><span>{DECISION_FIELDS.decisionDate.label}</span><input aria-label={DECISION_FIELDS.decisionDate.label} type="date" value={decisionDate} onChange={(event) => setDecisionDate(event.currentTarget.value)} /></label>
        <label><span>{DECISION_FIELDS.reviewDate.label}</span><input aria-label={DECISION_FIELDS.reviewDate.label} type="date" value={reviewDate} onChange={(event) => setReviewDate(event.currentTarget.value)} /></label>
      </div>
      <label><span>{DECISION_FIELDS.learnings.label}</span><textarea aria-label={DECISION_FIELDS.learnings.label} value={learnings} onChange={(event) => setLearnings(event.currentTarget.value)} rows={3} placeholder="Pode ficar em branco e ser preenchido quando houver algo novo." /></label>
      {error ? <p className="studio-structure-form__error" role="alert">{error}</p> : null}
      <footer><button className="primary" type="submit" disabled={!decision.trim() || busy}>{busy ? "Salvando…" : structure ? "Salvar decisão" : "Criar decisão"}</button></footer>
    </form>
  );
}

function setOptional(properties: Record<string, unknown>, key: string, value: string) {
  if (value.trim()) properties[key] = value.trim();
  else delete properties[key];
}
