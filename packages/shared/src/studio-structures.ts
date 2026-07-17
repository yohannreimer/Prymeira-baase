type StudioField<Key extends string> = Readonly<{ key: Key; label: string }>;

function field<Key extends string>(key: Key, label: string): StudioField<Key> {
  return Object.freeze({ key, label });
}

export const STUDIO_RITUAL_SUPPORT_MODES = Object.freeze([
  "record_only",
  "light_summary",
  "guided_reflection"
] as const);

export type StudioRitualSupportMode = typeof STUDIO_RITUAL_SUPPORT_MODES[number];

/**
 * Shared strategic vocabulary. Keys are the persisted API contract; labels are
 * the calm product language used by every Studio surface.
 */
export const STUDIO_STRUCTURE_CONTRACT = Object.freeze({
  goal: Object.freeze({
    label: "Meta",
    properties: Object.freeze({
      desiredOutcome: field("desired_outcome", "Resultado desejado"),
      reason: field("reason", "Por que isso importa?"),
      state: field("state", "Estado"),
      progressEvidence: field("progress_evidence", "Evidências de avanço, uma por linha")
    }),
    metric: Object.freeze({
      label: field("label", "Nome do indicador"),
      target: field("target", "Alvo"),
      current: field("current", "Valor atual"),
      baseline: field("baseline", "Valor inicial"),
      unit: field("unit", "Unidade"),
      direction: field("direction", "Direção")
    })
  }),
  decision: Object.freeze({
    label: "Decisão",
    properties: Object.freeze({
      decision: field("decision", "Decisão tomada"),
      context: field("context", "Contexto original"),
      alternatives: field("alternatives", "Alternativas consideradas"),
      reason: field("reason", "Motivo"),
      hypothesisOrRisk: field("hypothesis_or_risk", "Hipótese ou risco"),
      learnings: field("learnings", "Efeitos e aprendizados"),
      decisionDate: field("decision_date", "Data da decisão"),
      reviewDate: field("review_date", "Revisar em")
    })
  }),
  plan: Object.freeze({
    label: "Plano",
    properties: Object.freeze({
      direction: field("direction", "Direção do plano"),
      hypotheses: field("hypotheses", "Hipóteses"),
      fronts: field("fronts", "Frentes"),
      milestones: field("milestones", "Marcos")
    })
  }),
  ritual: Object.freeze({
    label: "Ritual",
    properties: Object.freeze({
      intention: field("intention", "Intenção"),
      guideQuestions: field("guide_questions", "Perguntas guia"),
      supportMode: field("support_mode", "Apoio da IA"),
      allowedInternalSources: field("allowed_internal_sources", "Fontes internas autorizadas"),
      allowExternalResearch: field("allow_external_research", "Permitir pesquisa externa"),
      summaryFormat: field("summary_format", "Formato da síntese")
    })
  })
} as const);

export type StudioStructureKind = keyof typeof STUDIO_STRUCTURE_CONTRACT;

export const STUDIO_STRUCTURE_KIND_ORDER = Object.freeze([
  "goal", "decision", "plan", "ritual"
] as const satisfies readonly StudioStructureKind[]);
