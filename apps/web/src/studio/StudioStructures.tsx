import { useEffect, useRef, useState } from "react";
import {
  createStudioStructure,
  listStudioStructures,
  StudioApiError,
  updateStudioStructure
} from "./studio-api";
import type { StudioStructure, StudioStructureKind } from "./studio.types";
import DecisionDetails, { type DecisionDetailsValue } from "./DecisionDetails";
import GoalDetails, { type GoalDetailsValue } from "./GoalDetails";
import PlanDetails, { type PlanDetailsValue } from "./PlanDetails";

type StudioStructuresProps = {
  documentId: string;
  documentTitle: string | null;
};

type SupportedKind = Exclude<StudioStructureKind, "ritual">;

const kindLabels: Record<SupportedKind, string> = {
  goal: "Meta",
  decision: "Decisão",
  plan: "Plano"
};

export default function StudioStructures({ documentId, documentTitle }: StudioStructuresProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [structures, setStructures] = useState<StudioStructure[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [open, setOpen] = useState(false);
  const [selectedKind, setSelectedKind] = useState<SupportedKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [needsReload, setNeedsReload] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState("loading");
    void loadDocumentStructures(documentId, controller.signal).then((active) => {
      if (controller.signal.aborted) return;
      setStructures(active);
      setSelectedKind((current) => current ?? active[0]?.kind as SupportedKind | null ?? null);
      setLoadState("ready");
      setNeedsReload(false);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadState("error");
    });
    return () => controller.abort();
  }, [documentId, reloadKey]);

  useEffect(() => {
    if (!open) return;
    headingRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const activeStructure = selectedKind
    ? structures.find((structure) => structure.kind === selectedKind) ?? null
    : null;
  const title = documentTitle?.trim() || "Pensamento sem título";
  const compactLabel = structures.length
    ? `${structures.map((structure) => kindLabels[structure.kind as SupportedKind]).join(", ")}: ${title}`
    : "Estruturar este pensamento";

  function close() {
    setOpen(false);
    setError(null);
    queueMicrotask(() => triggerRef.current?.focus());
  }

  async function saveGoal(value: GoalDetailsValue) {
    await save("goal", value);
  }

  async function saveDecision(value: DecisionDetailsValue) {
    await save("decision", { ...value, metric_json: null });
  }

  async function savePlan(value: PlanDetailsValue) {
    await save("plan", { ...value, horizon_at: null, metric_json: null });
  }

  async function save(kind: SupportedKind, value: {
    properties_json: Record<string, unknown>;
    horizon_at?: string | null;
    metric_json?: GoalDetailsValue["metric_json"];
  }) {
    setBusy(true);
    setError(null);
    try {
      const current = structures.find((structure) => structure.kind === kind);
      const saved = current
        ? await updateStudioStructure(current.id, {
            expected_revision: current.revision,
            horizon_at: value.horizon_at,
            metric_json: value.metric_json,
            properties_json: value.properties_json
          })
        : await createStudioStructure(documentId, {
            kind,
            horizon_at: value.horizon_at ?? null,
            metric_json: value.metric_json ?? null,
            properties_json: value.properties_json
          });
      setStructures((items) => {
        const found = items.some((item) => item.id === saved.id);
        return found ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved];
      });
      setSelectedKind(kind);
      setLoadState("ready");
    } catch (caught) {
      setError(structureErrorMessage(caught));
      if (caught instanceof StudioApiError && caught.code === "STUDIO_STRUCTURE_STALE") setNeedsReload(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="studio-structures" aria-label="Estrutura estratégica">
      <button
        className="studio-structure-badge"
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-controls="studio-structure-panel"
        aria-label={compactLabel}
        onClick={() => setOpen((current) => {
          if (!current && needsReload) setReloadKey((key) => key + 1);
          return !current;
        })}
      >
        <i aria-hidden="true" className={`ph-light ${structures.length ? "ph-compass" : "ph-plus"}`} />
        <span>{loadState === "loading" ? "Estrutura" : structures.length ? structures.map((structure) => kindLabels[structure.kind as SupportedKind]).join(" · ") : "Dar forma"}</span>
      </button>

      {open ? (
        <div id="studio-structure-panel" className="studio-structure-panel" role="region" aria-label="Detalhes estratégicos">
          <header>
            <div>
              <p className="mono">Estrutura opcional</p>
              <h3 ref={headingRef} tabIndex={-1}>{structures.length ? "Estrutura do pensamento" : "Dar forma ao pensamento"}</h3>
            </div>
            <button type="button" aria-label="Fechar detalhes estratégicos" onClick={close}><i aria-hidden="true" className="ph-light ph-x" /></button>
          </header>

          {loadState === "loading" ? <p className="studio-structure-panel__status" role="status">Buscando estruturas…</p> : null}
          {loadState === "error" ? (
            <div className="studio-structure-panel__status" role="alert">
              <p>Não foi possível buscar as estruturas agora. Sua escrita continua segura.</p>
              <button type="button" onClick={() => setReloadKey((key) => key + 1)}>Tentar novamente</button>
            </div>
          ) : null}

          {loadState === "ready" ? (
            <>
              <nav className="studio-structure-kinds" aria-label="Tipo de estrutura">
                {(Object.entries(kindLabels) as Array<[SupportedKind, string]>).map(([kind, label]) => {
                  const exists = structures.some((structure) => structure.kind === kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={selectedKind === kind}
                      onClick={() => { setSelectedKind(kind); setError(null); }}
                    >
                      {label}{exists ? <i aria-label="Já criada" className="ph-fill ph-check-circle" /> : null}
                    </button>
                  );
                })}
              </nav>
              {!selectedKind ? <p className="studio-structure-panel__invitation">Escolha apenas a forma que ajuda agora. O texto original continua livre.</p> : null}
              {selectedKind === "goal" ? <GoalDetails key={activeStructure?.id ?? "new-goal"} documentTitle={documentTitle} structure={activeStructure} busy={busy} error={error} onSave={saveGoal} /> : null}
              {selectedKind === "decision" ? <DecisionDetails key={activeStructure?.id ?? "new-decision"} structure={activeStructure} busy={busy} error={error} onSave={saveDecision} /> : null}
              {selectedKind === "plan" ? <PlanDetails key={activeStructure?.id ?? "new-plan"} structure={activeStructure} busy={busy} error={error} onSave={savePlan} /> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

async function loadDocumentStructures(documentId: string, signal: AbortSignal) {
  const structures: StudioStructure[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await listStudioStructures({ lifecycle_status: "active", limit: 100, cursor }, fetch, signal);
    for (const structure of page.items) {
      if (structure.documentId === documentId && structure.kind !== "ritual") structures.push(structure);
    }
    if (structures.length === Object.keys(kindLabels).length || !page.nextCursor) break;
    if (seenCursors.has(page.nextCursor)) throw new Error("STUDIO_STRUCTURE_CURSOR_LOOP");
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (!signal.aborted);
  return structures;
}

function structureErrorMessage(error: unknown) {
  if (error instanceof StudioApiError && error.code === "STUDIO_STRUCTURE_STALE") {
    return "Esta estrutura mudou em outra aba. Feche e abra os detalhes para carregar a versão mais recente.";
  }
  if (error instanceof StudioApiError && error.code === "STUDIO_STRUCTURE_EXISTS") {
    return "Este pensamento já possui uma estrutura deste tipo.";
  }
  return "Não foi possível salvar a estrutura agora. O documento original não foi alterado.";
}
