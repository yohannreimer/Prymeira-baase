# Onboarding Inteligente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first-run intelligent onboarding that turns a new owner workspace into a reviewed operational company base with areas, roles, people, drafts, activation plan, and a premium full-screen experience.

**Architecture:** Add a persisted onboarding session domain to the API, split AI onboarding into diagnosis and final setup generation, then replace the current internal onboarding page with a gated full-screen onboarding shell for empty owner workspaces. The final completion route applies review decisions and creates real company data while keeping operational content as drafts by default.

**Tech Stack:** Fastify, Zod, TypeScript, JSONB Postgres record store, Vitest, React 19, Vite, Testing Library, existing Baase AI Harness, OpenAI structured outputs, Deepgram transcription.

---

## Scope Check

The design touches backend persistence, AI schemas/prompts, API routes, frontend onboarding UX, and final object creation. These pieces are coupled by one user-visible flow, so this plan keeps them together but implements them in small testable tasks. Each task can be verified independently.

Current workspace note: `/Volumes/SanDiskSSD/Projetos/Locais/Prymeira/Baase` is not a git repository. The plan uses "Checkpoint" steps instead of mandatory `git commit` commands. If a git repository is initialized later, use each checkpoint as a commit boundary.

## File Structure

Create:

- `apps/api/src/modules/onboarding/onboarding.types.ts`  
  Shared onboarding session, diagnosis, generated suggestion, review decision, and repository types.

- `apps/api/src/modules/onboarding/in-memory-onboarding.repository.ts`  
  In-memory persistence for onboarding sessions used by tests and local dev.

- `apps/api/src/modules/onboarding/onboarding.service.ts`  
  Business logic for session lifecycle, diagnosis persistence, review decisions, and final completion.

- `apps/api/src/modules/onboarding/onboarding-session.routes.test.ts`  
  Route-level tests for the new onboarding session lifecycle.

- `apps/web/src/onboarding.tsx`  
  Full-screen onboarding UI components separated from the large `App.tsx`.

Modify:

- `apps/api/src/modules/onboarding/onboarding.routes.ts`  
  Keep the legacy `/onboarding/setup` route and add session routes.

- `apps/api/src/app.ts`  
  Wire `OnboardingRepository` and pass announcement/company/process/routine/training repositories into onboarding routes.

- `apps/api/src/db/postgres.ts`  
  Add Postgres onboarding repository to the JSONB record store bundle.

- `apps/api/src/modules/company/company.types.ts`  
  Allow `TeamMember.status` to include `placeholder`.

- `apps/api/src/modules/company/company.service.ts`  
  Allow onboarding-created placeholders through a dedicated input path.

- `apps/api/src/modules/ai/ai.types.ts`  
  Add `onboarding_diagnosis` to `AiTaskKind`.

- `apps/api/src/modules/ai/schema-registry.ts`  
  Add diagnosis schema and expand onboarding setup schema.

- `apps/api/src/modules/ai/prompt-registry.ts`  
  Add `agent/onboarding-diagnostician` and strengthen `agent/onboarding-architect`.

- `apps/api/src/modules/ai/ai.routes.ts`  
  Add diagnosis route support through session routes or helper function reuse.

- `apps/api/src/modules/ai/providers/mock-ai.provider.ts`  
  Return deterministic diagnosis and expanded setup suggestion.

- `apps/api/src/modules/ai/ai-registries.test.ts`  
  Test new schemas and prompt registry entries.

- `apps/api/src/modules/ai/ai.routes.test.ts`  
  Test AI diagnosis route behavior if exposed separately.

- `apps/web/src/api.ts`  
  Add onboarding session types and API helpers.

- `apps/web/src/api.test.ts`  
  Test new onboarding API helpers.

- `apps/web/src/App.tsx`  
  Gate first-run owner workspace, pass current app data into onboarding shell, and preserve existing internal routes.

- `apps/web/src/App.test.tsx`  
  Cover the new owner onboarding flow, skip flow, autosave, diagnosis, review, and completion.

- `apps/web/src/styles.css`  
  Add full-screen onboarding, premium generation, review wizard, drawer, mobile states.

---

## Task 1: Onboarding Session Domain Types And Repository

**Files:**
- Create: `apps/api/src/modules/onboarding/onboarding.types.ts`
- Create: `apps/api/src/modules/onboarding/in-memory-onboarding.repository.ts`
- Test: `apps/api/src/modules/onboarding/onboarding-session.routes.test.ts`

- [ ] **Step 1: Write the failing repository lifecycle test**

Add this test file with the first repository test:

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryOnboardingRepository } from "./in-memory-onboarding.repository";

describe("onboarding repository", () => {
  it("creates and updates the current onboarding session for a workspace", async () => {
    const repository = createInMemoryOnboardingRepository();

    const created = await repository.createSession({
      workspaceId: "workspace_a",
      ownerProfileId: "profile_owner",
      status: "in_progress",
      currentStep: "identity",
      companyName: null,
      segment: null,
      customSegment: null,
      normalizedSegment: null,
      teamSizeRange: null,
      goals: [],
      mainAnswers: [],
      attachments: [],
      diagnosis: null,
      followupQuestions: [],
      followupAnswers: [],
      generatedSuggestion: null,
      reviewDecisions: [],
      activationPlan: [],
      createdSetupSummary: null,
      aiRunIds: []
    });

    expect(created.id).toBe("onboarding_session_1");
    expect(created.status).toBe("in_progress");

    const updated = await repository.updateSession({
      ...created,
      companyName: "Estudio Norte",
      segment: "Outro",
      customSegment: "Agencia de conteudo",
      normalizedSegment: "Agencia de conteudo"
    });

    expect(updated.updatedAt).not.toBe(created.updatedAt);
    await expect(repository.getCurrentSession("workspace_a")).resolves.toMatchObject({
      id: created.id,
      companyName: "Estudio Norte",
      normalizedSegment: "Agencia de conteudo"
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @prymeira/baase-api test src/modules/onboarding/onboarding-session.routes.test.ts
```

Expected: fail with missing `./in-memory-onboarding.repository`.

- [ ] **Step 3: Add onboarding domain types**

Create `apps/api/src/modules/onboarding/onboarding.types.ts`:

```ts
export type OnboardingSessionStatus =
  | "not_started"
  | "in_progress"
  | "diagnosis_ready"
  | "followup"
  | "generating_setup"
  | "reviewing"
  | "completed"
  | "skipped";

export type OnboardingSource = "user_provided" | "inferred" | "template" | "placeholder";

export type OnboardingAnswer = {
  questionId: "operations_overview" | "people_responsibilities" | "bottlenecks_standards" | string;
  theme: "business_model" | "team_structure" | "operational_bottlenecks" | "followup" | string;
  question: string;
  answer: string;
  inputMode: "text" | "audio";
};

export type OnboardingAttachment = {
  id: string;
  name: string;
  mimeType: string;
  extractedText: string;
  size: number;
};

export type OnboardingDiagnosis = {
  companyName: string;
  normalizedSegment: string;
  confidence: "low" | "medium" | "high";
  operationalSummary: string;
  businessModel: string | null;
  customerProfile: string | null;
  deliveryModel: string | null;
  detectedAreas: Array<{
    id: string;
    name: string;
    description: string;
    source: Exclude<OnboardingSource, "placeholder">;
    reason: string;
  }>;
  detectedPeople: Array<{
    id: string;
    name: string;
    roleHint: string | null;
    areaName: string | null;
    source: "user_provided" | "inferred" | "placeholder";
  }>;
  bottlenecks: Array<{
    id: string;
    title: string;
    description: string;
    severity: "low" | "medium" | "high";
    source: "user_provided" | "inferred";
  }>;
  assumptions: string[];
  followupQuestions: OnboardingFollowupQuestion[];
};

export type OnboardingFollowupQuestion = {
  id: string;
  question: string;
  reason: string;
  expectedUse: "areas" | "people" | "processes" | "routines" | "trainings" | "approval_evidence";
  priority: number;
};

export type OnboardingSuggestionMetadata = {
  reason: string;
  basedOn: string[];
  expectedImpact: string;
  source: OnboardingSource;
  reviewDefault: "create" | "draft" | "publish" | "activate";
};

export type OnboardingSetupSuggestion = {
  companyName: string;
  segment: string;
  confidence: "low" | "medium" | "high";
  assumptions: string[];
  gaps: Array<{
    title: string;
    reason: string;
    suggestedQuestion: string;
  }>;
  areas: Array<{
    id: string;
    name: string;
    description: string | null;
    metadata: OnboardingSuggestionMetadata;
  }>;
  roles: Array<{
    id: string;
    areaName: string;
    name: string;
    description: string | null;
    metadata: OnboardingSuggestionMetadata;
  }>;
  people: Array<{
    id: string;
    name: string;
    email: string | null;
    role: "owner" | "manager" | "employee";
    areaName: string | null;
    roleName: string | null;
    placeholder: boolean;
    metadata: OnboardingSuggestionMetadata;
  }>;
  processes: Array<{
    id: string;
    title: string;
    summary: string;
    body: string;
    areaName: string | null;
    metadata: OnboardingSuggestionMetadata;
  }>;
  routines: Array<{
    id: string;
    title: string;
    areaName: string | null;
    frequency: "daily" | "weekly" | "monthly" | "on_demand";
    taskTitles: string[];
    metadata: OnboardingSuggestionMetadata;
  }>;
  trainings: Array<{
    id: string;
    title: string;
    description: string;
    materialBody: string;
    quizPrompt: string;
    metadata: OnboardingSuggestionMetadata;
  }>;
  announcement: {
    id: string;
    title: string;
    body: string;
    metadata: OnboardingSuggestionMetadata;
  } | null;
  activationPlan: OnboardingActivationStep[];
};

export type OnboardingReviewDecision = {
  itemType: "area" | "role" | "person" | "process" | "routine" | "training" | "announcement" | "invite";
  itemId: string;
  action: "create" | "remove" | "draft" | "publish" | "activate";
  editedPayload: Record<string, unknown> | null;
};

export type OnboardingActivationStep = {
  day: number;
  title: string;
  objective: string;
  action: "open_company_map" | "review_processes" | "activate_routine" | "publish_training" | "invite_team" | "review_today" | "review_dashboard";
};

export type OnboardingCreatedSetupSummary = {
  areas: number;
  roles: number;
  people: number;
  placeholders: number;
  processes: number;
  routines: number;
  trainings: number;
  announcements: number;
  invites: number;
};

export type OnboardingSession = {
  id: string;
  workspaceId: string;
  ownerProfileId: string;
  status: OnboardingSessionStatus;
  currentStep: string;
  companyName: string | null;
  segment: string | null;
  customSegment: string | null;
  normalizedSegment: string | null;
  teamSizeRange: string | null;
  goals: string[];
  mainAnswers: OnboardingAnswer[];
  attachments: OnboardingAttachment[];
  diagnosis: OnboardingDiagnosis | null;
  followupQuestions: OnboardingFollowupQuestion[];
  followupAnswers: OnboardingAnswer[];
  generatedSuggestion: OnboardingSetupSuggestion | null;
  reviewDecisions: OnboardingReviewDecision[];
  activationPlan: OnboardingActivationStep[];
  createdSetupSummary: OnboardingCreatedSetupSummary | null;
  aiRunIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type CreateOnboardingSessionInput = Omit<OnboardingSession, "id" | "createdAt" | "updatedAt" | "completedAt">;

export type OnboardingRepository = {
  getCurrentSession(workspaceId: string): Promise<OnboardingSession | null>;
  findSession(workspaceId: string, sessionId: string): Promise<OnboardingSession | null>;
  createSession(input: CreateOnboardingSessionInput): Promise<OnboardingSession>;
  updateSession(session: OnboardingSession): Promise<OnboardingSession>;
};
```

- [ ] **Step 4: Implement in-memory repository**

Create `apps/api/src/modules/onboarding/in-memory-onboarding.repository.ts`:

```ts
import type { CreateOnboardingSessionInput, OnboardingRepository, OnboardingSession } from "./onboarding.types";

function now() {
  return new Date().toISOString();
}

export function createInMemoryOnboardingRepository(): OnboardingRepository {
  const sessions: OnboardingSession[] = [];

  return {
    async getCurrentSession(workspaceId) {
      return sessions
        .filter((session) => session.workspaceId === workspaceId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
    },

    async findSession(workspaceId, sessionId) {
      return sessions.find((session) => session.workspaceId === workspaceId && session.id === sessionId) ?? null;
    },

    async createSession(input: CreateOnboardingSessionInput) {
      const timestamp = now();
      const session: OnboardingSession = {
        ...input,
        id: `onboarding_session_${sessions.length + 1}`,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null
      };
      sessions.push(session);
      return session;
    },

    async updateSession(session: OnboardingSession) {
      const index = sessions.findIndex((item) => item.workspaceId === session.workspaceId && item.id === session.id);
      if (index === -1) throw new Error("ONBOARDING_SESSION_NOT_FOUND");
      const updated = {
        ...session,
        updatedAt: now()
      };
      sessions[index] = updated;
      return updated;
    }
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
pnpm --filter @prymeira/baase-api test src/modules/onboarding/onboarding-session.routes.test.ts
```

Expected: pass.

- [ ] **Step 6: Checkpoint**

Run:

```bash
pnpm --filter @prymeira/baase-api typecheck
```

Expected: pass.

---

## Task 2: Session Routes, App Wiring, And Postgres Repository

**Files:**
- Modify: `apps/api/src/modules/onboarding/onboarding.routes.ts`
- Create: `apps/api/src/modules/onboarding/onboarding.service.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/db/postgres.ts`
- Test: `apps/api/src/modules/onboarding/onboarding-session.routes.test.ts`
- Test: `apps/api/src/db/postgres.repositories.test.ts`

- [ ] **Step 1: Add failing route tests**

Append tests to `apps/api/src/modules/onboarding/onboarding-session.routes.test.ts`:

```ts
import { buildApp } from "../../app";

const ownerHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-profile-id": "profile_owner",
  "x-baase-role": "owner"
};

const employeeHeaders = {
  "x-baase-workspace-id": "workspace_a",
  "x-baase-profile-id": "profile_employee",
  "x-baase-role": "employee"
};

describe("onboarding session routes", () => {
  it("creates, patches, reads, and skips an owner onboarding session", async () => {
    const app = buildApp();

    const created = await app.inject({
      method: "POST",
      url: "/onboarding/session",
      headers: ownerHeaders,
      payload: { current_step: "identity" }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().session).toMatchObject({
      status: "in_progress",
      currentStep: "identity",
      ownerProfileId: "profile_owner"
    });

    const patched = await app.inject({
      method: "PATCH",
      url: "/onboarding/session",
      headers: ownerHeaders,
      payload: {
        company_name: "Estudio Norte",
        segment: "Outro",
        custom_segment: "Agencia de conteudo",
        normalized_segment: "Agencia de conteudo",
        team_size_range: "6-15",
        goals: ["extract_owner_knowledge", "organize_team"]
      }
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().session).toMatchObject({
      companyName: "Estudio Norte",
      normalizedSegment: "Agencia de conteudo",
      goals: ["extract_owner_knowledge", "organize_team"]
    });

    const current = await app.inject({
      method: "GET",
      url: "/onboarding/session",
      headers: ownerHeaders
    });

    expect(current.statusCode).toBe(200);
    expect(current.json().session.companyName).toBe("Estudio Norte");

    const skipped = await app.inject({
      method: "POST",
      url: "/onboarding/session/skip",
      headers: ownerHeaders
    });

    expect(skipped.statusCode).toBe(200);
    expect(skipped.json().session.status).toBe("skipped");
  });

  it("rejects onboarding session creation for employees", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/onboarding/session",
      headers: employeeHeaders,
      payload: { current_step: "identity" }
    });

    expect(response.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @prymeira/baase-api test src/modules/onboarding/onboarding-session.routes.test.ts
```

Expected: fail because routes are missing.

- [ ] **Step 3: Add service helpers**

Create `apps/api/src/modules/onboarding/onboarding.service.ts`:

```ts
import type {
  OnboardingAnswer,
  OnboardingRepository,
  OnboardingSession,
  OnboardingSessionStatus
} from "./onboarding.types";

export type PatchOnboardingSessionInput = {
  currentStep?: string;
  companyName?: string | null;
  segment?: string | null;
  customSegment?: string | null;
  normalizedSegment?: string | null;
  teamSizeRange?: string | null;
  goals?: string[];
  mainAnswers?: OnboardingAnswer[];
};

export function createOnboardingService(repository: OnboardingRepository) {
  async function getOrCreateSession(workspaceId: string, ownerProfileId: string, currentStep = "identity") {
    const existing = await repository.getCurrentSession(workspaceId);
    if (existing && existing.status !== "completed") return existing;

    return repository.createSession({
      workspaceId,
      ownerProfileId,
      status: "in_progress",
      currentStep,
      companyName: null,
      segment: null,
      customSegment: null,
      normalizedSegment: null,
      teamSizeRange: null,
      goals: [],
      mainAnswers: [],
      attachments: [],
      diagnosis: null,
      followupQuestions: [],
      followupAnswers: [],
      generatedSuggestion: null,
      reviewDecisions: [],
      activationPlan: [],
      createdSetupSummary: null,
      aiRunIds: []
    });
  }

  async function patchSession(workspaceId: string, ownerProfileId: string, input: PatchOnboardingSessionInput) {
    const session = await getOrCreateSession(workspaceId, ownerProfileId, input.currentStep ?? "identity");
    return repository.updateSession({
      ...session,
      currentStep: input.currentStep ?? session.currentStep,
      companyName: input.companyName !== undefined ? input.companyName : session.companyName,
      segment: input.segment !== undefined ? input.segment : session.segment,
      customSegment: input.customSegment !== undefined ? input.customSegment : session.customSegment,
      normalizedSegment: input.normalizedSegment !== undefined ? input.normalizedSegment : session.normalizedSegment,
      teamSizeRange: input.teamSizeRange !== undefined ? input.teamSizeRange : session.teamSizeRange,
      goals: input.goals ?? session.goals,
      mainAnswers: input.mainAnswers ?? session.mainAnswers
    });
  }

  async function setStatus(workspaceId: string, ownerProfileId: string, status: OnboardingSessionStatus, currentStep: string) {
    const session = await getOrCreateSession(workspaceId, ownerProfileId, currentStep);
    return repository.updateSession({
      ...session,
      status,
      currentStep,
      completedAt: status === "completed" ? new Date().toISOString() : session.completedAt
    });
  }

  function serialize(session: OnboardingSession) {
    return {
      ...session,
      current_step: session.currentStep,
      company_name: session.companyName,
      custom_segment: session.customSegment,
      normalized_segment: session.normalizedSegment,
      team_size_range: session.teamSizeRange,
      main_answers: session.mainAnswers,
      followup_questions: session.followupQuestions,
      followup_answers: session.followupAnswers,
      generated_suggestion: session.generatedSuggestion,
      review_decisions: session.reviewDecisions,
      activation_plan: session.activationPlan,
      created_setup_summary: session.createdSetupSummary,
      ai_run_ids: session.aiRunIds,
      owner_profile_id: session.ownerProfileId,
      workspace_id: session.workspaceId,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
      completed_at: session.completedAt
    };
  }

  return {
    getOrCreateSession,
    patchSession,
    setStatus,
    serialize
  };
}
```

- [ ] **Step 4: Wire repository into app**

Modify `apps/api/src/app.ts`:

```ts
import { createInMemoryOnboardingRepository } from "./modules/onboarding/in-memory-onboarding.repository";
import type { OnboardingRepository } from "./modules/onboarding/onboarding.types";
```

Extend `BuildAppOptions`:

```ts
onboardingRepository?: OnboardingRepository;
```

Create the repository inside `buildApp`:

```ts
const onboardingRepository = options.onboardingRepository ?? createInMemoryOnboardingRepository();
```

Pass it to routes:

```ts
app.register((routes) => registerOnboardingRoutes(routes, {
  companyRepository,
  processRepository,
  routineRepository,
  trainingRepository,
  announcementRepository,
  onboardingRepository,
  aiRepository,
  aiProvider
}));
```

- [ ] **Step 5: Add route schemas and handlers**

Modify `apps/api/src/modules/onboarding/onboarding.routes.ts`:

```ts
import type { AiProvider, AiRepository } from "../ai/ai.types";
import type { AnnouncementRepository } from "../announcements/announcement.types";
import { createOnboardingService } from "./onboarding.service";
import type { OnboardingRepository } from "./onboarding.types";
```

Extend route repositories:

```ts
announcementRepository: AnnouncementRepository;
onboardingRepository: OnboardingRepository;
aiRepository: AiRepository;
aiProvider: AiProvider;
```

Add schemas:

```ts
const createSessionSchema = z.object({
  current_step: z.string().min(1).default("identity")
});

const answerSchema = z.object({
  question_id: z.string().min(1),
  theme: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
  input_mode: z.enum(["text", "audio"]).default("text")
});

const patchSessionSchema = z.object({
  current_step: z.string().min(1).optional(),
  company_name: z.string().min(1).max(140).optional().nullable(),
  segment: z.string().min(1).max(120).optional().nullable(),
  custom_segment: z.string().min(1).max(160).optional().nullable(),
  normalized_segment: z.string().min(1).max(160).optional().nullable(),
  team_size_range: z.string().min(1).max(40).optional().nullable(),
  goals: z.array(z.string().min(1)).max(12).optional(),
  main_answers: z.array(answerSchema).max(12).optional()
});
```

Inside `registerOnboardingRoutes`, create service:

```ts
const onboardingService = createOnboardingService(repositories.onboardingRepository);
```

Add handlers:

```ts
app.get("/onboarding/session", async (request) => {
  const context = readRequestContext(request);
  if (!canEditCompanyBase(context.role)) throw forbiddenError();
  const session = await repositories.onboardingRepository.getCurrentSession(context.workspaceId);
  return { session: session ? onboardingService.serialize(session) : null };
});

app.post("/onboarding/session", async (request, reply) => {
  const context = readRequestContext(request);
  if (!canEditCompanyBase(context.role)) throw forbiddenError();
  const body = createSessionSchema.parse(request.body);
  const session = await onboardingService.getOrCreateSession(context.workspaceId, context.profileId, body.current_step);
  return reply.status(201).send({ session: onboardingService.serialize(session) });
});

app.patch("/onboarding/session", async (request) => {
  const context = readRequestContext(request);
  if (!canEditCompanyBase(context.role)) throw forbiddenError();
  const body = patchSessionSchema.parse(request.body);
  const session = await onboardingService.patchSession(context.workspaceId, context.profileId, {
    currentStep: body.current_step,
    companyName: body.company_name,
    segment: body.segment,
    customSegment: body.custom_segment,
    normalizedSegment: body.normalized_segment,
    teamSizeRange: body.team_size_range,
    goals: body.goals,
    mainAnswers: body.main_answers?.map((answer) => ({
      questionId: answer.question_id,
      theme: answer.theme,
      question: answer.question,
      answer: answer.answer,
      inputMode: answer.input_mode
    }))
  });
  return { session: onboardingService.serialize(session) };
});

app.post("/onboarding/session/skip", async (request) => {
  const context = readRequestContext(request);
  if (!canEditCompanyBase(context.role)) throw forbiddenError();
  const session = await onboardingService.setStatus(context.workspaceId, context.profileId, "skipped", "skipped");
  return { session: onboardingService.serialize(session) };
});
```

- [ ] **Step 6: Add Postgres repository**

Modify `apps/api/src/db/postgres.ts` imports:

```ts
import type { OnboardingRepository, OnboardingSession } from "../modules/onboarding/onboarding.types";
```

Extend bundle return type with `"onboardingRepository"`.

Add to return object:

```ts
onboardingRepository: createPostgresOnboardingRepository(store)
```

Add function:

```ts
function createPostgresOnboardingRepository(store: JsonbRecordStore): OnboardingRepository {
  return {
    async getCurrentSession(workspaceId) {
      const sessions = await store.list<OnboardingSession>("onboarding_session", workspaceId);
      return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
    },

    findSession(workspaceId, sessionId) {
      return store.find<OnboardingSession>("onboarding_session", workspaceId, sessionId);
    },

    async createSession(input) {
      const timestamp = now();
      return store.insert<OnboardingSession>("onboarding_session", {
        ...input,
        id: `onboarding_session_${(await store.count("onboarding_session")) + 1}`,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null
      });
    },

    updateSession(session) {
      return store.update<OnboardingSession>("onboarding_session", {
        ...session,
        updatedAt: now()
      });
    }
  };
}
```

- [ ] **Step 7: Add Postgres persistence test**

Append to `apps/api/src/db/postgres.repositories.test.ts`:

```ts
it("persists onboarding sessions in Postgres", async () => {
  const bundle = createPostgresRepositoryBundle(db.adapters.createPg().pool);
  const session = await bundle.onboardingRepository.createSession({
    workspaceId: "workspace_onboarding",
    ownerProfileId: "profile_owner",
    status: "in_progress",
    currentStep: "identity",
    companyName: "Estudio Norte",
    segment: "Agencia de marketing",
    customSegment: null,
    normalizedSegment: "Agencia de marketing",
    teamSizeRange: "6-15",
    goals: ["organize_team"],
    mainAnswers: [],
    attachments: [],
    diagnosis: null,
    followupQuestions: [],
    followupAnswers: [],
    generatedSuggestion: null,
    reviewDecisions: [],
    activationPlan: [],
    createdSetupSummary: null,
    aiRunIds: []
  });

  await expect(bundle.onboardingRepository.getCurrentSession("workspace_onboarding")).resolves.toMatchObject({
    id: session.id,
    companyName: "Estudio Norte"
  });
});
```

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm --filter @prymeira/baase-api test src/modules/onboarding/onboarding-session.routes.test.ts src/db/postgres.repositories.test.ts
pnpm --filter @prymeira/baase-api typecheck
```

Expected: pass.

- [ ] **Step 9: Checkpoint**

Record: "API onboarding session persistence and routes complete."

---

## Task 3: AI Diagnosis Schema, Prompt, Mock Provider, And Route

**Files:**
- Modify: `apps/api/src/modules/ai/ai.types.ts`
- Modify: `apps/api/src/modules/ai/schema-registry.ts`
- Modify: `apps/api/src/modules/ai/prompt-registry.ts`
- Modify: `apps/api/src/modules/ai/providers/mock-ai.provider.ts`
- Modify: `apps/api/src/modules/onboarding/onboarding.routes.ts`
- Test: `apps/api/src/modules/ai/ai-registries.test.ts`
- Test: `apps/api/src/modules/onboarding/onboarding-session.routes.test.ts`

- [ ] **Step 1: Write failing schema and route tests**

Append to `apps/api/src/modules/ai/ai-registries.test.ts`:

```ts
import { onboardingDiagnosisSchema } from "./schema-registry";

it("validates onboarding diagnosis with at most three follow-up questions", () => {
  const diagnosis = onboardingDiagnosisSchema.parse({
    companyName: "Estudio Norte",
    normalizedSegment: "Agencia de marketing",
    confidence: "high",
    operationalSummary: "Agencia com entrega recorrente de conteudo e trafego.",
    businessModel: "Servicos recorrentes",
    customerProfile: "Pequenas empresas",
    deliveryModel: "Atendimento, briefing, execucao e aprovacao",
    detectedAreas: [{ id: "area_ops", name: "Operacoes", description: "Entrega diaria.", source: "inferred", reason: "Citada na explicacao." }],
    detectedPeople: [{ id: "person_owner", name: "Dono", roleHint: "Gestor", areaName: "Operacoes", source: "placeholder" }],
    bottlenecks: [{ id: "bottleneck_approval", title: "Aprovacoes atrasadas", description: "Entregas param esperando ok.", severity: "high", source: "user_provided" }],
    assumptions: ["Financeiro nao foi detalhado."],
    followupQuestions: [
      { id: "approval_owner", question: "Quem aprova entregas?", reason: "Define rotina e permissao.", expectedUse: "approval_evidence", priority: 1 }
    ]
  });

  expect(diagnosis.followupQuestions).toHaveLength(1);
});

it("registers the onboarding diagnostician prompt", () => {
  const prompt = getPromptDefinition("agent/onboarding-diagnostician", "1");
  expect(prompt).toMatchObject({
    agentKey: "onboarding_diagnostician",
    outputSchemaKey: "onboarding_diagnosis"
  });
});
```

Append to `apps/api/src/modules/onboarding/onboarding-session.routes.test.ts`:

```ts
it("generates and stores an onboarding diagnosis", async () => {
  const app = buildApp();

  await app.inject({
    method: "PATCH",
    url: "/onboarding/session",
    headers: ownerHeaders,
    payload: {
      company_name: "Estudio Norte",
      segment: "Agencia de marketing",
      normalized_segment: "Agencia de marketing",
      team_size_range: "6-15",
      goals: ["extract_owner_knowledge"],
      main_answers: [{
        question_id: "operations_overview",
        theme: "business_model",
        question: "O que vende?",
        answer: "Vendemos marketing recorrente para pequenos negocios.",
        input_mode: "text"
      }]
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/onboarding/session/diagnosis",
    headers: ownerHeaders
  });

  expect(response.statusCode).toBe(201);
  expect(response.json().session.status).toBe("diagnosis_ready");
  expect(response.json().session.diagnosis.operationalSummary).toContain("operacao");
  expect(response.json().session.followupQuestions.length).toBeLessThanOrEqual(3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @prymeira/baase-api test src/modules/ai/ai-registries.test.ts src/modules/onboarding/onboarding-session.routes.test.ts
```

Expected: fail due missing schema, prompt, and route.

- [ ] **Step 3: Add AI task kind**

Modify `apps/api/src/modules/ai/ai.types.ts`:

```ts
export type AiTaskKind =
  | "onboarding_diagnosis"
  | "onboarding_setup"
  | "process_draft"
  | "routine_draft"
  | "training_draft"
  | "announcement_draft"
  | "ops_review"
  | "transcript_cleanup"
  | "classification"
  | "proactive_suggestion";
```

- [ ] **Step 4: Add diagnosis schema**

Modify `apps/api/src/modules/ai/schema-registry.ts`:

```ts
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
```

Add to registry:

```ts
onboarding_diagnosis: onboardingDiagnosisSchema,
```

- [ ] **Step 5: Add prompt definition**

Modify `apps/api/src/modules/ai/prompt-registry.ts` with a new prompt:

```ts
{
  key: "agent/onboarding-diagnostician",
  version: "1",
  agentKey: "onboarding_diagnostician",
  modelFamily: "gpt-5.5",
  system: productPrinciples,
  developer: `Resultado esperado:
Interpretar o onboarding inicial sem criar a empresa final.

Voce recebera nome da empresa, segmento normalizado, faixa de equipe, objetivos, respostas abertas, transcricoes e anexos.

Retorne:
- resumo operacional;
- modelo de negocio;
- cliente principal;
- modelo de entrega;
- areas detectadas;
- pessoas citadas ou placeholders claros;
- gargalos principais;
- suposicoes;
- no maximo 3 perguntas essenciais.

Regras:
- Nao crie processos, rotinas ou treinamentos nesta etapa.
- Nao faca perguntas por curiosidade.
- Pergunte apenas o que muda a estrutura final.
- Use "Outro" somente como marcador de UI; o segmento real e normalizedSegment.
- Escreva em portugues do Brasil, claro e operacional.
- Retorne somente o objeto estruturado no schema solicitado.`,
  outputSchemaKey: "onboarding_diagnosis",
  changelog: "Diagnostico intermediario antes da geracao da empresa."
}
```

- [ ] **Step 6: Add mock provider diagnosis**

Modify `apps/api/src/modules/ai/providers/mock-ai.provider.ts` so `generateStructured` returns diagnosis when `request.taskKind === "onboarding_diagnosis"`:

```ts
function createOnboardingDiagnosis(request: AiStructuredProviderRequest) {
  const input = request.input as {
    companyName?: string;
    normalizedSegment?: string;
    segment?: string;
  };
  const companyName = input.companyName ?? "Empresa Baase";
  const normalizedSegment = input.normalizedSegment ?? input.segment ?? "Operacao geral";

  return {
    companyName,
    normalizedSegment,
    confidence: "medium",
    operationalSummary: `Entendemos uma operacao de ${normalizedSegment} que precisa transformar conhecimento do dono em execucao diaria.`,
    businessModel: "Servico com rotina operacional",
    customerProfile: "Clientes atendidos pela equipe",
    deliveryModel: "Entrada, execucao, revisao e acompanhamento",
    detectedAreas: [
      { id: "area_operacoes", name: "Operacoes", description: "Entrega diaria, padroes e rotina.", source: "inferred", reason: "A operacao foi citada como gargalo principal." },
      { id: "area_atendimento", name: "Atendimento", description: "Relacionamento e retornos para clientes.", source: "template", reason: "Empresas de servico precisam de cadencia com clientes." }
    ],
    detectedPeople: [
      { id: "person_owner", name: "Dono da empresa", roleHint: "Gestor operacional", areaName: "Operacoes", source: "placeholder" }
    ],
    bottlenecks: [
      { id: "bottleneck_owner", title: "Dependencia do dono", description: "Decisoes e padroes ainda ficam concentrados no dono.", severity: "high", source: "inferred" }
    ],
    assumptions: ["Responsaveis por area ainda precisam ser confirmados."],
    followupQuestions: [
      { id: "responsaveis_area", question: "Quem responde por cada area no dia a dia?", reason: "Define cargos, permissoes e convites.", expectedUse: "people", priority: 1 },
      { id: "aprovacoes", question: "Em quais tarefas a equipe precisa anexar evidencia ou pedir aprovacao?", reason: "Define rotinas executaveis.", expectedUse: "approval_evidence", priority: 2 }
    ]
  };
}
```

- [ ] **Step 7: Add diagnosis route**

Modify `apps/api/src/modules/onboarding/onboarding.routes.ts`:

```ts
import { createAiHarness } from "../ai/ai-harness";
import { getPromptDefinition } from "../ai/prompt-registry";
import { onboardingDiagnosisSchema } from "../ai/schema-registry";
```

Inside `registerOnboardingRoutes`:

```ts
const harness = createAiHarness({
  repository: repositories.aiRepository,
  provider: repositories.aiProvider
});
```

Add route:

```ts
app.post("/onboarding/session/diagnosis", async (request, reply) => {
  const context = readRequestContext(request);
  if (!canEditCompanyBase(context.role)) throw forbiddenError();

  const session = await onboardingService.getOrCreateSession(context.workspaceId, context.profileId, "conversation");
  const prompt = getPromptDefinition("agent/onboarding-diagnostician", "1");
  const result = await harness.runStructured({
    workspaceId: context.workspaceId,
    actorProfileId: context.profileId,
    source: "onboarding",
    inputMode: session.mainAnswers.some((answer) => answer.inputMode === "audio") ? "mixed" : "text",
    taskKind: "onboarding_diagnosis",
    agentKey: "onboarding_diagnostician",
    promptKey: prompt.key,
    promptVersion: prompt.version,
    model: "gpt-5.5",
    reasoningEffort: "medium",
    input: {
      companyName: session.companyName,
      segment: session.segment,
      customSegment: session.customSegment,
      normalizedSegment: session.normalizedSegment ?? session.customSegment ?? session.segment,
      teamSizeRange: session.teamSizeRange,
      goals: session.goals,
      answers: session.mainAnswers,
      attachments: session.attachments,
      context: {
        workspaceId: context.workspaceId,
        ownerProfileId: context.profileId
      }
    },
    outputSchema: onboardingDiagnosisSchema,
    schemaName: "onboarding_diagnosis"
  });

  const updated = await repositories.onboardingRepository.updateSession({
    ...session,
    status: "diagnosis_ready",
    currentStep: "diagnosis",
    diagnosis: result.output,
    followupQuestions: result.output.followupQuestions,
    aiRunIds: [...session.aiRunIds, result.run.id]
  });

  return reply.status(201).send({ session: onboardingService.serialize(updated) });
});
```

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm --filter @prymeira/baase-api test src/modules/ai/ai-registries.test.ts src/modules/onboarding/onboarding-session.routes.test.ts
pnpm --filter @prymeira/baase-api typecheck
```

Expected: pass.

- [ ] **Step 9: Checkpoint**

Record: "Onboarding diagnosis AI route complete."

---

## Task 4: Expanded Setup Suggestion And Follow-Up Answers

**Files:**
- Modify: `apps/api/src/modules/ai/schema-registry.ts`
- Modify: `apps/api/src/modules/ai/prompt-registry.ts`
- Modify: `apps/api/src/modules/ai/providers/mock-ai.provider.ts`
- Modify: `apps/api/src/modules/onboarding/onboarding.routes.ts`
- Test: `apps/api/src/modules/ai/ai-registries.test.ts`
- Test: `apps/api/src/modules/onboarding/onboarding-session.routes.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `apps/api/src/modules/onboarding/onboarding-session.routes.test.ts`:

```ts
it("stores follow-up answers and generates the final onboarding setup suggestion", async () => {
  const app = buildApp();

  await app.inject({
    method: "PATCH",
    url: "/onboarding/session",
    headers: ownerHeaders,
    payload: {
      company_name: "Estudio Norte",
      segment: "Agencia de marketing",
      normalized_segment: "Agencia de marketing",
      team_size_range: "6-15",
      goals: ["organize_team"],
      main_answers: [{
        question_id: "operations_overview",
        theme: "business_model",
        question: "O que vende?",
        answer: "Marketing recorrente para pequenos negocios.",
        input_mode: "text"
      }]
    }
  });

  await app.inject({ method: "POST", url: "/onboarding/session/diagnosis", headers: ownerHeaders });

  const answered = await app.inject({
    method: "POST",
    url: "/onboarding/session/followup-answer",
    headers: ownerHeaders,
    payload: {
      question_id: "responsaveis_area",
      question: "Quem responde por cada area no dia a dia?",
      answer: "Marina cuida da operacao e Bruno da criacao.",
      input_mode: "text"
    }
  });

  expect(answered.statusCode).toBe(200);
  expect(answered.json().session.followupAnswers).toHaveLength(1);

  const generated = await app.inject({
    method: "POST",
    url: "/onboarding/session/generate-setup",
    headers: ownerHeaders
  });

  expect(generated.statusCode).toBe(201);
  expect(generated.json().session.status).toBe("reviewing");
  expect(generated.json().session.generatedSuggestion.companyName).toBe("Estudio Norte");
  expect(generated.json().session.generatedSuggestion.activationPlan).toHaveLength(7);
  expect(generated.json().session.generatedSuggestion.processes[0].metadata).toMatchObject({
    reviewDefault: "draft"
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @prymeira/baase-api test src/modules/onboarding/onboarding-session.routes.test.ts src/modules/ai/ai-registries.test.ts
```

Expected: fail due missing follow-up and generate routes/schema metadata.

- [ ] **Step 3: Expand setup schema**

Modify `apps/api/src/modules/ai/schema-registry.ts`:

```ts
const suggestionMetadataSchema = z.object({
  reason: z.string().min(1),
  basedOn: z.array(z.string().min(1)),
  expectedImpact: z.string().min(1),
  source: z.enum(["user_provided", "inferred", "template", "placeholder"]),
  reviewDefault: z.enum(["create", "draft", "publish", "activate"])
});
```

Replace item `source` fields in `onboardingSetupSuggestionSchema` with `metadata: suggestionMetadataSchema`, add `id` to each generated item, add `companyName`, `announcement`, and `activationPlan`:

```ts
companyName: z.string().min(1),
areas: z.array(z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  metadata: suggestionMetadataSchema
})).min(1),
```

Apply the same pattern to roles, people, processes, routines, and trainings. People include:

```ts
placeholder: z.boolean()
```

Add:

```ts
announcement: z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  metadata: suggestionMetadataSchema
}).nullable(),
activationPlan: z.array(z.object({
  day: z.number().int().min(1).max(7),
  title: z.string().min(1),
  objective: z.string().min(1),
  action: z.enum(["open_company_map", "review_processes", "activate_routine", "publish_training", "invite_team", "review_today", "review_dashboard"])
})).length(7)
```

- [ ] **Step 4: Update architect prompt**

Modify `apps/api/src/modules/ai/prompt-registry.ts` under `agent/onboarding-architect` developer text to include:

```txt
Inclua companyName, metadata em cada item e activationPlan com 7 dias.

Cada item deve trazer:
- reason: por que foi sugerido;
- basedOn: entradas usadas;
- expectedImpact: impacto operacional esperado;
- source: user_provided, inferred, template ou placeholder;
- reviewDefault: create para base da empresa, draft para conteudos, activate somente se o dono explicitamente pediu ativacao.

Limites:
- 3 a 6 areas;
- 3 a 5 processos;
- 3 a 5 rotinas;
- 2 a 4 treinamentos;
- no maximo 1 comunicado opcional.

Rotinas devem entrar como draft por padrao.
```

- [ ] **Step 5: Update mock provider setup output**

Update onboarding mock output in `apps/api/src/modules/ai/providers/mock-ai.provider.ts` so all items include `id` and `metadata`. Example metadata helper:

```ts
function metadata(reason: string, reviewDefault: "create" | "draft" | "publish" | "activate" = "draft") {
  return {
    reason,
    basedOn: ["respostas do onboarding", "objetivos selecionados"],
    expectedImpact: "Dar clareza operacional e reduzir dependencia do dono.",
    source: "inferred",
    reviewDefault
  };
}
```

Ensure setup output includes:

```ts
companyName: input.companyName ?? "Empresa Baase",
announcement: {
  id: "announcement_change_to_baase",
  title: "Nova organizacao operacional no Baase",
  body: "Equipe, vamos centralizar processos, rotinas e evidencias no Prymeira Baase para dar mais clareza ao dia a dia.",
  metadata: metadata("Ajuda a equipe a entender a mudanca.", "draft")
},
activationPlan: [
  { day: 1, title: "Revisar mapa da empresa", objective: "Confirmar areas, cargos e responsaveis.", action: "open_company_map" },
  { day: 2, title: "Revisar processos principais", objective: "Ajustar os processos mais importantes.", action: "review_processes" },
  { day: 3, title: "Ativar primeira rotina", objective: "Comecar a execucao diaria com baixa friccao.", action: "activate_routine" },
  { day: 4, title: "Publicar primeiro treinamento", objective: "Alinhar a equipe em um comportamento essencial.", action: "publish_training" },
  { day: 5, title: "Convidar equipe", objective: "Trazer os funcionarios para a visao certa.", action: "invite_team" },
  { day: 6, title: "Acompanhar primeiras execucoes", objective: "Ver atrasos e duvidas reais.", action: "review_today" },
  { day: 7, title: "Revisar painel", objective: "Ajustar gargalos e proximos passos.", action: "review_dashboard" }
]
```

- [ ] **Step 6: Add follow-up and generate routes**

Add schema to `onboarding.routes.ts`:

```ts
const followupAnswerSchema = z.object({
  question_id: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
  input_mode: z.enum(["text", "audio"]).default("text")
});
```

Add route:

```ts
app.post("/onboarding/session/followup-answer", async (request) => {
  const context = readRequestContext(request);
  if (!canEditCompanyBase(context.role)) throw forbiddenError();
  const body = followupAnswerSchema.parse(request.body);
  const session = await onboardingService.getOrCreateSession(context.workspaceId, context.profileId, "followup");
  const updated = await repositories.onboardingRepository.updateSession({
    ...session,
    status: "followup",
    currentStep: "followup",
    followupAnswers: [
      ...session.followupAnswers.filter((answer) => answer.questionId !== body.question_id),
      {
        questionId: body.question_id,
        theme: "followup",
        question: body.question,
        answer: body.answer,
        inputMode: body.input_mode
      }
    ]
  });
  return { session: onboardingService.serialize(updated) };
});
```

Add generate route using `onboardingSetupSuggestionSchema`:

```ts
app.post("/onboarding/session/generate-setup", async (request, reply) => {
  const context = readRequestContext(request);
  if (!canEditCompanyBase(context.role)) throw forbiddenError();
  const session = await onboardingService.getOrCreateSession(context.workspaceId, context.profileId, "generating_setup");
  const prompt = getPromptDefinition("agent/onboarding-architect", "1");
  const result = await harness.runStructured({
    workspaceId: context.workspaceId,
    actorProfileId: context.profileId,
    source: "onboarding",
    inputMode: session.mainAnswers.some((answer) => answer.inputMode === "audio") ? "mixed" : "text",
    taskKind: "onboarding_setup",
    agentKey: "onboarding_architect",
    promptKey: prompt.key,
    promptVersion: prompt.version,
    model: "gpt-5.5",
    reasoningEffort: "medium",
    input: {
      companyName: session.companyName,
      segment: session.segment,
      customSegment: session.customSegment,
      normalizedSegment: session.normalizedSegment ?? session.customSegment ?? session.segment,
      teamSizeRange: session.teamSizeRange,
      goals: session.goals,
      answers: session.mainAnswers,
      diagnosis: session.diagnosis,
      followupAnswers: session.followupAnswers,
      attachments: session.attachments
    },
    outputSchema: onboardingSetupSuggestionSchema,
    schemaName: "onboarding_setup_suggestion"
  });
  const updated = await repositories.onboardingRepository.updateSession({
    ...session,
    status: "reviewing",
    currentStep: "review_map",
    generatedSuggestion: result.output,
    activationPlan: result.output.activationPlan,
    aiRunIds: [...session.aiRunIds, result.run.id]
  });
  return reply.status(201).send({ session: onboardingService.serialize(updated) });
});
```

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm --filter @prymeira/baase-api test src/modules/ai/ai-registries.test.ts src/modules/onboarding/onboarding-session.routes.test.ts
pnpm --filter @prymeira/baase-api typecheck
```

Expected: pass.

- [ ] **Step 8: Checkpoint**

Record: "Expanded onboarding setup generation complete."

---

## Task 5: Complete Session Creates Real Data With Draft Defaults

**Files:**
- Modify: `apps/api/src/modules/company/company.types.ts`
- Modify: `apps/api/src/modules/company/company.service.ts`
- Modify: `apps/api/src/modules/company/in-memory-company.repository.ts`
- Modify: `apps/api/src/db/postgres.ts`
- Modify: `apps/api/src/modules/onboarding/onboarding.service.ts`
- Modify: `apps/api/src/modules/onboarding/onboarding.routes.ts`
- Test: `apps/api/src/modules/onboarding/onboarding-session.routes.test.ts`

- [ ] **Step 1: Write failing completion test**

Append to `apps/api/src/modules/onboarding/onboarding-session.routes.test.ts`:

```ts
it("completes onboarding by creating base records and keeping content as drafts", async () => {
  const app = buildApp();

  await app.inject({
    method: "PATCH",
    url: "/onboarding/session",
    headers: ownerHeaders,
    payload: {
      company_name: "Estudio Norte",
      segment: "Agencia de marketing",
      normalized_segment: "Agencia de marketing",
      team_size_range: "6-15",
      goals: ["organize_team"],
      main_answers: [{
        question_id: "operations_overview",
        theme: "business_model",
        question: "O que vende?",
        answer: "Marketing recorrente para pequenos negocios.",
        input_mode: "text"
      }]
    }
  });
  await app.inject({ method: "POST", url: "/onboarding/session/diagnosis", headers: ownerHeaders });
  await app.inject({ method: "POST", url: "/onboarding/session/generate-setup", headers: ownerHeaders });

  const response = await app.inject({
    method: "POST",
    url: "/onboarding/session/complete",
    headers: ownerHeaders
  });

  expect(response.statusCode).toBe(201);
  expect(response.json().session.status).toBe("completed");
  expect(response.json().session.createdSetupSummary).toMatchObject({
    areas: expect.any(Number),
    roles: expect.any(Number),
    processes: expect.any(Number),
    routines: expect.any(Number),
    trainings: expect.any(Number)
  });

  const [areas, people, processes, routines, trainings, announcements, today] = await Promise.all([
    app.inject({ method: "GET", url: "/areas", headers: ownerHeaders }),
    app.inject({ method: "GET", url: "/people", headers: ownerHeaders }),
    app.inject({ method: "GET", url: "/processes", headers: ownerHeaders }),
    app.inject({ method: "GET", url: "/routines", headers: ownerHeaders }),
    app.inject({ method: "GET", url: "/trainings", headers: ownerHeaders }),
    app.inject({ method: "GET", url: "/announcements", headers: ownerHeaders }),
    app.inject({ method: "GET", url: "/today?date=2026-07-07", headers: ownerHeaders })
  ]);

  expect(areas.json().areas.length).toBeGreaterThan(0);
  expect(people.json().people.some((person: { status: string }) => person.status === "placeholder")).toBe(true);
  expect(processes.json().processes[0].status).toBe("draft");
  expect(routines.json().routines[0].status).toBe("archived");
  expect(trainings.json().trainings[0].status).toBe("draft");
  expect(announcements.json().announcements[0].status).toBe("draft");
  expect(today.json().tasks).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm --filter @prymeira/baase-api test src/modules/onboarding/onboarding-session.routes.test.ts
```

Expected: fail because completion route and placeholder status are missing.

- [ ] **Step 3: Allow placeholder team members**

Modify `apps/api/src/modules/company/company.types.ts`:

```ts
status: "active" | "inactive" | "placeholder";
```

Modify `CreateTeamMemberInput`:

```ts
status?: TeamMember["status"];
```

Modify `CompanyRepository.createTeamMember` signature:

```ts
createTeamMember(input: Omit<TeamMember, "id" | "createdAt" | "updatedAt">): Promise<TeamMember>;
```

Update in-memory and Postgres company repository `createTeamMember` to use `input.status ?? "active"` instead of hard-coded `"active"`.

- [ ] **Step 4: Add review decision route**

Add schema in `onboarding.routes.ts`:

```ts
const reviewDecisionSchema = z.object({
  item_type: z.enum(["area", "role", "person", "process", "routine", "training", "announcement", "invite"]),
  item_id: z.string().min(1),
  action: z.enum(["create", "remove", "draft", "publish", "activate"]),
  edited_payload: z.record(z.string(), z.unknown()).nullable().optional()
});
```

Add route:

```ts
app.patch("/onboarding/session/review-decision", async (request) => {
  const context = readRequestContext(request);
  if (!canEditCompanyBase(context.role)) throw forbiddenError();
  const body = reviewDecisionSchema.parse(request.body);
  const session = await onboardingService.getOrCreateSession(context.workspaceId, context.profileId, "review");
  const decision = {
    itemType: body.item_type,
    itemId: body.item_id,
    action: body.action,
    editedPayload: body.edited_payload ?? null
  };
  const updated = await repositories.onboardingRepository.updateSession({
    ...session,
    reviewDecisions: [
      ...session.reviewDecisions.filter((item) => !(item.itemType === decision.itemType && item.itemId === decision.itemId)),
      decision
    ]
  });
  return { session: onboardingService.serialize(updated) };
});
```

- [ ] **Step 5: Implement completion service**

Add to `createOnboardingService` a `completeSession` function accepting dependencies:

```ts
type CompleteSessionRepositories = {
  companyRepository: CompanyRepository;
  processRepository: ProcessRepository;
  routineRepository: RoutineRepository;
  trainingRepository: TrainingRepository;
  announcementRepository: AnnouncementRepository;
};
```

The function must:

1. Read `session.generatedSuggestion`.
2. Build `areaBySuggestionId` and `areaByName`.
3. Create non-removed areas.
4. Create non-removed role templates.
5. Create non-removed people with `status: placeholder` when `person.placeholder === true`, else `active`.
6. Create processes with status `draft` unless review decision is `publish`.
7. Create routines with status `archived` unless review decision is `activate`.
8. Create trainings with status `draft` unless review decision is `publish`.
9. Create announcement as `draft` unless review decision is `publish`.
10. Save summary and mark session `completed`.

Use helper:

```ts
function findDecision(session: OnboardingSession, itemType: OnboardingReviewDecision["itemType"], itemId: string) {
  return session.reviewDecisions.find((decision) => decision.itemType === itemType && decision.itemId === itemId) ?? null;
}
```

- [ ] **Step 6: Add complete route**

Add to `onboarding.routes.ts`:

```ts
app.post("/onboarding/session/complete", async (request, reply) => {
  const context = readRequestContext(request);
  if (!canEditCompanyBase(context.role)) throw forbiddenError();
  const completed = await onboardingService.completeSession(context.workspaceId, context.profileId, {
    companyRepository: repositories.companyRepository,
    processRepository: repositories.processRepository,
    routineRepository: repositories.routineRepository,
    trainingRepository: repositories.trainingRepository,
    announcementRepository: repositories.announcementRepository
  });
  return reply.status(201).send({ session: onboardingService.serialize(completed) });
});
```

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm --filter @prymeira/baase-api test src/modules/onboarding/onboarding-session.routes.test.ts src/modules/company/company.routes.test.ts src/db/postgres.repositories.test.ts
pnpm --filter @prymeira/baase-api typecheck
```

Expected: pass.

- [ ] **Step 8: Checkpoint**

Record: "Onboarding completion creates real base and draft content."

---

## Task 6: Web API Helpers For Onboarding Sessions

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

- [ ] **Step 1: Write failing API helper tests**

Append to `apps/web/src/api.test.ts`:

```ts
import {
  completeOnboardingSession,
  generateOnboardingDiagnosis,
  generateOnboardingSetup,
  getOnboardingSession,
  patchOnboardingSession,
  saveOnboardingFollowupAnswer,
  skipOnboardingSession
} from "./api";

it("manages onboarding session API calls", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body ?? "") });
    return new Response(JSON.stringify({
      session: {
        id: "onboarding_session_1",
        workspaceId: "workspace_a",
        ownerProfileId: "profile_owner",
        status: "in_progress",
        currentStep: "identity",
        companyName: "Estudio Norte",
        segment: "Outro",
        customSegment: "Agencia de conteudo",
        normalizedSegment: "Agencia de conteudo",
        teamSizeRange: "6-15",
        goals: ["organize_team"],
        mainAnswers: [],
        attachments: [],
        diagnosis: null,
        followupQuestions: [],
        followupAnswers: [],
        generatedSuggestion: null,
        reviewDecisions: [],
        activationPlan: [],
        createdSetupSummary: null,
        aiRunIds: [],
        createdAt: "2026-07-08T10:00:00.000Z",
        updatedAt: "2026-07-08T10:00:00.000Z",
        completedAt: null
      }
    }), { status: url.includes("complete") || url.includes("generate") || url.includes("diagnosis") ? 201 : 200 });
  });

  await getOnboardingSession("dono", fetcher);
  await patchOnboardingSession("dono", { companyName: "Estudio Norte", goals: ["organize_team"] }, fetcher);
  await generateOnboardingDiagnosis("dono", fetcher);
  await saveOnboardingFollowupAnswer("dono", { questionId: "q1", question: "Quem aprova?", answer: "Marina", inputMode: "text" }, fetcher);
  await generateOnboardingSetup("dono", fetcher);
  await completeOnboardingSession("dono", fetcher);
  await skipOnboardingSession("dono", fetcher);

  expect(calls.map((call) => call.url)).toEqual([
    "/api/onboarding/session",
    "/api/onboarding/session",
    "/api/onboarding/session/diagnosis",
    "/api/onboarding/session/followup-answer",
    "/api/onboarding/session/generate-setup",
    "/api/onboarding/session/complete",
    "/api/onboarding/session/skip"
  ]);
  expect(JSON.parse(calls[1]!.body)).toMatchObject({
    company_name: "Estudio Norte",
    goals: ["organize_team"]
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm --filter @prymeira/baase-web test src/api.test.ts
```

Expected: fail because helper exports are missing.

- [ ] **Step 3: Add web types and helpers**

Modify `apps/web/src/api.ts` with exported types:

```ts
export type OnboardingSessionStatus = "not_started" | "in_progress" | "diagnosis_ready" | "followup" | "generating_setup" | "reviewing" | "completed" | "skipped";
export type OnboardingAnswer = {
  questionId: string;
  theme: string;
  question: string;
  answer: string;
  inputMode: "text" | "audio";
};
export type OnboardingSession = {
  id: string;
  workspaceId: string;
  ownerProfileId: string;
  status: OnboardingSessionStatus;
  currentStep: string;
  companyName: string | null;
  segment: string | null;
  customSegment: string | null;
  normalizedSegment: string | null;
  teamSizeRange: string | null;
  goals: string[];
  mainAnswers: OnboardingAnswer[];
  attachments: Array<{ id: string; name: string; mimeType: string; extractedText: string; size: number }>;
  diagnosis: unknown | null;
  followupQuestions: Array<{ id: string; question: string; reason: string; expectedUse: string; priority: number }>;
  followupAnswers: OnboardingAnswer[];
  generatedSuggestion: OnboardingSuggestion | null;
  reviewDecisions: Array<{ itemType: string; itemId: string; action: string; editedPayload: Record<string, unknown> | null }>;
  activationPlan: Array<{ day: number; title: string; objective: string; action: string }>;
  createdSetupSummary: Record<string, number> | null;
  aiRunIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
```

Add normalizer:

```ts
function normalizeOnboardingSession(raw: any): OnboardingSession {
  return {
    ...raw,
    workspaceId: raw.workspaceId ?? raw.workspace_id,
    ownerProfileId: raw.ownerProfileId ?? raw.owner_profile_id,
    currentStep: raw.currentStep ?? raw.current_step,
    companyName: raw.companyName ?? raw.company_name,
    customSegment: raw.customSegment ?? raw.custom_segment,
    normalizedSegment: raw.normalizedSegment ?? raw.normalized_segment,
    teamSizeRange: raw.teamSizeRange ?? raw.team_size_range,
    mainAnswers: raw.mainAnswers ?? raw.main_answers ?? [],
    followupQuestions: raw.followupQuestions ?? raw.followup_questions ?? [],
    followupAnswers: raw.followupAnswers ?? raw.followup_answers ?? [],
    generatedSuggestion: raw.generatedSuggestion ?? raw.generated_suggestion ?? null,
    reviewDecisions: raw.reviewDecisions ?? raw.review_decisions ?? [],
    activationPlan: raw.activationPlan ?? raw.activation_plan ?? [],
    createdSetupSummary: raw.createdSetupSummary ?? raw.created_setup_summary ?? null,
    aiRunIds: raw.aiRunIds ?? raw.ai_run_ids ?? [],
    createdAt: raw.createdAt ?? raw.created_at,
    updatedAt: raw.updatedAt ?? raw.updated_at,
    completedAt: raw.completedAt ?? raw.completed_at
  };
}
```

Add helpers:

```ts
export async function getOnboardingSession(role: UiRole, fetcher: Fetcher = fetch) {
  const result = await readJson<{ session: unknown | null }>(fetcher, "/api/onboarding/session", {
    headers: createBaaseHeaders(role)
  });
  return result.session ? normalizeOnboardingSession(result.session) : null;
}

export async function patchOnboardingSession(role: UiRole, input: {
  currentStep?: string;
  companyName?: string | null;
  segment?: string | null;
  customSegment?: string | null;
  normalizedSegment?: string | null;
  teamSizeRange?: string | null;
  goals?: string[];
  mainAnswers?: OnboardingAnswer[];
}, fetcher: Fetcher = fetch) {
  const result = await readJson<{ session: unknown }>(fetcher, "/api/onboarding/session", {
    method: "PATCH",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      current_step: input.currentStep,
      company_name: input.companyName,
      segment: input.segment,
      custom_segment: input.customSegment,
      normalized_segment: input.normalizedSegment,
      team_size_range: input.teamSizeRange,
      goals: input.goals,
      main_answers: input.mainAnswers?.map((answer) => ({
        question_id: answer.questionId,
        theme: answer.theme,
        question: answer.question,
        answer: answer.answer,
        input_mode: answer.inputMode
      }))
    })
  });
  return normalizeOnboardingSession(result.session);
}

export async function generateOnboardingDiagnosis(role: UiRole, fetcher: Fetcher = fetch) {
  const result = await readJson<{ session: unknown }>(fetcher, "/api/onboarding/session/diagnosis", {
    method: "POST",
    headers: createBaaseHeaders(role)
  });
  return normalizeOnboardingSession(result.session);
}

export async function saveOnboardingFollowupAnswer(role: UiRole, input: {
  questionId: string;
  question: string;
  answer: string;
  inputMode: "text" | "audio";
}, fetcher: Fetcher = fetch) {
  const result = await readJson<{ session: unknown }>(fetcher, "/api/onboarding/session/followup-answer", {
    method: "POST",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      question_id: input.questionId,
      question: input.question,
      answer: input.answer,
      input_mode: input.inputMode
    })
  });
  return normalizeOnboardingSession(result.session);
}

export async function generateOnboardingSetup(role: UiRole, fetcher: Fetcher = fetch) {
  const result = await readJson<{ session: unknown }>(fetcher, "/api/onboarding/session/generate-setup", {
    method: "POST",
    headers: createBaaseHeaders(role)
  });
  return normalizeOnboardingSession(result.session);
}

export async function completeOnboardingSession(role: UiRole, fetcher: Fetcher = fetch) {
  const result = await readJson<{ session: unknown }>(fetcher, "/api/onboarding/session/complete", {
    method: "POST",
    headers: createBaaseHeaders(role)
  });
  return normalizeOnboardingSession(result.session);
}

export async function skipOnboardingSession(role: UiRole, fetcher: Fetcher = fetch) {
  const result = await readJson<{ session: unknown }>(fetcher, "/api/onboarding/session/skip", {
    method: "POST",
    headers: createBaaseHeaders(role)
  });
  return normalizeOnboardingSession(result.session);
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @prymeira/baase-web test src/api.test.ts
pnpm --filter @prymeira/baase-web typecheck
```

Expected: pass.

- [ ] **Step 5: Checkpoint**

Record: "Web onboarding API helpers complete."

---

## Task 7: Full-Screen Onboarding Gate And Initial Steps

**Files:**
- Create: `apps/web/src/onboarding.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write failing UI tests for owner gate and skip**

Append to `apps/web/src/App.test.tsx`:

```tsx
it("opens the full-screen onboarding for a new owner workspace and can skip it", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/me") {
      return new Response(JSON.stringify({
        workspace: { id: "workspace_new", name: "Nova Empresa" },
        profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" },
        home_route: "/painel"
      }), { status: 200 });
    }
    if (url === "/api/onboarding/session" && !init?.method) {
      return new Response(JSON.stringify({ session: null }), { status: 200 });
    }
    if (url === "/api/areas") return new Response(JSON.stringify({ areas: [] }), { status: 200 });
    if (url === "/api/processes") return new Response(JSON.stringify({ processes: [] }), { status: 200 });
    if (url === "/api/routines") return new Response(JSON.stringify({ routines: [] }), { status: 200 });
    if (url === "/api/people") return new Response(JSON.stringify({ people: [] }), { status: 200 });
    if (url === "/api/onboarding/session/skip") {
      return new Response(JSON.stringify({
        session: { id: "onboarding_session_1", status: "skipped", currentStep: "skipped", workspaceId: "workspace_new", ownerProfileId: "profile_owner", goals: [], mainAnswers: [], attachments: [], diagnosis: null, followupQuestions: [], followupAnswers: [], generatedSuggestion: null, reviewDecisions: [], activationPlan: [], createdSetupSummary: null, aiRunIds: [], createdAt: "2026-07-08T10:00:00.000Z", updatedAt: "2026-07-08T10:00:00.000Z", completedAt: null }
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ tasks: [], approvals: [], trainings: [], role_templates: [], invites: [], templates: [], filters: { segments: [], areas: [], kinds: [] }, suggestions: [] }), { status: 200 });
  });

  render(<App />);

  expect(await screen.findByRole("heading", { name: /Vamos montar a primeira versão operacional/ })).toBeInTheDocument();
  expect(screen.queryByText("Painel")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Configurar depois/ }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/onboarding/session/skip", expect.objectContaining({ method: "POST" })));
  expect(await screen.findByText(/Monte sua empresa com IA/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm --filter @prymeira/baase-web test src/App.test.tsx
```

Expected: fail because gate/shell are missing.

- [ ] **Step 3: Create onboarding shell initial components**

Create `apps/web/src/onboarding.tsx`:

```tsx
import type { OnboardingAnswer, OnboardingSession } from "./api";

export const onboardingSegments = ["Agencia de marketing", "Servicos locais", "Clinica", "Restaurante", "Loja / varejo", "E-commerce", "Consultoria", "Outro"];
export const teamSizeRanges = [
  { id: "solo", label: "So eu" },
  { id: "2-5", label: "2 a 5 pessoas" },
  { id: "6-15", label: "6 a 15 pessoas" },
  { id: "16-40", label: "16 a 40 pessoas" },
  { id: "40+", label: "Mais de 40 pessoas" }
];
export const onboardingGoals = [
  { id: "extract_owner_knowledge", label: "Tirar processos da minha cabeca" },
  { id: "organize_team", label: "Organizar a equipe" },
  { id: "reduce_delays", label: "Reduzir atrasos e esquecimentos" },
  { id: "train_team", label: "Treinar funcionarios melhor" },
  { id: "control_operation", label: "Ter mais controle da operacao" },
  { id: "scale_company", label: "Preparar a empresa para escalar" },
  { id: "improve_approvals", label: "Melhorar aprovacoes e qualidade" },
  { id: "reduce_whatsapp_dependency", label: "Parar de depender do WhatsApp para cobrar tarefas" }
];

export type OnboardingDraftState = {
  companyName: string;
  segment: string;
  customSegment: string;
  teamSizeRange: string;
  goals: string[];
  answers: OnboardingAnswer[];
};

export function OnboardingShell({
  session,
  draft,
  onPatch,
  onSkip
}: {
  session: OnboardingSession | null;
  draft: OnboardingDraftState;
  onPatch: (patch: Partial<OnboardingDraftState> & { currentStep?: string }) => void;
  onSkip: () => void;
}) {
  const normalizedSegment = draft.segment === "Outro" ? draft.customSegment : draft.segment;
  const canContinue = draft.companyName.trim().length > 1 && normalizedSegment.trim().length > 1 && draft.teamSizeRange.length > 0;

  function toggleGoal(goalId: string) {
    onPatch({
      goals: draft.goals.includes(goalId)
        ? draft.goals.filter((item) => item !== goalId)
        : [...draft.goals, goalId]
    });
  }

  return (
    <main className="onboarding-shell" aria-label="Onboarding Inteligente">
      <section className="onboarding-hero">
        <div className="onboarding-brand"><span>b</span><small>Prymeira Baase</small></div>
        <p className="mono">Configuração inicial</p>
        <h1>Vamos montar a primeira versão operacional da sua empresa.</h1>
        <p>Responda com calma. A IA transforma suas respostas em mapa, processos, rotinas e treinamentos revisáveis.</p>
      </section>
      <section className="onboarding-panel">
        <div className="onboarding-progress"><span className="active" /><span /><span /><span /></div>
        <label>
          Nome da empresa
          <input value={draft.companyName} onChange={(event) => onPatch({ companyName: event.target.value, currentStep: "identity" })} placeholder="Ex.: Estúdio Norte" />
        </label>
        <div>
          <strong>Segmento</strong>
          <div className="onboarding-choice-grid">
            {onboardingSegments.map((segment) => (
              <button className={draft.segment === segment ? "active" : ""} type="button" onClick={() => onPatch({ segment, currentStep: "identity" })} key={segment}>{segment}</button>
            ))}
          </div>
        </div>
        {draft.segment === "Outro" ? (
          <label>
            Qual é o segmento?
            <input value={draft.customSegment} onChange={(event) => onPatch({ customSegment: event.target.value, currentStep: "identity" })} placeholder="Ex.: instalação de energia solar" />
          </label>
        ) : null}
        <div>
          <strong>Tamanho da equipe</strong>
          <div className="onboarding-choice-grid compact">
            {teamSizeRanges.map((range) => (
              <button className={draft.teamSizeRange === range.id ? "active" : ""} type="button" onClick={() => onPatch({ teamSizeRange: range.id, currentStep: "identity" })} key={range.id}>{range.label}</button>
            ))}
          </div>
        </div>
        <div>
          <strong>O que você quer resolver primeiro?</strong>
          <div className="onboarding-choice-grid">
            {onboardingGoals.map((goal) => (
              <button className={draft.goals.includes(goal.id) ? "active" : ""} type="button" onClick={() => toggleGoal(goal.id)} key={goal.id}>{goal.label}</button>
            ))}
          </div>
        </div>
        <footer>
          <button className="ghost-btn" type="button" onClick={onSkip}>Configurar depois</button>
          <button className="accent-solid" type="button" disabled={!canContinue} onClick={() => onPatch({ currentStep: "conversation" })}>Continuar</button>
        </footer>
        {session?.updatedAt ? <small className="onboarding-save mono">Salvo</small> : null}
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Gate in App**

Modify imports in `apps/web/src/App.tsx`:

```ts
import { OnboardingShell, type OnboardingDraftState } from "./onboarding";
import { getOnboardingSession, patchOnboardingSession, skipOnboardingSession, type OnboardingSession } from "./api";
```

Add state:

```ts
const [onboardingSession, setOnboardingSession] = useState<OnboardingSession | null>(null);
const [onboardingDraft, setOnboardingDraft] = useState<OnboardingDraftState>({
  companyName: "",
  segment: "Agencia de marketing",
  customSegment: "",
  teamSizeRange: "",
  goals: [],
  answers: []
});
```

After workspace load, fetch onboarding session:

```ts
getOnboardingSession(role).then(setOnboardingSession).catch(() => setOnboardingSession(null));
```

Add derived gate:

```ts
const workspaceIsEmpty = visibleAreas.length === 0 && visibleProcesses.length === 0 && visibleRoutines.length === 0 && visiblePeople.length === 0;
const shouldShowFirstRunOnboarding = role === "dono" && workspaceIsEmpty && onboardingSession?.status !== "completed" && onboardingSession?.status !== "skipped";
```

Add handlers:

```ts
function patchOnboardingDraft(patch: Partial<OnboardingDraftState> & { currentStep?: string }) {
  const next = { ...onboardingDraft, ...patch };
  setOnboardingDraft(next);
  void patchOnboardingSession(role, {
    currentStep: patch.currentStep,
    companyName: next.companyName,
    segment: next.segment,
    customSegment: next.customSegment,
    normalizedSegment: next.segment === "Outro" ? next.customSegment : next.segment,
    teamSizeRange: next.teamSizeRange,
    goals: next.goals,
    mainAnswers: next.answers
  }).then(setOnboardingSession).catch(() => showNotice("Nao conseguimos salvar o onboarding agora."));
}

function skipOnboarding() {
  void skipOnboardingSession(role).then((session) => {
    setOnboardingSession(session);
    showNotice("Voce pode retomar o onboarding quando quiser.");
  });
}
```

Before normal app shell return:

```tsx
if (shouldShowFirstRunOnboarding) {
  return <OnboardingShell session={onboardingSession} draft={onboardingDraft} onPatch={patchOnboardingDraft} onSkip={skipOnboarding} />;
}
```

When `onboardingSession?.status === "skipped"`, render a dashboard banner with text `Monte sua empresa com IA`.

- [ ] **Step 5: Add CSS**

Add to `apps/web/src/styles.css`:

```css
.onboarding-shell { min-height: 100vh; background: var(--paper); color: var(--ink); display: grid; grid-template-columns: minmax(320px, .9fr) minmax(420px, 1.1fr); }
.onboarding-hero { padding: clamp(28px, 5vw, 72px); display: flex; flex-direction: column; justify-content: center; border-right: 1px solid var(--line); }
.onboarding-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 48px; }
.onboarding-brand span { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; background: var(--ink); color: #fff; font-weight: 800; }
.onboarding-brand small { color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
.onboarding-hero h1 { max-width: 640px; margin: 8px 0 0; font-size: clamp(34px, 5vw, 68px); line-height: .96; font-family: var(--serif); font-weight: 400; }
.onboarding-hero p:not(.mono) { max-width: 520px; color: var(--muted); font-size: 16px; line-height: 1.55; }
.onboarding-panel { align-self: center; justify-self: center; width: min(720px, calc(100% - 44px)); background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 22px; box-shadow: 0 24px 90px -50px rgba(27,26,23,.45); display: grid; gap: 18px; }
.onboarding-panel label, .onboarding-panel strong { display: block; color: var(--muted); font-size: 12.5px; font-weight: 700; }
.onboarding-panel input { width: 100%; margin-top: 7px; border: 1px solid var(--line); background: var(--panel2); border-radius: 11px; padding: 12px 13px; color: var(--ink); }
.onboarding-choice-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 9px; }
.onboarding-choice-grid button { border: 1px solid var(--line); background: var(--panel2); color: var(--muted); border-radius: 999px; padding: 9px 12px; font-weight: 700; }
.onboarding-choice-grid button.active { background: var(--ink); color: #fff; border-color: var(--ink); }
.onboarding-progress { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.onboarding-progress span { height: 6px; border-radius: 999px; background: var(--line2); }
.onboarding-progress span.active { background: var(--ink); }
.onboarding-panel footer { display: flex; justify-content: space-between; gap: 10px; padding-top: 8px; }
.ghost-btn { border: 0; background: transparent; color: var(--faint); font-weight: 700; }
.onboarding-save { color: var(--faint); justify-self: end; }
@media (max-width: 900px) {
  .onboarding-shell { grid-template-columns: 1fr; }
  .onboarding-hero { border-right: 0; border-bottom: 1px solid var(--line); padding-bottom: 28px; }
  .onboarding-panel { margin: 22px 0 44px; width: min(720px, calc(100% - 28px)); }
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @prymeira/baase-web test src/App.test.tsx
pnpm --filter @prymeira/baase-web typecheck
```

Expected: pass.

- [ ] **Step 7: Checkpoint**

Record: "Full-screen onboarding gate and identity step complete."

---

## Task 8: Guided Conversation, Audio Answers, Diagnosis, And Follow-Ups

**Files:**
- Modify: `apps/web/src/onboarding.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write failing guided conversation test**

Append to `apps/web/src/App.test.tsx`:

```tsx
it("saves onboarding answers, generates diagnosis, answers follow-up, and generates setup", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/me") return new Response(JSON.stringify({ workspace: { id: "workspace_new", name: "Nova Empresa" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" }), { status: 200 });
    if (url === "/api/onboarding/session" && !init?.method) return new Response(JSON.stringify({ session: null }), { status: 200 });
    if (url === "/api/onboarding/session" && init?.method === "PATCH") return new Response(JSON.stringify({ session: onboardingSessionFixture("in_progress") }), { status: 200 });
    if (url === "/api/onboarding/session/diagnosis") return new Response(JSON.stringify({ session: onboardingSessionFixture("diagnosis_ready", { diagnosis: diagnosisFixture(), followupQuestions: diagnosisFixture().followupQuestions }) }), { status: 201 });
    if (url === "/api/onboarding/session/followup-answer") return new Response(JSON.stringify({ session: onboardingSessionFixture("followup", { followupAnswers: [{ questionId: "responsaveis_area", theme: "followup", question: "Quem responde?", answer: "Marina", inputMode: "text" }] }) }), { status: 200 });
    if (url === "/api/onboarding/session/generate-setup") return new Response(JSON.stringify({ session: onboardingSessionFixture("reviewing", { generatedSuggestion: onboardingSuggestionFixture(), activationPlan: onboardingSuggestionFixture().activationPlan }) }), { status: 201 });
    if (["/api/areas", "/api/processes", "/api/routines", "/api/people"].includes(url)) return new Response(JSON.stringify(url.includes("areas") ? { areas: [] } : url.includes("people") ? { people: [] } : url.includes("processes") ? { processes: [] } : { routines: [] }), { status: 200 });
    return new Response(JSON.stringify({ tasks: [], approvals: [], trainings: [], role_templates: [], invites: [], templates: [], filters: { segments: [], areas: [], kinds: [] }, suggestions: [] }), { status: 200 });
  });

  render(<App />);

  fireEvent.change(await screen.findByLabelText("Nome da empresa"), { target: { value: "Estudio Norte" } });
  fireEvent.click(screen.getByRole("button", { name: "6 a 15 pessoas" }));
  fireEvent.click(screen.getByRole("button", { name: "Organizar a equipe" }));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

  fireEvent.change(await screen.findByLabelText(/O que sua empresa vende/), { target: { value: "Marketing recorrente para pequenos negocios." } });
  fireEvent.change(screen.getByLabelText(/Quem faz parte da equipe/), { target: { value: "Marina coordena e Bruno cria." } });
  fireEvent.change(screen.getByLabelText(/O que mais atrasa/), { target: { value: "Aprovacao e cobrança por WhatsApp." } });
  fireEvent.click(screen.getByRole("button", { name: /Entender minha empresa/ }));

  expect(await screen.findByRole("heading", { name: "Entendi sua empresa" })).toBeInTheDocument();
  expect(screen.getByText(/Tenho 2 perguntas rápidas/)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/Quem responde por cada area/), { target: { value: "Marina" } });
  fireEvent.click(screen.getByRole("button", { name: /Responder e continuar/ }));
  fireEvent.click(screen.getByRole("button", { name: /Gerar primeira versão da empresa/ }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/onboarding/session/generate-setup", expect.objectContaining({ method: "POST" })));
  expect(await screen.findByRole("heading", { name: /Revise sua primeira versão operacional/ })).toBeInTheDocument();
});
```

Add fixture helpers inside the test file:

```tsx
function diagnosisFixture() {
  return {
    companyName: "Estudio Norte",
    normalizedSegment: "Agencia de marketing",
    confidence: "medium",
    operationalSummary: "Operacao de marketing recorrente com gargalo de aprovacao.",
    businessModel: "Servico recorrente",
    customerProfile: "Pequenos negocios",
    deliveryModel: "Atendimento, criacao e aprovacao",
    detectedAreas: [{ id: "area_operacoes", name: "Operacoes", description: "Entrega diaria.", source: "inferred", reason: "Citada na resposta." }],
    detectedPeople: [{ id: "person_marina", name: "Marina", roleHint: "Gestora", areaName: "Operacoes", source: "user_provided" }],
    bottlenecks: [{ id: "bottleneck_aprovacao", title: "Aprovacao atrasada", description: "Entregas param esperando ok.", severity: "high", source: "user_provided" }],
    assumptions: [],
    followupQuestions: [{ id: "responsaveis_area", question: "Quem responde por cada area no dia a dia?", reason: "Define cargos.", expectedUse: "people", priority: 1 }]
  };
}
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm --filter @prymeira/baase-web test src/App.test.tsx
```

Expected: fail because conversation/diagnosis UI is missing.

- [ ] **Step 3: Extend OnboardingShell with step rendering**

In `apps/web/src/onboarding.tsx`, add props:

```ts
onGenerateDiagnosis: () => void;
onSaveFollowup: (input: { questionId: string; question: string; answer: string; inputMode: "text" | "audio" }) => void;
onGenerateSetup: () => void;
actionBusy: boolean;
```

Render by `draft.currentStep` or `session?.currentStep`:

- `identity`: existing identity panel.
- `conversation`: render three textarea blocks.
- `diagnosis`: render diagnosis summary and follow-up question.
- `generating_setup`: render generation step panel.
- `review_map`: render initial review heading.

Use questions:

```ts
const onboardingConversationQuestions = [
  { id: "operations_overview", theme: "business_model", label: "O que sua empresa vende, para quem vende e como normalmente acontece a entrega?" },
  { id: "people_responsibilities", theme: "team_structure", label: "Quem faz parte da equipe hoje e o que cada pessoa costuma cuidar?" },
  { id: "bottlenecks_standards", theme: "operational_bottlenecks", label: "O que mais atrasa, se perde, depende de voce ou precisa virar padrao para a equipe executar melhor?" }
];
```

- [ ] **Step 4: Add App handlers**

Import helpers:

```ts
generateOnboardingDiagnosis,
generateOnboardingSetup,
saveOnboardingFollowupAnswer
```

Add handlers:

```ts
function generateOnboardingDiagnosisFromDraft() {
  void runAction(async () => {
    const session = await generateOnboardingDiagnosis(role);
    setOnboardingSession(session);
    patchOnboardingDraft({ currentStep: "diagnosis" });
  });
}

function saveOnboardingFollowup(input: { questionId: string; question: string; answer: string; inputMode: "text" | "audio" }) {
  void runAction(async () => {
    const session = await saveOnboardingFollowupAnswer(role, input);
    setOnboardingSession(session);
  });
}

function generateOnboardingSetupFromSession() {
  void runAction(async () => {
    setOnboardingSession((current) => current ? { ...current, status: "generating_setup", currentStep: "generating_setup" } : current);
    const session = await generateOnboardingSetup(role);
    setOnboardingSession(session);
  });
}
```

- [ ] **Step 5: Add conversation CSS**

Add classes:

```css
.onboarding-conversation { display: grid; gap: 14px; }
.onboarding-question { border: 1px solid var(--line); border-radius: 13px; background: var(--panel2); padding: 14px; }
.onboarding-question textarea { width: 100%; min-height: 110px; margin-top: 8px; border: 0; outline: 0; resize: vertical; background: transparent; color: var(--ink); font-size: 14px; line-height: 1.45; }
.onboarding-diagnosis-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.onboarding-diagnosis-card { border: 1px solid var(--line); border-radius: 13px; background: var(--panel2); padding: 13px; }
.onboarding-generation { display: grid; gap: 10px; }
.onboarding-generation span { display: flex; align-items: center; gap: 8px; color: var(--muted); font-weight: 700; }
@media (max-width: 700px) { .onboarding-diagnosis-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @prymeira/baase-web test src/App.test.tsx
pnpm --filter @prymeira/baase-web typecheck
```

Expected: pass.

- [ ] **Step 7: Checkpoint**

Record: "Guided conversation, diagnosis, follow-up, and generation UI complete."

---

## Task 9: Review Wizard, Drawer Editing, Decisions, And Completion

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/onboarding.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/api.test.ts`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Add failing review decision API test**

Append to `apps/web/src/api.test.ts`:

```ts
import { saveOnboardingReviewDecision } from "./api";

it("saves onboarding review decisions", async () => {
  let body = "";
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    body = String(init?.body ?? "");
    return new Response(JSON.stringify({ session: onboardingSessionApiFixture("reviewing") }), { status: 200 });
  });

  await saveOnboardingReviewDecision("dono", {
    itemType: "process",
    itemId: "process_onboarding",
    action: "draft",
    editedPayload: { title: "Onboarding ajustado" }
  }, fetcher);

  expect(JSON.parse(body)).toMatchObject({
    item_type: "process",
    item_id: "process_onboarding",
    action: "draft",
    edited_payload: { title: "Onboarding ajustado" }
  });
});
```

- [ ] **Step 2: Add failing review UI test**

Append to `apps/web/src/App.test.tsx`:

```tsx
it("edits a generated process in review and completes onboarding", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/me") return new Response(JSON.stringify({ workspace: { id: "workspace_new", name: "Nova Empresa" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" }), { status: 200 });
    if (url === "/api/onboarding/session" && !init?.method) return new Response(JSON.stringify({ session: onboardingSessionFixture("reviewing", { generatedSuggestion: onboardingSuggestionFixture(), activationPlan: onboardingSuggestionFixture().activationPlan }) }), { status: 200 });
    if (url === "/api/onboarding/session/review-decision") return new Response(JSON.stringify({ session: onboardingSessionFixture("reviewing", { generatedSuggestion: onboardingSuggestionFixture(), reviewDecisions: [{ itemType: "process", itemId: "process_onboarding", action: "draft", editedPayload: { title: "Onboarding ajustado" } }] }) }), { status: 200 });
    if (url === "/api/onboarding/session/complete") return new Response(JSON.stringify({ session: onboardingSessionFixture("completed", { createdSetupSummary: { areas: 2, roles: 2, people: 1, placeholders: 1, processes: 1, routines: 1, trainings: 1, announcements: 1, invites: 0 } }) }), { status: 201 });
    if (["/api/areas", "/api/processes", "/api/routines", "/api/people"].includes(url)) return new Response(JSON.stringify(url.includes("areas") ? { areas: [] } : url.includes("people") ? { people: [] } : url.includes("processes") ? { processes: [] } : { routines: [] }), { status: 200 });
    return new Response(JSON.stringify({ tasks: [], approvals: [], trainings: [], role_templates: [], invites: [], announcements: [], templates: [], filters: { segments: [], areas: [], kinds: [] }, suggestions: [] }), { status: 200 });
  });

  render(<App />);

  expect(await screen.findByRole("heading", { name: /Revise sua primeira versão operacional/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Processos sugeridos/ }));
  fireEvent.click(screen.getByRole("button", { name: /Editar Onboarding operacional/ }));
  fireEvent.change(await screen.findByLabelText("Titulo do processo"), { target: { value: "Onboarding ajustado" } });
  fireEvent.click(screen.getByRole("button", { name: /Salvar decisão/ }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/onboarding/session/review-decision", expect.objectContaining({ method: "PATCH" })));

  fireEvent.click(screen.getByRole("button", { name: /Criar primeira versão da empresa/ }));
  expect(await screen.findByRole("heading", { name: /A primeira versão operacional da sua empresa está pronta/ })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm --filter @prymeira/baase-web test src/api.test.ts src/App.test.tsx
```

Expected: fail because decision helper and review UI are missing.

- [ ] **Step 4: Add review decision helper**

Modify `apps/web/src/api.ts`:

```ts
export async function saveOnboardingReviewDecision(role: UiRole, input: {
  itemType: "area" | "role" | "person" | "process" | "routine" | "training" | "announcement" | "invite";
  itemId: string;
  action: "create" | "remove" | "draft" | "publish" | "activate";
  editedPayload?: Record<string, unknown> | null;
}, fetcher: Fetcher = fetch) {
  const result = await readJson<{ session: unknown }>(fetcher, "/api/onboarding/session/review-decision", {
    method: "PATCH",
    headers: createBaaseHeaders(role),
    body: JSON.stringify({
      item_type: input.itemType,
      item_id: input.itemId,
      action: input.action,
      edited_payload: input.editedPayload ?? null
    })
  });
  return normalizeOnboardingSession(result.session);
}
```

- [ ] **Step 5: Add review wizard UI**

In `apps/web/src/onboarding.tsx`, add:

```tsx
const reviewSteps = [
  { id: "map", label: "Mapa da empresa" },
  { id: "people", label: "Pessoas e cargos" },
  { id: "processes", label: "Processos sugeridos" },
  { id: "routines", label: "Rotinas sugeridas" },
  { id: "trainings", label: "Treinamentos sugeridos" },
  { id: "activation", label: "Convites e ativação" }
];
```

Add `ReviewWizard` component that:

- renders tabs for all steps;
- lists items from `session.generatedSuggestion`;
- shows reason, basedOn, expectedImpact;
- has edit/remove/draft/publish/activate buttons;
- opens `ReviewDrawer` with type-specific form;
- calls `onSaveDecision`.

Use button labels matching tests:

```tsx
<button type="button" onClick={() => setActiveStep("processes")}>Processos sugeridos</button>
<button type="button" aria-label={`Editar ${process.title}`}>Editar {process.title}</button>
```

- [ ] **Step 6: Add completion handler in App**

Import:

```ts
completeOnboardingSession,
saveOnboardingReviewDecision
```

Add:

```ts
function saveReviewDecision(input: Parameters<typeof saveOnboardingReviewDecision>[1]) {
  void runAction(async () => {
    const session = await saveOnboardingReviewDecision(role, input);
    setOnboardingSession(session);
  });
}

function completeOnboarding() {
  void runAction(async () => {
    const session = await completeOnboardingSession(role);
    setOnboardingSession(session);
  });
}
```

Pass to `OnboardingShell`.

- [ ] **Step 7: Add review CSS**

Add:

```css
.onboarding-review { min-height: 100vh; background: var(--paper); padding: 28px; }
.review-wizard { max-width: 1180px; margin: 0 auto; display: grid; gap: 18px; }
.review-tabs { display: flex; flex-wrap: wrap; gap: 8px; }
.review-tabs button { border: 1px solid var(--line); background: var(--panel); border-radius: 999px; padding: 9px 12px; color: var(--muted); font-weight: 700; }
.review-tabs button.active { background: var(--ink); color: #fff; border-color: var(--ink); }
.review-item-card { border: 1px solid var(--line); border-radius: 13px; background: var(--panel); padding: 15px; display: grid; gap: 10px; }
.review-item-card footer { display: flex; flex-wrap: wrap; gap: 8px; }
.review-drawer-layer { position: fixed; inset: 0; z-index: 120; background: rgba(27,26,23,.28); display: flex; justify-content: flex-end; }
.review-drawer { width: min(520px, 100%); height: 100%; background: var(--panel); border-left: 1px solid var(--line); padding: 20px; overflow: auto; box-shadow: -24px 0 90px -50px rgba(27,26,23,.65); }
@media (max-width: 720px) { .review-drawer-layer { justify-content: stretch; } .review-drawer { width: 100%; border-left: 0; } }
```

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm --filter @prymeira/baase-web test src/api.test.ts src/App.test.tsx
pnpm --filter @prymeira/baase-web typecheck
```

Expected: pass.

- [ ] **Step 9: Checkpoint**

Record: "Onboarding review wizard, drawer, decisions, and completion screen complete."

---

## Task 10: Final Ready Screen, Skipped CTA, And Dashboard Activation Plan

**Files:**
- Modify: `apps/web/src/onboarding.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write failing final-state tests**

Append to `apps/web/src/App.test.tsx`:

```tsx
it("shows onboarding completion summary and dashboard activation plan after going to panel", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/api/me") return new Response(JSON.stringify({ workspace: { id: "workspace_new", name: "Estudio Norte" }, profile: { id: "profile_owner", role: "owner", display_name: "Marina Alves", initials: "MA" }, home_route: "/painel" }), { status: 200 });
    if (url === "/api/onboarding/session") return new Response(JSON.stringify({ session: onboardingSessionFixture("completed", { createdSetupSummary: { areas: 2, roles: 2, people: 1, placeholders: 1, processes: 1, routines: 1, trainings: 1, announcements: 1, invites: 0 }, activationPlan: onboardingSuggestionFixture().activationPlan }) }), { status: 200 });
    return new Response(JSON.stringify({
      areas: [{ id: "area_1", name: "Operacoes", description: "Entrega.", sortOrder: 1 }],
      processes: [],
      routines: [],
      people: [],
      tasks: [],
      approvals: [],
      trainings: [],
      role_templates: [],
      invites: [],
      announcements: [],
      templates: [],
      filters: { segments: [], areas: [], kinds: [] },
      suggestions: []
    }), { status: 200 });
  });

  render(<App />);

  expect(await screen.findByText(/Plano de 7 dias/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm --filter @prymeira/baase-web test src/App.test.tsx
```

Expected: fail if panel plan/banner is missing.

- [ ] **Step 3: Add final ready component**

In `apps/web/src/onboarding.tsx`, add `CompanyReadyStep`:

```tsx
export function CompanyReadyStep({
  session,
  onGoPanel
}: {
  session: OnboardingSession;
  onGoPanel: () => void;
}) {
  const summary = session.createdSetupSummary;
  return (
    <main className="onboarding-ready">
      <section>
        <p className="mono">Empresa pronta</p>
        <h1>A primeira versão operacional da sua empresa está pronta.</h1>
        <p>Agora você pode revisar os primeiros rascunhos, convidar a equipe e ativar a primeira rotina no seu ritmo.</p>
        {summary ? (
          <div className="ready-stats">
            <span><strong>{summary.areas}</strong> áreas</span>
            <span><strong>{summary.roles}</strong> cargos</span>
            <span><strong>{summary.people + summary.placeholders}</strong> pessoas/placeholders</span>
            <span><strong>{summary.processes}</strong> processos em rascunho</span>
            <span><strong>{summary.routines}</strong> rotinas prontas</span>
            <span><strong>{summary.trainings}</strong> treinamentos</span>
          </div>
        ) : null}
        <footer>
          <button className="secondary-btn" type="button">Revisar processos</button>
          <button className="secondary-btn" type="button">Convidar equipe</button>
          <button className="accent-solid" type="button" onClick={onGoPanel}>Ir para o Painel</button>
        </footer>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Add dashboard activation plan banner**

In `App.tsx` owner dashboard render path, add a panel if `onboardingSession?.activationPlan?.length` and status completed:

```tsx
{onboardingSession?.status === "completed" && onboardingSession.activationPlan.length ? (
  <section className="panel padded activation-plan-panel">
    <PanelHeader title="Plano de 7 dias" aside="Guia inicial" />
    <div className="activation-plan-list">
      {onboardingSession.activationPlan.map((step) => (
        <button type="button" key={step.day}>
          <span className="mono">Dia {step.day}</span>
          <strong>{step.title}</strong>
          <small>{step.objective}</small>
        </button>
      ))}
    </div>
  </section>
) : null}
```

For skipped sessions, add empty-state CTA:

```tsx
{onboardingSession?.status === "skipped" ? (
  <section className="panel padded onboarding-resume-panel">
    <PanelHeader title="Monte sua empresa com IA" aside="Onboarding" />
    <p>Transforme suas respostas em áreas, cargos, processos, rotinas e treinamentos revisáveis.</p>
    <button className="accent-solid" type="button" onClick={() => setOnboardingSession(null)}>Retomar onboarding</button>
  </section>
) : null}
```

- [ ] **Step 5: Add CSS**

Add:

```css
.onboarding-ready { min-height: 100vh; display: grid; place-items: center; background: var(--paper); padding: 28px; }
.onboarding-ready section { max-width: 760px; background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: clamp(24px, 4vw, 44px); box-shadow: 0 26px 90px -52px rgba(27,26,23,.55); }
.onboarding-ready h1 { margin: 6px 0 0; font-family: var(--serif); font-size: clamp(36px, 5vw, 62px); line-height: .98; font-weight: 400; }
.ready-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 24px 0; }
.ready-stats span { border: 1px solid var(--line); background: var(--panel2); border-radius: 12px; padding: 12px; color: var(--muted); }
.ready-stats strong { display: block; color: var(--ink); font-size: 24px; }
.activation-plan-list { display: grid; gap: 8px; }
.activation-plan-list button { text-align: left; border: 1px solid var(--line); background: var(--panel2); border-radius: 11px; padding: 12px; color: var(--ink); }
.activation-plan-list small { display: block; color: var(--muted); margin-top: 3px; }
@media (max-width: 720px) { .ready-stats { grid-template-columns: 1fr; } }
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @prymeira/baase-web test src/App.test.tsx
pnpm --filter @prymeira/baase-web typecheck
pnpm --filter @prymeira/baase-web build
```

Expected: pass.

- [ ] **Step 7: Checkpoint**

Record: "Ready screen, skipped CTA, and dashboard activation plan complete."

---

## Task 11: End-To-End Verification And Regression Pass

**Files:**
- Modify only files touched by previous tasks when tests reveal failures.

- [ ] **Step 1: Run full API tests**

Run:

```bash
pnpm --filter @prymeira/baase-api test
```

Expected: all API tests pass.

- [ ] **Step 2: Run full web tests**

Run:

```bash
pnpm --filter @prymeira/baase-web test
```

Expected: all web tests pass.

- [ ] **Step 3: Run workspace typecheck**

Run:

```bash
pnpm typecheck
```

Expected: shared, api, and web typechecks pass.

- [ ] **Step 4: Run production build**

Run:

```bash
pnpm --filter @prymeira/baase-web build
pnpm --filter @prymeira/baase-api build
```

Expected: both builds pass.

- [ ] **Step 5: Run local app smoke test**

Start the app:

```bash
pnpm --filter @prymeira/baase-api dev
pnpm --filter @prymeira/baase-web dev
```

Manual smoke path:

1. Open web app.
2. Confirm new empty owner workspace opens full-screen onboarding.
3. Fill company name, segment, team size, and goals.
4. Fill the three conversation answers.
5. Generate diagnosis.
6. Answer or skip follow-up.
7. Generate setup.
8. Edit one process in the drawer.
9. Complete onboarding.
10. Confirm ready screen.
11. Go to dashboard and confirm activation plan.

- [ ] **Step 6: Final checkpoint**

Record:

```txt
Onboarding Inteligente V1 implemented and verified.
```

## Self Review

Spec coverage:

- Mandatory empty-owner onboarding: Task 7.
- Skip and resume CTA: Tasks 7 and 10.
- Company name, segment, custom segment, team size, goals: Tasks 2, 6, 7.
- Three guided blocks: Task 8.
- Audio path remains through existing `transcribeAudioBlob`; UI hook is included in Task 8 and can reuse the current audio components.
- Diagnosis before setup: Tasks 3 and 8.
- Up to 3 follow-up questions: Tasks 3, 4, 8.
- Premium generation steps: Task 8.
- Review wizard and drawer: Task 9.
- Completion creates base and drafts: Task 5.
- Placeholders: Task 5.
- Announcement and activation plan: Tasks 4, 5, 10.
- Autosave: Tasks 2, 6, 7, 8, 9.
- Tests and verification: Tasks 1 through 11.

Placeholder scan:

- No prohibited placeholder markers or unspecified implementation steps are intentionally left.
- The plan gives exact files, route names, types, commands, and expected outcomes.

Type consistency:

- Backend uses camelCase internally and snake_case over HTTP.
- Web normalizes snake_case session responses to camelCase.
- `OnboardingSession`, `OnboardingDiagnosis`, `OnboardingSetupSuggestion`, and `OnboardingReviewDecision` names match across tasks.
