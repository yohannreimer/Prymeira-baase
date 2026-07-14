import { useEffect, useState } from "react";
import type { StudioStructure } from "./studio.types";

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
  const [decision, setDecision] = useState(() => text(properties, "decision"));
  const [context, setContext] = useState(() => text(properties, "context"));
  const [decisionDate, setDecisionDate] = useState(() => text(properties, "decision_date"));
  const [reviewDate, setReviewDate] = useState(() => text(properties, "review_date"));
  const [learnings, setLearnings] = useState(() => text(properties, "learnings"));

  useEffect(() => {
    const next = structure?.propertiesJson ?? {};
    setDecision(text(next, "decision"));
    setContext(text(next, "context"));
    setDecisionDate(text(next, "decision_date"));
    setReviewDate(text(next, "review_date"));
    setLearnings(text(next, "learnings"));
  }, [structure]);

  function save() {
    if (!decision.trim() || busy) return;
    const nextProperties = { ...properties, decision: decision.trim() };
    setOptional(nextProperties, "context", context);
    setOptional(nextProperties, "decision_date", decisionDate);
    setOptional(nextProperties, "review_date", reviewDate);
    setOptional(nextProperties, "learnings", learnings);
    void onSave({
      properties_json: nextProperties,
      horizon_at: reviewDate ? new Date(`${reviewDate}T00:00:00.000Z`).toISOString() : null
    });
  }

  return (
    <form className="studio-structure-form" aria-label="Detalhes da decisão" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <label><span>Decisão tomada</span><textarea aria-label="Decisão tomada" value={decision} onChange={(event) => setDecision(event.currentTarget.value)} rows={3} required /></label>
      <label><span>Contexto original</span><textarea aria-label="Contexto original" value={context} onChange={(event) => setContext(event.currentTarget.value)} rows={4} /></label>
      <div className="studio-structure-form__field-grid">
        <label><span>Data da decisão</span><input aria-label="Data da decisão" type="date" value={decisionDate} onChange={(event) => setDecisionDate(event.currentTarget.value)} /></label>
        <label><span>Revisar em</span><input aria-label="Revisar em" type="date" value={reviewDate} onChange={(event) => setReviewDate(event.currentTarget.value)} /></label>
      </div>
      <label><span>Efeitos e aprendizados</span><textarea aria-label="Efeitos e aprendizados" value={learnings} onChange={(event) => setLearnings(event.currentTarget.value)} rows={3} placeholder="Pode ficar em branco e ser preenchido quando houver algo novo." /></label>
      {error ? <p className="studio-structure-form__error" role="alert">{error}</p> : null}
      <footer><button className="primary" type="submit" disabled={!decision.trim() || busy}>{busy ? "Salvando…" : structure ? "Salvar decisão" : "Criar decisão"}</button></footer>
    </form>
  );
}

function setOptional(properties: Record<string, unknown>, key: string, value: string) {
  if (value.trim()) properties[key] = value.trim();
  else delete properties[key];
}
