import { z } from "zod";

const evidencePolicySchema = z.enum(["optional", "photo_required", "comment_required", "photo_or_comment_required"]);
const approvalModeSchema = z.enum(["direct", "approval_required"]);
const frequencySchema = z.enum(["daily", "weekly", "monthly", "on_demand"]);
const processSopStepSchema = z.object({
  title: z.string().min(1),
  instruction: z.string().min(1),
  expectedResult: z.string().min(1),
  attentionPoints: z.array(z.string().min(1)).max(3)
});

const suggestionMetadataSchema = z.object({
  reason: z.string().min(1),
  basedOn: z.array(z.string().min(1)),
  expectedImpact: z.string().min(1),
  source: z.enum(["user_provided", "inferred", "template", "placeholder"]),
  reviewDefault: z.enum(["create", "draft", "publish", "activate"])
});

function addUniqueIdIssues(
  context: z.RefinementCtx,
  listName: string,
  items: Array<{ id: string }>
) {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      context.addIssue({
        code: "custom",
        message: `${listName} ids must be unique`,
        path: [listName, index, "id"]
      });
    }
    seen.add(item.id);
  });
}

function addAreaReferenceIssue(context: z.RefinementCtx, path: Array<string | number>, areaName: string) {
  context.addIssue({
    code: "custom",
    message: `areaName must reference an existing area: ${areaName}`,
    path
  });
}

function addRoleReferenceIssue(context: z.RefinementCtx, path: Array<string | number>, roleName: string) {
  context.addIssue({
    code: "custom",
    message: `roleName must reference an existing role: ${roleName}`,
    path
  });
}

export const onboardingSetupSuggestionSchema = z.object({
  companyName: z.string().min(1),
  segment: z.string().min(1),
  confidence: z.enum(["low", "medium", "high"]),
  assumptions: z.array(z.string()),
  gaps: z.array(z.object({
    title: z.string().min(1),
    reason: z.string().min(1),
    suggestedQuestion: z.string().min(1)
  })),
  areas: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable(),
    metadata: suggestionMetadataSchema
  })).min(1).max(6),
  roles: z.array(z.object({
    id: z.string().min(1),
    areaName: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable(),
    metadata: suggestionMetadataSchema
  })).max(12),
  people: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    email: z.string().nullable(),
    role: z.enum(["owner", "manager", "employee"]),
    areaName: z.string().nullable(),
    roleName: z.string().nullable(),
    placeholder: z.boolean(),
    metadata: suggestionMetadataSchema
  })).max(12),
  processes: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    objective: z.string().min(1),
    trigger: z.string().min(1),
    operationalRule: z.string().min(1).nullable(),
    steps: z.array(processSopStepSchema).min(3).max(12),
    areaName: z.string().nullable(),
    metadata: suggestionMetadataSchema
  })).max(5),
  routines: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    areaName: z.string().nullable(),
    frequency: frequencySchema,
    taskTitles: z.array(z.string().min(1)).min(1),
    metadata: suggestionMetadataSchema
  })).max(5),
  trainings: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    materialBody: z.string().min(1),
    quizPrompt: z.string().min(1),
    metadata: suggestionMetadataSchema
  })).max(4),
  announcement: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    body: z.string().min(1),
    metadata: suggestionMetadataSchema
  }).nullable().optional(),
  activationPlan: z.array(z.object({
    day: z.number().int().min(1).max(7),
    title: z.string().min(1),
    objective: z.string().min(1),
    action: z.enum([
      "open_company_map",
      "review_processes",
      "activate_routine",
      "publish_training",
      "invite_team",
      "review_today",
      "review_dashboard"
    ])
  })).length(7).superRefine((steps, context) => {
    const days = new Set(steps.map((step) => step.day));
    for (let day = 1; day <= 7; day += 1) {
      if (!days.has(day)) {
        context.addIssue({
          code: "custom",
          message: "activationPlan must include each day from 1 to 7 exactly once",
          path: ["day"]
        });
        return;
      }
    }
  })
}).superRefine((suggestion, context) => {
  addUniqueIdIssues(context, "areas", suggestion.areas);
  addUniqueIdIssues(context, "roles", suggestion.roles);
  addUniqueIdIssues(context, "people", suggestion.people);
  addUniqueIdIssues(context, "processes", suggestion.processes);
  addUniqueIdIssues(context, "routines", suggestion.routines);
  addUniqueIdIssues(context, "trainings", suggestion.trainings);

  const areaNames = new Set(suggestion.areas.map((area) => area.name));
  const rolesByName = new Map<string, typeof suggestion.roles>();

  suggestion.roles.forEach((role, index) => {
    if (!areaNames.has(role.areaName)) addAreaReferenceIssue(context, ["roles", index, "areaName"], role.areaName);
    rolesByName.set(role.name, [...(rolesByName.get(role.name) ?? []), role]);
  });

  suggestion.people.forEach((person, index) => {
    if (person.areaName && !areaNames.has(person.areaName)) {
      addAreaReferenceIssue(context, ["people", index, "areaName"], person.areaName);
    }

    if (person.roleName) {
      const matchingRoles = rolesByName.get(person.roleName) ?? [];
      if (matchingRoles.length === 0) {
        addRoleReferenceIssue(context, ["people", index, "roleName"], person.roleName);
      } else if (!person.areaName && matchingRoles.length > 1) {
        context.addIssue({
          code: "custom",
          message: "areaName is required when roleName matches multiple roles",
          path: ["people", index, "areaName"]
        });
      } else if (person.areaName && !matchingRoles.some((role) => role.areaName === person.areaName)) {
        context.addIssue({
          code: "custom",
          message: "roleName must belong to person.areaName when both are set",
          path: ["people", index, "roleName"]
        });
      }
    }
  });

  suggestion.processes.forEach((process, index) => {
    if (process.areaName && !areaNames.has(process.areaName)) {
      addAreaReferenceIssue(context, ["processes", index, "areaName"], process.areaName);
    }
  });

  suggestion.routines.forEach((routine, index) => {
    if (routine.areaName && !areaNames.has(routine.areaName)) {
      addAreaReferenceIssue(context, ["routines", index, "areaName"], routine.areaName);
    }
  });
});

export const onboardingDiagnosisSchema = z.object({
  companyName: z.string().min(1),
  normalizedSegment: z.string().min(1),
  confidence: z.enum(["low", "medium", "high"]),
  operationalSummary: z.string().min(1),
  businessModel: z.string().nullable(),
  customerProfile: z.string().nullable(),
  deliveryModel: z.string().nullable(),
  detectedAreas: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    source: z.enum(["user_provided", "inferred", "template"]),
    reason: z.string().min(1)
  })),
  detectedPeople: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    roleHint: z.string().nullable(),
    areaName: z.string().nullable(),
    source: z.enum(["user_provided", "inferred", "placeholder"])
  })),
  bottlenecks: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    severity: z.enum(["low", "medium", "high"]),
    source: z.enum(["user_provided", "inferred"])
  })),
  assumptions: z.array(z.string()),
  followupQuestions: z.array(z.object({
    id: z.string().min(1),
    question: z.string().min(1),
    reason: z.string().min(1),
    expectedUse: z.enum(["areas", "people", "processes", "routines", "trainings", "approval_evidence"]),
    priority: z.number().int().min(1)
  })).max(3)
});

export const processDraftSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  objective: z.string().min(1),
  trigger: z.string().min(1),
  operationalRule: z.string().min(1).nullable(),
  areaName: z.string().nullable(),
  roleName: z.string().nullable(),
  steps: z.array(processSopStepSchema).min(3).max(12),
  assumptions: z.array(z.string()),
  gaps: z.array(z.string())
});

export const routineDraftSchema = z.object({
  title: z.string().min(1),
  frequency: frequencySchema,
  areaName: z.string().nullable(),
  roleName: z.string().nullable(),
  tasks: z.array(z.object({
    title: z.string().min(1),
    dueHint: z.string().nullable(),
    evidencePolicy: evidencePolicySchema,
    approvalMode: approvalModeSchema
  })).min(1),
  linkedProcessTitle: z.string().nullable(),
  assumptions: z.array(z.string()),
  gaps: z.array(z.string())
});

export const trainingDraftSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  targetAreaName: z.string().nullable(),
  targetRoleName: z.string().nullable(),
  lesson: z.object({
    title: z.string().min(1),
    body: z.string().min(1)
  }),
  quiz: z.array(z.object({
    prompt: z.string().min(1),
    options: z.array(z.object({
      id: z.string().min(1),
      label: z.string().min(1)
    })).min(2),
    correctOptionId: z.string().min(1),
    explanation: z.string().min(1)
  })).min(1),
  assumptions: z.array(z.string()),
  gaps: z.array(z.string())
});

export const announcementDraftSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  type: z.enum(["simple", "process_change", "mandatory_training"]),
  requirement: z.enum(["none", "read_confirmation", "quiz_confirmation"]),
  audience: z.discriminatedUnion("type", [
    z.object({ type: z.literal("all") }),
    z.object({ type: z.literal("area"), areaId: z.string().min(1) }),
    z.object({ type: z.literal("role"), roleTemplateId: z.string().min(1) }),
    z.object({ type: z.literal("person"), profileId: z.string().min(1) })
  ]),
  quiz: z.array(z.object({
    prompt: z.string().min(1),
    options: z.array(z.object({
      id: z.string().min(1),
      label: z.string().min(1)
    })).min(2),
    correctOptionId: z.string().min(1),
    explanation: z.string().nullable()
  })),
  assumptions: z.array(z.string()),
  gaps: z.array(z.string())
});

const studioIdSchema = z.string().trim().min(1).max(160);
const studioShortTextSchema = z.string().trim().min(1).max(240);
const studioMediumTextSchema = z.string().trim().min(1).max(2_000);
const studioIsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  try {
    return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}, "Invalid ISO date");

export const studioCitationSchema = z.object({
  source_type: z.enum([
    "studio_document",
    "studio_asset",
    "operational_resource",
    "operational_metric",
    "external_url"
  ]),
  source_id: studioIdSchema.nullable(),
  url: z.string().url().max(2_048).nullable(),
  label: z.string().trim().min(1).max(160),
  excerpt: z.string().max(800),
  observed_at: z.string().datetime({ offset: true }),
  period_from: studioIsoDateSchema.nullable(),
  period_to: studioIsoDateSchema.nullable()
}).strict().superRefine((citation, context) => {
  const isExternal = citation.source_type === "external_url";
  if (citation.url) {
    const parsedUrl = new URL(citation.url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      context.addIssue({
        code: "custom",
        message: "citation urls must use http or https",
        path: ["url"]
      });
    }
    if (parsedUrl.username || parsedUrl.password) {
      context.addIssue({
        code: "custom",
        message: "citation urls must not contain credentials",
        path: ["url"]
      });
    }
  }
  if (isExternal && (!citation.url || citation.source_id !== null)) {
    context.addIssue({
      code: "custom",
      message: "external_url citations require url and no source_id",
      path: [citation.url ? "source_id" : "url"]
    });
  }
  if (!isExternal && (!citation.source_id || citation.url !== null)) {
    context.addIssue({
      code: "custom",
      message: "internal citations require source_id and no url",
      path: [citation.source_id ? "url" : "source_id"]
    });
  }
  if ((citation.period_from === null) !== (citation.period_to === null)) {
    context.addIssue({
      code: "custom",
      message: "citation periods require both period_from and period_to",
      path: [citation.period_from === null ? "period_from" : "period_to"]
    });
  }
  if (citation.period_from && citation.period_to && citation.period_from > citation.period_to) {
    context.addIssue({
      code: "custom",
      message: "period_from must not be after period_to",
      path: ["period_to"]
    });
  }
});

const studioFactSchema = z.object({
  statement: studioMediumTextSchema,
  citation_indexes: z.array(z.number().int().min(0).max(29)).min(1).max(10)
}).strict();

const studioInferenceSchema = z.object({
  statement: studioMediumTextSchema,
  basis: studioMediumTextSchema,
  confidence: z.enum(["low", "medium", "high"])
}).strict();

const studioGapSchema = z.object({
  question: studioShortTextSchema,
  reason: studioMediumTextSchema
}).strict();

const studioProposalEnvelopeShape = {
  facts: z.array(studioFactSchema).max(40),
  inferences: z.array(studioInferenceSchema).max(40),
  gaps: z.array(studioGapSchema).max(30),
  citations: z.array(studioCitationSchema).max(30)
};

function validateStudioEnvelope(
  value: { facts: Array<{ citation_indexes: number[] }>; citations: unknown[] },
  context: z.RefinementCtx
) {
  value.facts.forEach((fact, factIndex) => {
    fact.citation_indexes.forEach((citationIndex, indexIndex) => {
      if (citationIndex >= value.citations.length) {
        context.addIssue({
          code: "custom",
          message: "fact citation index is out of range",
          path: ["facts", factIndex, "citation_indexes", indexIndex]
        });
      }
    });
  });
}

export const studioOrganizeSchema = z.object({
  ...studioProposalEnvelopeShape,
  proposal: z.object({
    document_id: studioIdSchema.nullable(),
    suggested_title: z.string().trim().min(1).max(180),
    summary: studioMediumTextSchema,
    collection_names: z.array(z.string().trim().min(1).max(120)).max(12),
    related_document_ids: z.array(studioIdSchema).max(20),
    inbox_state: z.enum(["pending_review", "reviewed"])
  }).strict()
}).strict().superRefine(validateStudioEnvelope);

export const studioStrategicReviewSchema = z.object({
  ...studioProposalEnvelopeShape,
  proposal: z.object({
    title: z.string().trim().min(1).max(180),
    objective: studioMediumTextSchema,
    period_from: studioIsoDateSchema.nullable(),
    period_to: studioIsoDateSchema.nullable(),
    priorities: z.array(z.object({
      title: studioShortTextSchema,
      rationale: studioMediumTextSchema,
      expected_outcome: studioMediumTextSchema
    }).strict()).max(12),
    milestones: z.array(z.object({
      title: studioShortTextSchema,
      target_date: studioIsoDateSchema.nullable(),
      success_criteria: studioMediumTextSchema
    }).strict()).max(24),
    risks: z.array(z.object({
      description: studioMediumTextSchema,
      mitigation: studioMediumTextSchema
    }).strict()).max(16),
    next_steps: z.array(z.object({
      title: studioShortTextSchema,
      owner_hint: z.string().trim().max(160).nullable(),
      due_date: studioIsoDateSchema.nullable()
    }).strict()).max(24)
  }).strict().superRefine((proposal, context) => {
    if ((proposal.period_from === null) !== (proposal.period_to === null)) {
      context.addIssue({
        code: "custom",
        message: "strategic periods require both period_from and period_to",
        path: [proposal.period_from === null ? "period_from" : "period_to"]
      });
    }
    if (proposal.period_from && proposal.period_to && proposal.period_from > proposal.period_to) {
      context.addIssue({ code: "custom", message: "period_from must not be after period_to", path: ["period_to"] });
    }
  })
}).strict().superRefine(validateStudioEnvelope);

export const studioRitualPrepareSchema = z.object({
  ...studioProposalEnvelopeShape,
  proposal: z.object({
    ritual_id: studioIdSchema,
    title: z.string().trim().min(1).max(180),
    intent: studioMediumTextSchema,
    agenda: z.array(z.object({
      prompt: studioMediumTextSchema,
      purpose: studioMediumTextSchema
    }).strict()).min(1).max(20),
    preparation_notes: z.array(studioMediumTextSchema).max(20),
    suggested_duration_minutes: z.number().int().min(5).max(240)
  }).strict()
}).strict().superRefine(validateStudioEnvelope);

const studioTaskOperationSchema = z.object({
  resource_type: z.literal("task"),
  title: z.string().trim().min(1).max(160),
  area_id: studioIdSchema.nullable(),
  assignee_profile_id: studioIdSchema.nullable(),
  due_date: studioIsoDateSchema,
  due_hint: z.string().trim().max(80).nullable(),
  approval_mode: approvalModeSchema,
  evidence_policy: evidencePolicySchema,
  checklist_items: z.array(z.string().trim().min(1).max(180)).max(100)
}).strict();

const studioRoutineOperationSchema = z.object({
  resource_type: z.literal("routine"),
  title: z.string().trim().min(1).max(140),
  area_id: studioIdSchema.nullable(),
  frequency: frequencySchema,
  weekdays: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).max(7),
  due_hint: z.string().trim().max(80).nullable(),
  assignee_profile_ids: z.array(studioIdSchema).max(50),
  execution_mode: z.enum(["shared", "individual"]),
  approval_mode: approvalModeSchema,
  evidence_policy: evidencePolicySchema,
  task_templates: z.array(z.object({
    title: z.string().trim().min(1).max(140),
    process_id: studioIdSchema.nullable(),
    assignee_profile_id: studioIdSchema.nullable(),
    due_hint: z.string().trim().max(80).nullable(),
    approval_mode: approvalModeSchema,
    evidence_policy: evidencePolicySchema
  }).strict()).min(1).max(50)
}).strict();

const studioProcessOperationSchema = z.object({
  resource_type: z.literal("process"),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(30_000),
  area_id: studioIdSchema.nullable(),
  summary: z.string().trim().max(2_000).nullable(),
  owner_profile_id: studioIdSchema.nullable()
}).strict();

const studioAnnouncementAudienceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }).strict(),
  z.object({ type: z.literal("area"), area_id: studioIdSchema }).strict(),
  z.object({ type: z.literal("role"), role_template_id: studioIdSchema }).strict(),
  z.object({ type: z.literal("person"), profile_id: studioIdSchema }).strict()
]);

const studioAnnouncementOperationSchema = z.object({
  resource_type: z.literal("announcement"),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(20_000),
  announcement_type: z.enum(["simple", "process_change", "mandatory_training"]),
  requirement: z.enum(["none", "read_confirmation", "quiz_confirmation"]),
  audience: studioAnnouncementAudienceSchema,
  related_process_id: studioIdSchema.nullable(),
  related_training_id: studioIdSchema.nullable(),
  quiz_questions: z.array(z.object({
    prompt: z.string().trim().min(1).max(240),
    options: z.array(z.object({
      id: studioIdSchema,
      label: z.string().trim().min(1).max(160)
    }).strict()).min(2).max(8),
    correct_option_id: studioIdSchema,
    explanation: z.string().trim().max(1_000).nullable()
  }).strict()).max(20)
}).strict();

export const studioOperationalDraftSchema = z.object({
  ...studioProposalEnvelopeShape,
  proposal: z.discriminatedUnion("resource_type", [
    studioTaskOperationSchema,
    studioRoutineOperationSchema,
    studioProcessOperationSchema,
    studioAnnouncementOperationSchema
  ])
}).strict().superRefine((value, context) => {
  validateStudioEnvelope(value, context);
  const proposal = value.proposal;
  if (proposal.resource_type === "routine") {
    const uniqueWeekdays = new Set(proposal.weekdays);
    if (uniqueWeekdays.size !== proposal.weekdays.length) {
      context.addIssue({ code: "custom", message: "weekdays must be unique", path: ["proposal", "weekdays"] });
    }
    if (proposal.frequency === "weekly" && proposal.weekdays.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "weekly routines require exactly one weekday",
        path: ["proposal", "weekdays"]
      });
    }
    if (new Set(proposal.assignee_profile_ids).size !== proposal.assignee_profile_ids.length) {
      context.addIssue({
        code: "custom",
        message: "assignee_profile_ids must be unique",
        path: ["proposal", "assignee_profile_ids"]
      });
    }
  }
  if (proposal.resource_type === "announcement") {
    if (proposal.requirement === "quiz_confirmation" && proposal.quiz_questions.length === 0) {
      context.addIssue({
        code: "custom",
        message: "quiz_confirmation requires quiz_questions",
        path: ["proposal", "quiz_questions"]
      });
    }
    proposal.quiz_questions.forEach((question, questionIndex) => {
      const optionIds = question.options.map((option) => option.id);
      if (new Set(optionIds).size !== optionIds.length) {
        context.addIssue({
          code: "custom",
          message: "quiz option ids must be unique",
          path: ["proposal", "quiz_questions", questionIndex, "options"]
        });
      }
      if (!optionIds.includes(question.correct_option_id)) {
        context.addIssue({
          code: "custom",
          message: "correct_option_id must reference an option",
          path: ["proposal", "quiz_questions", questionIndex, "correct_option_id"]
        });
      }
    });
  }
});

export const schemaRegistry = {
  onboarding_setup_suggestion: onboardingSetupSuggestionSchema,
  onboarding_diagnosis: onboardingDiagnosisSchema,
  process_draft: processDraftSchema,
  routine_draft: routineDraftSchema,
  training_draft: trainingDraftSchema,
  announcement_draft: announcementDraftSchema,
  studio_organize: studioOrganizeSchema,
  studio_strategic_review: studioStrategicReviewSchema,
  studio_ritual_prepare: studioRitualPrepareSchema,
  studio_operational_draft: studioOperationalDraftSchema
};

export type AiSchemaKey = keyof typeof schemaRegistry;

export function getAiSchema(key: AiSchemaKey) {
  return schemaRegistry[key];
}
