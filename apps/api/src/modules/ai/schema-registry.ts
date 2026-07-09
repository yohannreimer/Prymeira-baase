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

export const schemaRegistry = {
  onboarding_setup_suggestion: onboardingSetupSuggestionSchema,
  onboarding_diagnosis: onboardingDiagnosisSchema,
  process_draft: processDraftSchema,
  routine_draft: routineDraftSchema,
  training_draft: trainingDraftSchema,
  announcement_draft: announcementDraftSchema
};

export type AiSchemaKey = keyof typeof schemaRegistry;

export function getAiSchema(key: AiSchemaKey) {
  return schemaRegistry[key];
}
