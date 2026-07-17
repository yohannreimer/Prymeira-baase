# Owner Studio Continuous Rituals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform each owner ritual into a continuous, dated history with configurable AI support that never blocks or overwrites the owner's original answers.

**Architecture:** Store the chosen support mode on the ritual and snapshot it on every session. Separate human-answer concurrency from background AI state, add immutable answer revisions and structured ritual suggestions, then expose a ritual-detail API consumed by a calm timeline UI. AI preparation and analysis run as background enhancements; `record_only` completes without invoking AI.

**Tech Stack:** TypeScript 5.8, React 19, Vite, Fastify 5, Zod 4, PostgreSQL 16, Vitest, Testing Library, Playwright, existing Baase AI harness and Studio repositories.

---

## Delivery boundaries

This is one vertical product capability, delivered in four independently testable milestones:

1. **Grounded daily ritual:** configurable support mode, answer-only revision, non-blocking completion.
2. **Continuous history:** dated occurrence model, timeline, completed-answer editing and versions.
3. **Intentional intelligence:** asynchronous summary/reflection, retroactive analysis and actionable suggestions.
4. **Review tools:** period filters, comparison, materials, accessibility and full browser verification.

Do not add employee/shared rituals, streaks, rankings, automatic operational tasks or a ritual analytics dashboard.

## File map

### Shared contract

- Modify `packages/shared/src/studio-structures.ts` — persisted ritual support-mode vocabulary and labels.
- Modify `packages/shared/src/studio-structures.test.ts` — contract stability assertions.

### API domain and persistence

- Modify `apps/api/src/modules/studio/studio.types.ts` — ritual mode, occurrence, answer-revision, version, suggestion and material-link types.
- Modify `apps/api/src/modules/studio/studio.schemas.ts` — request/query validation.
- Modify `apps/api/src/db/operational-schema.ts` — migration 32 for continuous rituals.
- Modify `apps/api/src/db/operational-schema.test.ts` — SQL contract assertions.
- Modify `apps/api/src/db/operational-schema.postgres.test.ts` — real PostgreSQL constraints and indexes.
- Modify `apps/api/src/modules/studio/postgres-studio.repository.ts` — atomic occurrence start, answer-only updates, versions, suggestions and filtered history.
- Modify `apps/api/src/modules/studio/in-memory-studio.repository.ts` — behaviorally identical test repository.
- Modify `apps/api/src/modules/studio/studio.repository.test.ts` — repository contract suite.

### API services and routes

- Modify `apps/api/src/modules/studio/studio-ritual.service.ts` — support-mode policy, completion, editing, analysis queue and suggestion decisions.
- Modify `apps/api/src/modules/studio/studio-ritual.service.test.ts` — TDD service coverage.
- Modify `apps/api/src/modules/studio/studio.routes.ts` — detail/history/edit/analyze/suggestion/material endpoints.
- Modify `apps/api/src/modules/studio/studio-ritual.routes.test.ts` — HTTP contracts and error mapping.
- Modify `apps/api/src/modules/studio/studio-maintenance-runner.ts` — background ritual analysis claim.
- Modify `apps/api/src/modules/studio/studio-maintenance-runner.test.ts` — background processing coverage.
- Modify `apps/api/src/modules/ai/prompt-registry.ts` — distinct light-summary and reflection instructions.
- Modify `apps/api/src/modules/ai/schema-registry.ts` — structured insight output.
- Modify `apps/api/src/modules/ai/ai.types.ts` — task-kind vocabulary.
- Modify `apps/api/src/modules/ai/ai-registries.test.ts` — registry agreement.

### Web application

- Modify `apps/web/src/studio/studio.types.ts` — mapped ritual-detail domain types.
- Modify `apps/web/src/studio/studio-api.ts` — new API calls and mappings.
- Modify `apps/web/src/studio/studio-api.test.ts` — serialization and mapping tests.
- Modify `apps/web/src/studio/StudioRituals.tsx` — route-level state and composition only.
- Create `apps/web/src/studio/StudioRitualBuilder.tsx` — ritual creation/editing and support-mode choice.
- Create `apps/web/src/studio/StudioRitualDetail.tsx` — next execution, timeline, filters and comparison entry point.
- Create `apps/web/src/studio/StudioRitualRunner.tsx` — question flow, local durability and answer-only concurrency.
- Create `apps/web/src/studio/StudioRitualHistory.tsx` — history cards, versions, analysis and suggestions.
- Modify `apps/web/src/studio/StudioRituals.test.tsx` — route and integration behavior.
- Modify `apps/web/src/studio/studio.css` — Quiet Ops layout, states and responsive rules.

### End-to-end and operations

- Modify `tests/e2e/owner-studio-server.ts` — deterministic AI outputs for both assisted modes.
- Modify `tests/e2e/owner-studio.spec.ts` — daily, weekly, monthly, history, conflict and failure journeys.
- Create `docs/qa/2026-07-17-owner-studio-continuous-rituals.md` — manual production verification matrix.
- Modify `docs/operations/owner-studio.md` — runtime behavior and troubleshooting.

---

### Task 1: Add the stable ritual support-mode contract

**Files:**
- Modify: `packages/shared/src/studio-structures.ts:48-61`
- Modify: `packages/shared/src/studio-structures.test.ts`
- Modify: `apps/api/src/modules/studio/studio.schemas.ts:188-194`

- [ ] **Step 1: Write the failing shared-contract test**

```ts
expect(STUDIO_STRUCTURE_CONTRACT.ritual.properties.supportMode).toEqual({
  key: "support_mode",
  label: "Apoio da IA"
});
expect(STUDIO_RITUAL_SUPPORT_MODES).toEqual([
  "record_only",
  "light_summary",
  "guided_reflection"
]);
```

- [ ] **Step 2: Run the focused test and verify the missing exports**

Run: `pnpm --filter @prymeira/baase-shared test -- studio-structures.test.ts`

Expected: FAIL because `supportMode` and `STUDIO_RITUAL_SUPPORT_MODES` do not exist.

- [ ] **Step 3: Add the shared vocabulary**

```ts
export const STUDIO_RITUAL_SUPPORT_MODES = Object.freeze([
  "record_only",
  "light_summary",
  "guided_reflection"
] as const);

export type StudioRitualSupportMode = typeof STUDIO_RITUAL_SUPPORT_MODES[number];
```

Add `supportMode: field("support_mode", "Apoio da IA")` to the ritual properties contract.

- [ ] **Step 4: Validate the persisted property in the API**

Import `STUDIO_RITUAL_SUPPORT_MODES` and add this property to `ritualPropertiesSchema`:

```ts
[ritualFields.supportMode.key]: z.enum(STUDIO_RITUAL_SUPPORT_MODES).optional()
```

Keep the property optional for legacy rituals; service code will derive the default from cadence.

- [ ] **Step 5: Run contract and schema tests**

Run: `pnpm --filter @prymeira/baase-shared test && pnpm --filter @prymeira/baase-api test -- studio.schemas.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the contract**

```bash
git add packages/shared/src/studio-structures.ts packages/shared/src/studio-structures.test.ts apps/api/src/modules/studio/studio.schemas.ts
git commit -m "feat(studio): define ritual AI support modes"
```

### Task 2: Migrate sessions to occurrences, answer revisions and reviewable outputs

**Files:**
- Modify: `apps/api/src/db/operational-schema.ts:1597-end`
- Modify: `apps/api/src/db/operational-schema.test.ts`
- Modify: `apps/api/src/db/operational-schema.postgres.test.ts`

- [ ] **Step 1: Write migration assertions before adding migration 32**

```ts
expect(sql).toContain("ADD COLUMN IF NOT EXISTS support_mode TEXT");
expect(sql).toContain("ADD COLUMN IF NOT EXISTS occurrence_key TEXT");
expect(sql).toContain("ADD COLUMN IF NOT EXISTS answer_revision INTEGER");
expect(sql).toContain("CREATE TABLE studio_ritual_answer_versions");
expect(sql).toContain("CREATE TABLE studio_ritual_suggestions");
expect(sql).toContain("CREATE TABLE studio_ritual_session_assets");
expect(sql).toContain("studio_ritual_sessions_occurrence_idx");
```

- [ ] **Step 2: Run schema tests to verify migration 32 is absent**

Run: `pnpm --filter @prymeira/baase-api test -- operational-schema.test.ts`

Expected: FAIL on the new migration assertions.

- [ ] **Step 3: Add migration 32 named `studio_continuous_rituals`**

Use this schema shape:

```sql
ALTER TABLE studio_ritual_sessions
  ADD COLUMN IF NOT EXISTS support_mode TEXT,
  ADD COLUMN IF NOT EXISTS occurrence_key TEXT,
  ADD COLUMN IF NOT EXISTS occurrence_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS answer_revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS analysis_state TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS analysis_requested_mode TEXT,
  ADD COLUMN IF NOT EXISTS analysis_requested_at TIMESTAMPTZ;

UPDATE studio_ritual_sessions
SET support_mode='guided_reflection',
    occurrence_key='legacy:' || id,
    occurrence_at=created_at
WHERE support_mode IS NULL OR occurrence_key IS NULL OR occurrence_at IS NULL;

ALTER TABLE studio_ritual_sessions
  ALTER COLUMN support_mode SET NOT NULL,
  ALTER COLUMN occurrence_key SET NOT NULL,
  ALTER COLUMN occurrence_at SET NOT NULL,
  ADD CONSTRAINT studio_ritual_sessions_support_mode_ck
    CHECK (support_mode IN ('record_only','light_summary','guided_reflection')),
  ADD CONSTRAINT studio_ritual_sessions_answer_revision_ck CHECK (answer_revision > 0),
  ADD CONSTRAINT studio_ritual_sessions_analysis_state_ck
    CHECK (analysis_state IN ('idle','queued','processing','ready','failed'));

CREATE INDEX studio_ritual_sessions_occurrence_idx
  ON studio_ritual_sessions
  (workspace_id,owner_profile_id,ritual_id,occurrence_at DESC,id DESC);

CREATE TABLE studio_ritual_answer_versions (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  owner_profile_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  answer_revision INTEGER NOT NULL CHECK (answer_revision > 0),
  answers_json JSONB NOT NULL CHECK (jsonb_typeof(answers_json)='object'),
  edited_by_profile_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id,owner_profile_id,id),
  UNIQUE (workspace_id,owner_profile_id,session_id,answer_revision),
  FOREIGN KEY (workspace_id,owner_profile_id,session_id)
    REFERENCES studio_ritual_sessions(workspace_id,owner_profile_id,id) ON DELETE CASCADE
);

CREATE TABLE studio_ritual_suggestions (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  owner_profile_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('thought','decision','goal','plan')),
  title TEXT NOT NULL CHECK (title <> ''),
  body TEXT NOT NULL CHECK (body <> ''),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','dismissed')),
  result_document_id TEXT,
  result_structure_id TEXT,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  PRIMARY KEY (workspace_id,owner_profile_id,id),
  FOREIGN KEY (workspace_id,owner_profile_id,session_id)
    REFERENCES studio_ritual_sessions(workspace_id,owner_profile_id,id) ON DELETE CASCADE,
  UNIQUE (workspace_id,owner_profile_id,idempotency_key)
);

CREATE TABLE studio_ritual_session_assets (
  workspace_id TEXT NOT NULL,
  owner_profile_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id,owner_profile_id,session_id,asset_id),
  FOREIGN KEY (workspace_id,owner_profile_id,session_id)
    REFERENCES studio_ritual_sessions(workspace_id,owner_profile_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,owner_profile_id,asset_id)
    REFERENCES studio_assets(workspace_id,owner_profile_id,id) ON DELETE CASCADE
);
```

- [ ] **Step 4: Add real-PostgreSQL constraint tests**

Assert migration version 32 is recorded, all three tables exist, invalid support modes fail, `answer_revision=0` fails, duplicate answer versions fail and cross-owner asset/session links fail.

- [ ] **Step 5: Run in-memory SQL and real PostgreSQL suites**

Run: `pnpm --filter @prymeira/baase-api test -- operational-schema.test.ts`

Run with test database: `TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @prymeira/baase-api test:postgres-schema`

Expected: PASS; migration 32 applies once and remains idempotent.

- [ ] **Step 6: Commit the migration**

```bash
git add apps/api/src/db/operational-schema.ts apps/api/src/db/operational-schema.test.ts apps/api/src/db/operational-schema.postgres.test.ts
git commit -m "feat(studio): persist continuous ritual history"
```

### Task 3: Extend ritual domain types and repository contracts

**Files:**
- Modify: `apps/api/src/modules/studio/studio.types.ts:16-23,299-324,575-588`
- Modify: `apps/api/src/modules/studio/in-memory-studio.repository.ts:830-940`
- Modify: `apps/api/src/modules/studio/postgres-studio.repository.ts:174-184,416-447,1310-1442`
- Modify: `apps/api/src/modules/studio/studio.repository.test.ts:1470-1630`

- [ ] **Step 1: Write failing repository contract tests**

Cover these exact behaviors:

```ts
const first = await repository.createRitualSession({
  ...scope,
  ritualId: ritual.id,
  supportMode: "record_only",
  occurrenceKey: "daily:2026-07-17",
  occurrenceAt: "2026-07-17T12:00:00.000Z",
  allowRepeat: false,
  contextJson: {},
  preparationToken: null,
  preparationLeaseExpiresAt: null
});
await expect(repository.createRitualSession({
  ...scope,
  ritualId: ritual.id,
  supportMode: "record_only",
  occurrenceKey: "daily:2026-07-17",
  occurrenceAt: "2026-07-17T12:00:00.000Z",
  allowRepeat: false,
  contextJson: {},
  preparationToken: null,
  preparationLeaseExpiresAt: null
}))
  .rejects.toThrow("STUDIO_RITUAL_OCCURRENCE_COMPLETED");
```

Also assert that `updateRitualAnswers(session, expectedAnswerRevision, actorId)` succeeds while a simultaneous AI-state update increments only `revision`, and that editing a completed session appends an immutable answer version.

- [ ] **Step 2: Run repository tests and verify contract methods are missing**

Run: `pnpm --filter @prymeira/baase-api test -- studio.repository.test.ts`

Expected: typecheck/test failure for the new repository methods.

- [ ] **Step 3: Add domain types**

```ts
export type StudioRitualSupportMode = "record_only" | "light_summary" | "guided_reflection";
export type StudioRitualAnalysisState = "idle" | "queued" | "processing" | "ready" | "failed";

export type StudioRitualAnswerVersion = StudioOwnerScope & {
  id: string;
  sessionId: string;
  answerRevision: number;
  answersJson: Record<string, string>;
  editedByProfileId: string;
  createdAt: string;
};

export type StudioRitualSuggestion = StudioOwnerScope & {
  id: string;
  sessionId: string;
  kind: "thought" | "decision" | "goal" | "plan";
  title: string;
  body: string;
  status: "pending" | "accepted" | "dismissed";
  resultDocumentId: string | null;
  resultStructureId: string | null;
  createdAt: string;
  decidedAt: string | null;
};
```

Extend `StudioRitualSession` with `supportMode`, `occurrenceKey`, `occurrenceAt`, `answerRevision`, `editedAt`, `analysisState`, `analysisRequestedMode` and `analysisRequestedAt`.

- [ ] **Step 4: Add focused repository operations**

Add these signatures instead of routing human edits through the broad `updateRitualSession` method:

```ts
updateRitualAnswers(
  scope: StudioOwnerScope,
  sessionId: string,
  answers: Record<string, string>,
  expectedAnswerRevision: number,
  actorProfileId: string
): Promise<StudioRitualSession>;
listRitualAnswerVersions(scope: StudioOwnerScope, sessionId: string): Promise<StudioRitualAnswerVersion[]>;
claimNextRitualAnalysis(now: string, leaseMs?: number): Promise<StudioRitualSession | null>;
listRitualSuggestions(scope: StudioOwnerScope, sessionId: string): Promise<StudioRitualSuggestion[]>;
decideRitualSuggestion(input: StudioOwnerScope & {
  suggestionId: string;
  decision: "accepted" | "dismissed";
  title?: string;
  body?: string;
  idempotencyKey?: string;
  resultDocumentId?: string;
  resultStructureId?: string;
}): Promise<StudioRitualSuggestion>;
linkRitualAsset(scope: StudioOwnerScope, sessionId: string, assetId: string): Promise<void>;
```

- [ ] **Step 5: Implement PostgreSQL answer isolation atomically**

`updateRitualAnswers` must lock the session, insert the pre-edit answer snapshot when the session is already completed, and update with `WHERE answer_revision=$expected`. It increments `answer_revision` and `revision`, but background updates never increment `answer_revision`.

Return `STUDIO_RITUAL_ANSWERS_STALE` only when the human answer revision differs.

- [ ] **Step 6: Mirror behavior in the in-memory repository**

Use the same error codes, sorting, cursor rules and immutable cloning so service tests cannot pass against behavior unavailable in PostgreSQL.

- [ ] **Step 7: Run repository and type tests**

Run: `pnpm --filter @prymeira/baase-api test -- studio.repository.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: PASS.

- [ ] **Step 8: Commit repository boundaries**

```bash
git add apps/api/src/modules/studio/studio.types.ts apps/api/src/modules/studio/in-memory-studio.repository.ts apps/api/src/modules/studio/postgres-studio.repository.ts apps/api/src/modules/studio/studio.repository.test.ts
git commit -m "refactor(studio): isolate ritual answer revisions"
```

### Task 4: Make support mode and occurrence policy explicit in the service

**Files:**
- Modify: `apps/api/src/modules/studio/studio-ritual.service.ts:42-190,360-390`
- Modify: `apps/api/src/modules/studio/studio-ritual.service.test.ts`

- [ ] **Step 1: Write mode-policy tests**

Assert:

- daily legacy ritual resolves to `record_only`;
- weekly legacy ritual resolves to `light_summary`;
- monthly legacy ritual resolves to `guided_reflection`;
- explicit `support_mode` overrides cadence;
- changing ritual mode does not mutate prior session snapshots;
- `record_only` starts as `ready` without preparation claim;
- `record_only` finishes without `runStructured`;
- starting the same completed period without `allowRepeat` returns `STUDIO_RITUAL_OCCURRENCE_COMPLETED`.

- [ ] **Step 2: Run service tests and confirm current unconditional preparation/synthesis fails them**

Run: `pnpm --filter @prymeira/baase-api test -- studio-ritual.service.test.ts`

Expected: FAIL on mode defaults and zero AI calls.

- [ ] **Step 3: Add pure policy functions**

```ts
export function resolveRitualSupportMode(ritual: StudioStructure): StudioRitualSupportMode {
  const explicit = ritual.propertiesJson.support_mode;
  if (explicit === "record_only" || explicit === "light_summary" || explicit === "guided_reflection") return explicit;
  if (ritual.cadenceJson?.frequency === "daily") return "record_only";
  if (ritual.cadenceJson?.frequency === "weekly") return "light_summary";
  return "guided_reflection";
}

export function ritualOccurrence(ritual: StudioStructure, now: Date) {
  const cadence = ritual.cadenceJson;
  if (!cadence) {
    const minute = now.toISOString().slice(0, 16);
    return { key: `manual:${minute}`, at: `${minute}:00.000Z` };
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: cadence.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const localDate = `${read("year")}-${read("month")}-${read("day")}`;
  if (cadence.frequency === "daily") return { key: `daily:${localDate}`, at: now.toISOString() };
  if (cadence.frequency === "monthly") return { key: `monthly:${localDate.slice(0, 7)}`, at: now.toISOString() };
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(read("weekday"));
  const start = new Date(`${localDate}T12:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - ((weekdayIndex + 6) % 7));
  return { key: `weekly:${start.toISOString().slice(0, 10)}`, at: now.toISOString() };
}
```

The occurrence key formats are `daily:YYYY-MM-DD`, `weekly:YYYY-MM-DD` using the cadence week start, `monthly:YYYY-MM`, and `manual:<UTC-minute>` for unscheduled rituals.

- [ ] **Step 4: Change `startSession` input and behavior**

```ts
startSession(scope, ritualId, input?: {
  allowRepeat?: boolean;
  signal?: AbortSignal;
}): Promise<StudioRitualSession>;
```

For `record_only`, create a `ready` session with no preparation token. For assisted modes, create `preparing` and let maintenance claim it. Always snapshot support mode and occurrence.

- [ ] **Step 5: Make completion independent from analysis**

Replace `requestSynthesis` with `requestAnalysis`. Completion persists answers, cadence and completed state first. If analysis is requested and mode is assisted, set `analysisState='queued'` and return immediately. `record_only` remains `idle` unless the owner later requests retroactive analysis.

- [ ] **Step 6: Run service tests**

Run: `pnpm --filter @prymeira/baase-api test -- studio-ritual.service.test.ts`

Expected: PASS with zero AI calls for the simple daily path.

- [ ] **Step 7: Commit the grounded path**

```bash
git add apps/api/src/modules/studio/studio-ritual.service.ts apps/api/src/modules/studio/studio-ritual.service.test.ts
git commit -m "feat(studio): make daily rituals grounded by default"
```

### Task 5: Move assisted analysis fully into background maintenance

**Files:**
- Modify: `apps/api/src/modules/ai/ai.types.ts`
- Modify: `apps/api/src/modules/ai/prompt-registry.ts`
- Modify: `apps/api/src/modules/ai/schema-registry.ts`
- Modify: `apps/api/src/modules/ai/ai-registries.test.ts`
- Modify: `apps/api/src/modules/studio/studio-ritual.service.ts`
- Modify: `apps/api/src/modules/studio/studio-maintenance-runner.ts`
- Modify: `apps/api/src/modules/studio/studio-maintenance-runner.test.ts`

- [ ] **Step 1: Write failing registry and maintenance tests**

Register and test two task kinds:

```ts
"studio_ritual_light_summary"
"studio_ritual_guided_reflection"
```

The maintenance test must prove a queued session is claimed once, becomes `ready`, and a provider failure becomes `failed` without changing `answersJson` or `answerRevision`.

- [ ] **Step 2: Define one bounded output schema**

```ts
export const studioRitualAnalysisSchema = z.object({
  summary: z.string().trim().min(1).max(4_000),
  observations: z.array(z.object({
    text: z.string().trim().min(1).max(2_000),
    evidence_question_keys: z.array(z.string().trim().min(1).max(240)).max(10)
  }).strict()).max(5),
  suggestions: z.array(z.object({
    kind: z.enum(["thought", "decision", "goal", "plan"]),
    title: z.string().trim().min(1).max(240),
    body: z.string().trim().min(1).max(4_000)
  }).strict()).max(4)
}).strict();
```

- [ ] **Step 3: Add distinct prompt rules**

`light_summary` instructions: summarize in at most three short paragraphs, surface at most one meaningful pattern, return no suggestion unless it adds information not already stated.

`guided_reflection` instructions: compare relevant prior executions, identify up to three patterns/tensions, and return no more than four explicit proposals. Never create or claim to have created product entities.

- [ ] **Step 4: Implement claim/process/retry**

Add `processNextAnalysis` to `StudioRitualService`. The runner invokes it after preparation within the existing owner fairness budget. Analysis input includes the immutable answer snapshot, prior sessions limited to the same ritual and authorized Studio context.

- [ ] **Step 5: Prove answer revision isolation**

Add a test where an owner saves an answer while analysis completes. Both operations must succeed; the final record contains the new answer and analysis output, with no `STUDIO_RITUAL_ANSWERS_STALE`.

- [ ] **Step 6: Run AI and maintenance suites**

Run: `pnpm --filter @prymeira/baase-api test -- ai-registries.test.ts studio-maintenance-runner.test.ts studio-ritual.service.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit asynchronous intelligence**

```bash
git add apps/api/src/modules/ai apps/api/src/modules/studio/studio-ritual.service.ts apps/api/src/modules/studio/studio-maintenance-runner.ts apps/api/src/modules/studio/studio-maintenance-runner.test.ts
git commit -m "feat(studio): process ritual reflection asynchronously"
```

### Task 6: Expose detail, edit, analysis and suggestion HTTP contracts

**Files:**
- Modify: `apps/api/src/modules/studio/studio.schemas.ts:250-270`
- Modify: `apps/api/src/modules/studio/studio.routes.ts:320-370`
- Modify: `apps/api/src/modules/studio/studio-ritual.routes.test.ts`

- [ ] **Step 1: Write failing route tests for all new requests**

Test these contracts:

```text
GET  /studio/rituals/:ritualId/sessions?from=2026-07-01&to=2026-07-31&limit=20
POST /studio/rituals/:ritualId/sessions { "allow_repeat": false }
PATCH /studio/ritual-sessions/:sessionId { "expected_answer_revision": 2, "answers": { "Qual é o foco?": "Publicar o vídeo" } }
GET  /studio/ritual-sessions/:sessionId/versions
POST /studio/ritual-sessions/:sessionId/analysis { "mode": "guided_reflection" }
GET  /studio/ritual-sessions/:sessionId/suggestions
POST /studio/ritual-suggestions/:suggestionId/decision { "decision": "accepted", "title": "Proteger o foco", "body": "Publicar antes do almoço", "idempotency_key": "ritual-suggestion-01" }
POST /studio/ritual-sessions/:sessionId/assets { "asset_id": "studio_asset_01" }
```

- [ ] **Step 2: Add strict Zod schemas**

Dates use `YYYY-MM-DD`; require `from <= to`; analysis accepts only assisted modes; suggestion decision accepts `accepted` or `dismissed`; accepted decisions require a non-empty idempotency key.

- [ ] **Step 3: Map domain errors deliberately**

Map:

- `STUDIO_RITUAL_OCCURRENCE_COMPLETED` to HTTP 409;
- `STUDIO_RITUAL_ANSWERS_STALE` to HTTP 409 with code `STUDIO_RITUAL_ANSWERS_CHANGED`;
- unavailable/foreign sessions and suggestions to the existing scoped 404 behavior;
- repeated accepted suggestion with the same key to the original successful resource.

- [ ] **Step 4: Implement completed-answer editing and analysis request routes**

Editing calls `updateRitualAnswers`; analysis request only queues work and returns 202 semantics in the response body (`analysis_state: "queued"`). It must never wait for the model.

- [ ] **Step 5: Run route tests and API typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- studio-ritual.routes.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the HTTP contract**

```bash
git add apps/api/src/modules/studio/studio.schemas.ts apps/api/src/modules/studio/studio.routes.ts apps/api/src/modules/studio/studio-ritual.routes.test.ts
git commit -m "feat(studio): expose continuous ritual API"
```

### Task 7: Implement confirmed suggestion destinations

**Files:**
- Modify: `apps/api/src/modules/studio/studio-ritual.service.ts`
- Modify: `apps/api/src/modules/studio/studio-ritual.service.test.ts`
- Modify: `apps/api/src/app.ts:220-245`

- [ ] **Step 1: Write service tests for each destination**

For `thought`, create one Studio document with no structure. For `decision`, `goal` and `plan`, create one Studio document plus the matching structure. Assert owner/workspace scope, source-session metadata and idempotent retry.

- [ ] **Step 2: Inject the existing Studio document/structure service**

Add a narrow dependency:

```ts
type RitualSuggestionDestination = {
  createThought(scope: StudioOwnerScope, input: { title: string; body: string; idempotencyKey: string }): Promise<{ documentId: string }>;
  createStructured(scope: StudioOwnerScope, input: {
    kind: "decision" | "goal" | "plan";
    title: string;
    body: string;
    idempotencyKey: string;
  }): Promise<{ documentId: string; structureId: string }>;
};
```

Do not call routes internally; use existing services/repository transactions.

- [ ] **Step 3: Implement accept, edit-before-accept and dismiss**

Persist edited title/body in the suggestion decision transaction. A dismissed suggestion creates nothing. An accepted suggestion stores result ids and returns them on idempotent retry.

- [ ] **Step 4: Run service and route tests**

Run: `pnpm --filter @prymeira/baase-api test -- studio-ritual.service.test.ts studio-ritual.routes.test.ts`

Expected: PASS for all four destinations and duplicate-response recovery.

- [ ] **Step 5: Commit explicit creation actions**

```bash
git add apps/api/src/modules/studio/studio-ritual.service.ts apps/api/src/modules/studio/studio-ritual.service.test.ts apps/api/src/app.ts
git commit -m "feat(studio): confirm ritual insights into structures"
```

### Task 8: Map the continuous ritual API in the web client

**Files:**
- Modify: `apps/web/src/studio/studio.types.ts:27-110,424-535`
- Modify: `apps/web/src/studio/studio-api.ts:215-235,882-945`
- Modify: `apps/web/src/studio/studio-api.test.ts:490-530`

- [ ] **Step 1: Write failing mapper/request tests**

Assert snake_case payloads map to the new camelCase fields and requests send `expected_answer_revision`, `allow_repeat`, date filters, analysis mode and idempotency key exactly once.

- [ ] **Step 2: Add client types**

Mirror API types without `unknown` for analysis and suggestions:

```ts
export type StudioRitualAnalysis = {
  summary: string;
  observations: Array<{ text: string; evidenceQuestionKeys: string[] }>;
};
```

Add `StudioRitualAnswerVersion`, `StudioRitualSuggestion` and `StudioRitualSessionPage` with filtered paging.

- [ ] **Step 3: Add API functions**

```ts
updateStudioRitualAnswers(sessionId, input, signal?, fetcher?)
listStudioRitualAnswerVersions(sessionId, signal?, fetcher?)
requestStudioRitualAnalysis(sessionId, input, signal?, fetcher?)
listStudioRitualSuggestions(sessionId, signal?, fetcher?)
decideStudioRitualSuggestion(suggestionId, input, signal?, fetcher?)
linkStudioRitualAsset(sessionId, assetId, signal?, fetcher?)
```

Keep `finishStudioRitualSession` non-blocking and rename its boolean to `request_analysis`.

- [ ] **Step 4: Run focused web tests and typecheck**

Run: `pnpm --filter @prymeira/baase-web test -- studio-api.test.ts && pnpm --filter @prymeira/baase-web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit web contracts**

```bash
git add apps/web/src/studio/studio.types.ts apps/web/src/studio/studio-api.ts apps/web/src/studio/studio-api.test.ts
git commit -m "feat(studio): map continuous ritual API"
```

### Task 9: Add configurable support mode to creation and settings

**Files:**
- Create: `apps/web/src/studio/StudioRitualBuilder.tsx`
- Modify: `apps/web/src/studio/StudioRituals.tsx:260-380`
- Modify: `apps/web/src/studio/StudioRituals.test.tsx`
- Modify: `apps/web/src/studio/studio.css:3134-3152`

- [ ] **Step 1: Write builder tests**

Assert daily preselects `Só registrar`, weekly preselects `Resumo leve`, monthly preselects `Reflexão com IA`, and a manual choice remains unchanged when cadence changes afterward.

- [ ] **Step 2: Extract the builder without changing behavior**

Move builder draft persistence, cadence controls and document/structure creation into `StudioRitualBuilder.tsx`. Keep public props narrow: `busy`, `onCancel`, `onCreated`, `setBusy`.

- [ ] **Step 3: Add the support-mode control**

Render three quiet radio cards with concise descriptions. Track whether the user explicitly changed the mode; only auto-suggest while untouched.

Persist:

```ts
properties_json: {
  intention,
  guide_questions: guideQuestions,
  support_mode: supportMode
}
```

- [ ] **Step 4: Add ritual settings editing**

The detail header exposes `Configurar ritual`. Save via `updateStudioStructure` using the structure revision. Explain that changes affect future executions only.

- [ ] **Step 5: Run component tests**

Run: `pnpm --filter @prymeira/baase-web test -- StudioRituals.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit configurable modes**

```bash
git add apps/web/src/studio/StudioRitualBuilder.tsx apps/web/src/studio/StudioRituals.tsx apps/web/src/studio/StudioRituals.test.tsx apps/web/src/studio/studio.css
git commit -m "feat(studio): let owners choose ritual support"
```

### Task 10: Replace immediate start with a continuous ritual detail page

**Files:**
- Create: `apps/web/src/studio/StudioRitualDetail.tsx`
- Create: `apps/web/src/studio/StudioRitualHistory.tsx`
- Modify: `apps/web/src/studio/StudioRituals.tsx:20-230`
- Modify: `apps/web/src/studio/StudioRituals.test.tsx`
- Modify: `apps/web/src/studio/studio.css:3049-3240`

- [ ] **Step 1: Write navigation and timeline tests**

Clicking a ritual row must open detail without starting a session. The detail shows name, cadence, support mode, `Começar agora`, next occurrence and completed history in descending occurrence order.

- [ ] **Step 2: Make the library row a detail entry**

Replace `Iniciar` with `Abrir`. `initialRitualId` opens detail and fetches sessions; it does not POST a new session.

- [ ] **Step 3: Implement paginated history**

`StudioRitualHistory` renders a calm timeline with collapsed cards. `Carregar anteriores` uses `nextCursor` and appends without duplicating session ids.

- [ ] **Step 4: Add period filters**

Provide `30 dias`, `90 dias` and custom start/end inputs. Applying a period resets cursor and results. Show a true empty state distinct from load failure.

- [ ] **Step 5: Start only from explicit action**

`Começar agora` calls POST. If the server returns `STUDIO_RITUAL_OCCURRENCE_COMPLETED`, show a confirmation explaining that today's/this period's record already exists; retry with `allow_repeat: true` only after confirmation.

- [ ] **Step 6: Add responsive Quiet Ops styling**

Keep a maximum readable width, one primary action, restrained metadata and accessible expanded-state buttons. At 720 px, timeline cards remain single-column without horizontal scroll.

- [ ] **Step 7: Run component tests**

Run: `pnpm --filter @prymeira/baase-web test -- StudioRituals.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit continuous history UI**

```bash
git add apps/web/src/studio/StudioRitualDetail.tsx apps/web/src/studio/StudioRitualHistory.tsx apps/web/src/studio/StudioRituals.tsx apps/web/src/studio/StudioRituals.test.tsx apps/web/src/studio/studio.css
git commit -m "feat(studio): show ritual history by date"
```

### Task 11: Isolate the runner and remove false conflicts

**Files:**
- Create: `apps/web/src/studio/StudioRitualRunner.tsx`
- Modify: `apps/web/src/studio/StudioRituals.tsx:382-860`
- Modify: `apps/web/src/studio/StudioRituals.test.tsx`
- Modify: `apps/web/src/studio/studio.css:3154-3210`

- [ ] **Step 1: Write concurrency tests before extraction**

Test that polling an AI preparation update with a higher system `revision` and the same `answerRevision` does not trigger conflict. Test that a second human edit with a higher `answerRevision` does show the resolution panel.

- [ ] **Step 2: Extract `StudioRitualRunner`**

Move question navigation, local draft storage, polling, offline recovery and completion into the new component. Key drafts by `session.id` and store both answers and last known `answerRevision`.

- [ ] **Step 3: Save against `answerRevision` only**

Send `expected_answer_revision: session.answerRevision`. Merge polled AI fields into current state without replacing local answers when the answer revision is unchanged.

- [ ] **Step 4: Use grounded questions for simple mode**

For `record_only`, always use the ritual's fixed `guide_questions`. For assisted modes, additional AI questions are optional and labeled `Pergunta complementar da IA`; they never replace fixed questions.

- [ ] **Step 5: Simplify save language**

Use exactly `Salvando…`, `Salvo` and `Não foi possível salvar`. Offline detail remains inside the error/retry region rather than the persistent status label.

- [ ] **Step 6: Finish without waiting for analysis**

After finish response, render `Ritual registrado` immediately. Poll analysis state only in assisted modes and never prevent returning to detail.

- [ ] **Step 7: Run runner tests**

Run: `pnpm --filter @prymeira/baase-web test -- StudioRituals.test.tsx`

Expected: PASS including one-tab background preparation and genuine two-editor conflict.

- [ ] **Step 8: Commit conflict-safe runner**

```bash
git add apps/web/src/studio/StudioRitualRunner.tsx apps/web/src/studio/StudioRituals.tsx apps/web/src/studio/StudioRituals.test.tsx apps/web/src/studio/studio.css
git commit -m "fix(studio): separate ritual answers from AI updates"
```

### Task 12: Add completed editing, versions and retroactive analysis

**Files:**
- Modify: `apps/web/src/studio/StudioRitualHistory.tsx`
- Modify: `apps/web/src/studio/StudioRituals.test.tsx`
- Modify: `apps/web/src/studio/studio.css`

- [ ] **Step 1: Write history interaction tests**

An expanded completed item shows original answers. `Editar respostas` saves with answer revision, shows `Editado`, and `Ver versões` reveals older snapshots. `Aprofundar com IA` lets the owner choose light summary or guided reflection and queues without hiding answers.

- [ ] **Step 2: Implement inline answer editing**

Use a separate edit buffer. Cancel discards it. Save updates only on API success and keeps the panel open on failure.

- [ ] **Step 3: Implement version drawer**

Load versions lazily. Display date, editor and answer snapshot read-only. Do not offer restore in this delivery because the approved design only requires preservation and visibility.

- [ ] **Step 4: Implement retroactive analysis**

The action queues analysis, renders `Análise em preparação` and polls the selected session with bounded backoff. Existing analysis remains visible until the replacement is ready.

- [ ] **Step 5: Run component tests**

Run: `pnpm --filter @prymeira/baase-web test -- StudioRituals.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit editable history**

```bash
git add apps/web/src/studio/StudioRitualHistory.tsx apps/web/src/studio/StudioRituals.test.tsx apps/web/src/studio/studio.css
git commit -m "feat(studio): edit and revisit ritual entries"
```

### Task 13: Replace pending text with explicit suggestion decisions

**Files:**
- Modify: `apps/web/src/studio/StudioRitualHistory.tsx`
- Modify: `apps/web/src/studio/StudioRituals.test.tsx`
- Modify: `apps/web/src/studio/studio.css`

- [ ] **Step 1: Write suggestion-action tests**

Assert there is no generic `Pendente` badge without actions. Each suggestion offers `Ignorar` and one destination action based on kind. Accept opens an editable confirmation form and sends one stable idempotency key.

- [ ] **Step 2: Render analysis separately from answers**

Use headings `Suas respostas` and `Reflexão da IA`. Add `Gerado pela IA` metadata and keep the original answers first in document order.

- [ ] **Step 3: Implement dismiss and destination confirmation**

Labels:

- thought → `Guardar como pensamento`;
- decision → `Criar decisão`;
- goal → `Criar meta`;
- plan → `Transformar em plano`.

Allow title/body edits before confirmation. On success, replace controls with a link to the resulting Studio document.

- [ ] **Step 4: Add accessible pending/error states**

Disable only the suggestion being decided. Announce success with `role="status"`; keep failed edits and idempotency key for retry.

- [ ] **Step 5: Run component tests**

Run: `pnpm --filter @prymeira/baase-web test -- StudioRituals.test.tsx`

Expected: PASS and no assertion for the old `Pendente`-only UI.

- [ ] **Step 6: Commit actionable insights**

```bash
git add apps/web/src/studio/StudioRitualHistory.tsx apps/web/src/studio/StudioRituals.test.tsx apps/web/src/studio/studio.css
git commit -m "feat(studio): make ritual insights explicitly actionable"
```

### Task 14: Add period comparison and execution materials

**Files:**
- Modify: `apps/web/src/studio/StudioRitualDetail.tsx`
- Modify: `apps/web/src/studio/StudioRitualHistory.tsx`
- Modify: `apps/web/src/studio/StudioRitualRunner.tsx`
- Modify: `apps/web/src/studio/StudioRituals.test.tsx`
- Modify: `apps/web/src/studio/studio.css`

- [ ] **Step 1: Write comparison tests**

Comparison is available for weekly/monthly rituals with at least two completed executions. Selecting two entries shows question-aligned original answers side by side; missing answers render `Sem resposta registrada`.

- [ ] **Step 2: Implement comparison without AI dependency**

Build rows from the union of question keys and preserve each entry's occurrence date. AI observations, when present, appear below each period and are never used as the source for the comparison.

- [ ] **Step 3: Write material-link tests**

Linking an existing ritual-document asset to the active session makes it visible only on that execution's history card. Cross-owner or foreign-document assets fail.

- [ ] **Step 4: Reuse the compact Studio material picker**

Expose `Adicionar material` in the runner, select/upload through the ritual's source document, then call the session-asset link endpoint. History uses the existing compact material card/inspector behavior; it never expands extracted PDF text inline.

- [ ] **Step 5: Add mobile comparison fallback**

Below 720 px, render periods sequentially per question instead of a squeezed two-column table.

- [ ] **Step 6: Run component tests and typecheck**

Run: `pnpm --filter @prymeira/baase-web test -- StudioRituals.test.tsx && pnpm --filter @prymeira/baase-web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit review tools**

```bash
git add apps/web/src/studio/StudioRitualDetail.tsx apps/web/src/studio/StudioRitualHistory.tsx apps/web/src/studio/StudioRitualRunner.tsx apps/web/src/studio/StudioRituals.test.tsx apps/web/src/studio/studio.css
git commit -m "feat(studio): compare ritual periods and materials"
```

### Task 15: Update deterministic E2E runtime and journeys

**Files:**
- Modify: `tests/e2e/owner-studio-server.ts:95-215`
- Modify: `tests/e2e/owner-studio.spec.ts:119-150,420-438`

- [ ] **Step 1: Replace the old pending-decision E2E expectation**

The weekly test must open ritual detail, explicitly start, answer, see immediate completion, wait for the light summary, and explicitly accept a decision suggestion.

- [ ] **Step 2: Add grounded daily E2E**

Create a daily `record_only` ritual with three questions. Assert no preparation request is recorded by the deterministic harness, complete it, reopen the ritual and verify all three answers under today's date.

- [ ] **Step 3: Add history/edit/mode-change E2E**

Complete an entry, edit one answer, inspect its previous version, change the ritual mode, start a repeated confirmed occurrence and verify the old entry retains its original mode.

- [ ] **Step 4: Add failure and concurrency E2E**

Simulate failed AI analysis: answers remain visible and completion remains successful. Simulate a preparation update while typing in one tab: no conflict. Then submit a genuine stale `answer_revision` from a second API context and assert conflict resolution appears.

- [ ] **Step 5: Add comparison and material E2E**

Create two weekly records, compare them and link one small PDF to only the second execution. Verify compact rendering and original download.

- [ ] **Step 6: Run the Studio browser suite**

Run: `pnpm exec playwright test tests/e2e/owner-studio.spec.ts --project=chromium`

Expected: all Owner Studio tests PASS; no console errors or unhandled request failures.

- [ ] **Step 7: Commit browser coverage**

```bash
git add tests/e2e/owner-studio-server.ts tests/e2e/owner-studio.spec.ts
git commit -m "test(studio): cover continuous ritual journeys"
```

### Task 16: Document operations and execute the complete verification matrix

**Files:**
- Create: `docs/qa/2026-07-17-owner-studio-continuous-rituals.md`
- Modify: `docs/operations/owner-studio.md`

- [ ] **Step 1: Document runtime behavior**

Record that `record_only` does not call AI, assisted analysis is asynchronous, the maintenance process must be running, failures do not block completion, and answer concurrency uses `answer_revision` independently from background state.

- [ ] **Step 2: Create the manual production matrix**

Include checkboxes for daily/weekly/monthly defaults, manual override, history, completed editing, version visibility, retroactive analysis, suggestion acceptance/dismissal, real two-tab conflict, offline draft recovery, materials, comparison, mobile layout and owner isolation.

- [ ] **Step 3: Run focused API suites**

Run:

```bash
pnpm --filter @prymeira/baase-api test -- \
  operational-schema.test.ts \
  studio.repository.test.ts \
  studio-ritual.service.test.ts \
  studio-ritual.routes.test.ts \
  studio-maintenance-runner.test.ts \
  ai-registries.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run focused web suites**

Run:

```bash
pnpm --filter @prymeira/baase-web test -- \
  studio-api.test.ts \
  StudioRituals.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run repository-wide static verification**

Run: `pnpm typecheck && pnpm build`

Expected: all workspaces typecheck and build successfully.

- [ ] **Step 6: Run browser verification**

Run: `pnpm exec playwright test tests/e2e/owner-studio.spec.ts tests/e2e/owner-studio-responsive.spec.ts --project=chromium`

Expected: PASS with desktop and responsive Studio coverage.

- [ ] **Step 7: Run whitespace and change audit**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only the planned implementation and documentation files are changed.

- [ ] **Step 8: Commit operations evidence**

```bash
git add docs/qa/2026-07-17-owner-studio-continuous-rituals.md docs/operations/owner-studio.md
git commit -m "docs(studio): document continuous ritual operations"
```

---

## Self-review result

- **Spec coverage:** continuity, configurable defaults, future-only mode changes, exact original answers, editing with versions, separate AI content, non-blocking failure behavior, true conflict detection, idempotency, history filters, comparison, materials and explicit suggestion destinations each map to at least one task.
- **Scope discipline:** shared/team rituals, gamification, automatic task creation and heavy analytics remain excluded.
- **Type consistency:** persisted values are `record_only`, `light_summary`, `guided_reflection`; HTTP uses snake_case; web/domain uses camelCase; human concurrency consistently uses `answerRevision`/`expected_answer_revision`.
- **Deployment impact:** migration 32 is required; no new environment variable or Docker service is introduced. Existing API and Studio maintenance processes must run the new image.
