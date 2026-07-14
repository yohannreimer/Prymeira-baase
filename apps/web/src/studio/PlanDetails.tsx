import { useEffect, useState } from "react";
import { STUDIO_STRUCTURE_CONTRACT } from "@prymeira/baase-shared";
import type { StudioStructure } from "./studio.types";

const PLAN_FIELDS = STUDIO_STRUCTURE_CONTRACT.plan.properties;

export type PlanDetailsValue = { properties_json: Record<string, unknown> };

type PlanDetailsProps = {
  structure?: StudioStructure | null;
  busy?: boolean;
  error?: string | null;
  onSave(value: PlanDetailsValue): void | Promise<void>;
};

function text(properties: Record<string, unknown>, key: string) {
  return typeof properties[key] === "string" ? properties[key] : "";
}

function list(properties: Record<string, unknown>, key: string) {
  const value = properties[key];
  const items = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return items.length ? items : [""];
}

export default function PlanDetails({ structure = null, busy = false, error, onSave }: PlanDetailsProps) {
  const properties = structure?.propertiesJson ?? {};
  const [direction, setDirection] = useState(() => text(properties, PLAN_FIELDS.direction.key));
  const [fronts, setFronts] = useState(() => list(properties, PLAN_FIELDS.fronts.key));
  const [milestones, setMilestones] = useState(() => list(properties, PLAN_FIELDS.milestones.key));

  useEffect(() => {
    const next = structure?.propertiesJson ?? {};
    setDirection(text(next, PLAN_FIELDS.direction.key));
    setFronts(list(next, PLAN_FIELDS.fronts.key));
    setMilestones(list(next, PLAN_FIELDS.milestones.key));
  }, [structure]);

  function save() {
    if (!direction.trim() || busy) return;
    const nextProperties: Record<string, unknown> = { ...properties, [PLAN_FIELDS.direction.key]: direction.trim() };
    const nextFronts = fronts.map((item) => item.trim()).filter(Boolean);
    const nextMilestones = milestones.map((item) => item.trim()).filter(Boolean);
    if (nextFronts.length) nextProperties[PLAN_FIELDS.fronts.key] = nextFronts; else delete nextProperties[PLAN_FIELDS.fronts.key];
    if (nextMilestones.length) nextProperties[PLAN_FIELDS.milestones.key] = nextMilestones; else delete nextProperties[PLAN_FIELDS.milestones.key];
    void onSave({ properties_json: nextProperties });
  }

  return (
    <form className="studio-structure-form" aria-label="Detalhes do plano" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <label><span>{PLAN_FIELDS.direction.label}</span><textarea aria-label={PLAN_FIELDS.direction.label} value={direction} onChange={(event) => setDirection(event.currentTarget.value)} rows={3} required /></label>
      <StructureList label="Frente" legend={PLAN_FIELDS.fronts.label} items={fronts} onChange={setFronts} addLabel="Adicionar frente" />
      <StructureList label="Marco" legend={PLAN_FIELDS.milestones.label} items={milestones} onChange={setMilestones} addLabel="Adicionar marco" />
      <p className="studio-structure-form__guidance">Frentes e marcos orientam o caminho. Só viram execução operacional após uma confirmação separada.</p>
      {error ? <p className="studio-structure-form__error" role="alert">{error}</p> : null}
      <footer><button className="primary" type="submit" disabled={!direction.trim() || busy}>{busy ? "Salvando…" : structure ? "Salvar plano" : "Criar plano"}</button></footer>
    </form>
  );
}

function StructureList({ label, legend, items, onChange, addLabel }: {
  label: string;
  legend: string;
  items: string[];
  onChange(items: string[]): void;
  addLabel: string;
}) {
  return (
    <fieldset className="studio-structure-fieldset studio-structure-list">
      <legend>{legend}</legend>
      {items.map((item, index) => (
        <div key={`${label}-${index}`}>
          <label><span>{label} {index + 1}</span><input aria-label={`${label} ${index + 1}`} value={item} onChange={(event) => onChange(items.map((current, itemIndex) => itemIndex === index ? event.currentTarget.value : current))} /></label>
          {items.length > 1 ? <button type="button" aria-label={`Remover ${label.toLocaleLowerCase("pt-BR")} ${index + 1}`} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}><i aria-hidden="true" className="ph-light ph-x" /></button> : null}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, ""])}>{addLabel}</button>
    </fieldset>
  );
}
