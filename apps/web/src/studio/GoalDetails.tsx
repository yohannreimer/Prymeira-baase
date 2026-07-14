import { useEffect, useState } from "react";
import type { StudioGoalMetric, StudioStructure } from "./studio.types";

export type GoalDetailsValue = {
  horizon_at: string | null;
  metric_json: StudioGoalMetric | null;
  properties_json: Record<string, unknown>;
};

type GoalDetailsProps = {
  documentTitle: string | null;
  structure?: StudioStructure | null;
  busy?: boolean;
  error?: string | null;
  onSave(value: GoalDetailsValue): void | Promise<void>;
};

function textProperty(properties: Record<string, unknown>, key: string) {
  return typeof properties[key] === "string" ? properties[key] : "";
}

function textListProperty(properties: Record<string, unknown>, key: string) {
  return Array.isArray(properties[key])
    ? properties[key].filter((item): item is string => typeof item === "string")
    : [];
}

function numberField(value: number | undefined) {
  return value === undefined ? "" : String(value);
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : undefined;
}

function validOptionalNumber(value: string) {
  return !value.trim() || Number.isFinite(Number(value));
}

function formatMetric(metric: StudioGoalMetric) {
  const unit = metric.unit ? ` ${metric.unit}` : "";
  return metric.current === undefined
    ? `Alvo: ${metric.target}${unit}`
    : `${metric.current} de ${metric.target}${unit}`;
}

export default function GoalDetails({ documentTitle, structure = null, busy = false, error, onSave }: GoalDetailsProps) {
  const properties = structure?.propertiesJson ?? {};
  const [desiredOutcome, setDesiredOutcome] = useState(() => textProperty(properties, "desired_outcome"));
  const [reason, setReason] = useState(() => textProperty(properties, "reason"));
  const [state, setState] = useState(() => textProperty(properties, "state"));
  const [evidence, setEvidence] = useState(() => textListProperty(properties, "progress_evidence").join("\n"));
  const [hasMetric, setHasMetric] = useState(() => structure?.metricJson !== null && structure?.metricJson !== undefined);
  const [metricLabel, setMetricLabel] = useState(() => structure?.metricJson?.label ?? "");
  const [metricTarget, setMetricTarget] = useState(() => numberField(structure?.metricJson?.target));
  const [metricCurrent, setMetricCurrent] = useState(() => numberField(structure?.metricJson?.current));
  const [metricBaseline, setMetricBaseline] = useState(() => numberField(structure?.metricJson?.baseline));
  const [metricUnit, setMetricUnit] = useState(() => structure?.metricJson?.unit ?? "");
  const [hasHorizon, setHasHorizon] = useState(() => Boolean(structure?.horizonAt));
  const [horizon, setHorizon] = useState(() => structure?.horizonAt?.slice(0, 10) ?? "");

  useEffect(() => {
    const next = structure?.propertiesJson ?? {};
    setDesiredOutcome(textProperty(next, "desired_outcome"));
    setReason(textProperty(next, "reason"));
    setState(textProperty(next, "state"));
    setEvidence(textListProperty(next, "progress_evidence").join("\n"));
    setHasMetric(Boolean(structure?.metricJson));
    setMetricLabel(structure?.metricJson?.label ?? "");
    setMetricTarget(numberField(structure?.metricJson?.target));
    setMetricCurrent(numberField(structure?.metricJson?.current));
    setMetricBaseline(numberField(structure?.metricJson?.baseline));
    setMetricUnit(structure?.metricJson?.unit ?? "");
    setHasHorizon(Boolean(structure?.horizonAt));
    setHorizon(structure?.horizonAt?.slice(0, 10) ?? "");
  }, [structure]);

  const titleReady = Boolean(documentTitle?.trim());
  const metricReady = !hasMetric || (
    metricLabel.trim()
    && metricTarget.trim()
    && Number.isFinite(Number(metricTarget))
    && validOptionalNumber(metricCurrent)
    && validOptionalNumber(metricBaseline)
  );
  const canSave = titleReady && Boolean(desiredOutcome.trim()) && Boolean(metricReady) && !busy;

  function save() {
    if (!canSave) return;
    const nextProperties = { ...properties };
    nextProperties.desired_outcome = desiredOutcome.trim();
    if (reason.trim()) nextProperties.reason = reason.trim(); else delete nextProperties.reason;
    if (state) nextProperties.state = state; else delete nextProperties.state;
    const progressEvidence = evidence.split("\n").map((item) => item.trim()).filter(Boolean);
    if (progressEvidence.length) nextProperties.progress_evidence = progressEvidence;
    else delete nextProperties.progress_evidence;
    const metric: StudioGoalMetric | null = hasMetric ? {
      label: metricLabel.trim(),
      target: Number(metricTarget),
      ...(metricUnit.trim() ? { unit: metricUnit.trim() } : {}),
      ...(optionalNumber(metricBaseline) === undefined ? {} : { baseline: optionalNumber(metricBaseline) }),
      ...(optionalNumber(metricCurrent) === undefined ? {} : { current: optionalNumber(metricCurrent) }),
      ...(structure?.metricJson?.direction ? { direction: structure.metricJson.direction } : {})
    } : null;
    void onSave({
      properties_json: nextProperties,
      metric_json: metric,
      horizon_at: hasHorizon && horizon ? new Date(`${horizon}T00:00:00.000Z`).toISOString() : null
    });
  }

  return (
    <form className="studio-structure-form" aria-label="Detalhes da meta" onSubmit={(event) => { event.preventDefault(); save(); }}>
      {structure ? (
        <div className="studio-structure-summary" aria-label="Acompanhamento da meta">
          {structure.metricJson ? <strong>{formatMetric(structure.metricJson)}</strong> : null}
          {!structure.metricJson && textListProperty(properties, "progress_evidence").length
            ? <span>Última evidência: {textListProperty(properties, "progress_evidence").at(-1)}</span>
            : null}
          {!structure.metricJson && !textListProperty(properties, "progress_evidence").length
            ? <span>Sem indicador. O avanço pode ser registrado por evidências.</span>
            : null}
        </div>
      ) : null}

      {!titleReady ? <p className="studio-structure-form__guidance" role="status">Dê um título ao documento para reconhecer esta meta depois.</p> : null}
      <label>
        <span>Resultado desejado</span>
        <textarea aria-label="Resultado desejado" value={desiredOutcome} onChange={(event) => setDesiredOutcome(event.currentTarget.value)} rows={3} required />
      </label>

      <div className="studio-structure-form__optional-actions" aria-label="Campos opcionais da meta">
        {!hasMetric ? <button type="button" onClick={() => setHasMetric(true)}>Adicionar indicador</button> : null}
        {!hasHorizon ? <button type="button" onClick={() => setHasHorizon(true)}>Adicionar horizonte</button> : null}
      </div>

      {hasMetric ? (
        <fieldset className="studio-structure-fieldset">
          <legend>Indicador</legend>
          <div className="studio-structure-form__field-grid">
            <label><span>Nome do indicador</span><input aria-label="Nome do indicador" value={metricLabel} onChange={(event) => setMetricLabel(event.currentTarget.value)} required /></label>
            <label><span>Alvo</span><input aria-label="Alvo" type="number" step="any" value={metricTarget} onChange={(event) => setMetricTarget(event.currentTarget.value)} required /></label>
            <label><span>Valor atual</span><input aria-label="Valor atual" type="number" step="any" value={metricCurrent} onChange={(event) => setMetricCurrent(event.currentTarget.value)} /></label>
            <label><span>Valor inicial</span><input aria-label="Valor inicial" type="number" step="any" value={metricBaseline} onChange={(event) => setMetricBaseline(event.currentTarget.value)} /></label>
            <label><span>Unidade</span><input aria-label="Unidade" value={metricUnit} onChange={(event) => setMetricUnit(event.currentTarget.value)} placeholder="clientes, R$, pontos" /></label>
          </div>
          <button className="studio-structure-form__remove" type="button" onClick={() => setHasMetric(false)}>Remover indicador</button>
        </fieldset>
      ) : null}

      {hasHorizon ? (
        <div className="studio-structure-form__inline-field">
          <label><span>Horizonte da meta</span><input aria-label="Horizonte da meta" type="date" value={horizon} onChange={(event) => setHorizon(event.currentTarget.value)} /></label>
          <button className="studio-structure-form__remove" type="button" onClick={() => setHasHorizon(false)}>Remover horizonte</button>
        </div>
      ) : null}

      {structure ? (
        <details className="studio-structure-form__more">
          <summary>Contexto e evidências</summary>
          <label><span>Por que isso importa?</span><textarea value={reason} onChange={(event) => setReason(event.currentTarget.value)} rows={2} /></label>
          <label><span>Estado</span><select value={state} onChange={(event) => setState(event.currentTarget.value)}><option value="">Sem estado</option><option value="in_focus">Em foco</option><option value="waiting">Em espera</option><option value="achieved">Alcançada</option></select></label>
          <label><span>Evidências de avanço, uma por linha</span><textarea value={evidence} onChange={(event) => setEvidence(event.currentTarget.value)} rows={4} /></label>
        </details>
      ) : null}

      {error ? <p className="studio-structure-form__error" role="alert">{error}</p> : null}
      <footer><button className="primary" type="submit" disabled={!canSave}>{busy ? "Salvando…" : structure ? "Salvar meta" : "Criar meta"}</button></footer>
    </form>
  );
}
