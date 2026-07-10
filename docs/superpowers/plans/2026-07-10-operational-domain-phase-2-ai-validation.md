# Operational Domain Phase 2: AI Routine Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI-generated and manually edited routines semantically valid, fully reviewable, and conservative about deadlines, evidence, and approval.

**Architecture:** Expand the routine proposal into an explicit schedule and ordered step model, then pass both AI output and manual saves through the same deterministic validator. The AI may retry once with structured validation feedback, but only the reviewed proposal can be persisted. Routine template updates continue to affect future occurrences only.

**Tech Stack:** TypeScript, Fastify, Zod, Vitest, React, Vite, Testing Library, existing OpenAI provider and AI harness

---

## File Map

- Create `apps/api/src/modules/routines/routine-schedule.ts`: schedule normalization and date matching.
- Create `apps/api/src/modules/routines/routine-schedule.test.ts`: daily, weekly, monthly, and on-demand tests.
- Create `apps/api/src/modules/routines/routine-proposal-validator.ts`: deterministic semantic and policy validation.
- Create `apps/api/src/modules/routines/routine-proposal-validator.test.ts`: contradiction and evidence-density tests.
- Create `apps/api/src/modules/ai/routine-draft.service.ts`: generate, validate, and retry routine drafts once.
- Create `apps/api/src/modules/ai/routine-draft.service.test.ts`: correction and failure-preservation tests.
- Create `apps/web/src/components/routine-editor.tsx`: shared manual and AI review editor.
- Create `apps/web/src/components/routine-editor.test.tsx`: schedule, defaults, and per-step override tests.
- Create `apps/web/src/components/ai-routine-review.tsx`: generated proposal review shell.
- Create `apps/web/src/components/ai-routine-review.test.tsx`: validation issue and editable proposal tests.
- Modify `apps/api/src/modules/routines/routine.types.ts`: explicit schedule, deadlines, instructions, role assignment, and evidence reason.
- Modify `apps/api/src/modules/routines/routine.service.ts`: shared validation and future occurrence generation.
- Modify `apps/api/src/modules/routines/routine.routes.ts`: request schemas and structured validation errors.
- Modify `apps/api/src/modules/ai/schema-registry.ts`: routine draft schema version 2.
- Modify `apps/api/src/modules/ai/prompt-registry.ts`: routine architect prompt version 2.
- Modify `apps/api/src/modules/ai/ai.routes.ts`: use the routine-specific service.
- Modify `apps/api/src/modules/ai/providers/mock-ai.provider.ts`: valid deterministic routine proposal.
- Modify `apps/web/src/api.ts`: routine proposal and validation issue contracts.
- Modify `apps/web/src/App.tsx`: use the extracted editor for manual and AI creation.
- Modify `apps/web/src/styles.css`: existing Baase modal and disclosure styling.

### Task 1: Define explicit routine schedules and step policies

**Files:**
- Modify: `apps/api/src/modules/routines/routine.types.ts`
- Create: `apps/api/src/modules/routines/routine-schedule.ts`
- Create: `apps/api/src/modules/routines/routine-schedule.test.ts`

- [ ] **Step 1: Write failing schedule tests**

```ts
it.each([
  [{ frequency: "daily", weekdays: ["mon", "wed"] }, "2026-07-13", true],
  [{ frequency: "daily", weekdays: ["mon", "wed"] }, "2026-07-14", false],
  [{ frequency: "weekly", weekdays: ["fri"] }, "2026-07-10", true],
  [{ frequency: "monthly", monthDay: 10 }, "2026-07-10", true],
  [{ frequency: "monthly", monthDay: 10 }, "2026-07-11", false],
  [{ frequency: "on_demand" }, "2026-07-10", false]
])("matches %o on %s", (schedule, date, expected) => {
  expect(scheduleMatchesDate(schedule as RoutineSchedule, date)).toBe(expected);
});

it("rejects a weekly schedule with two weekdays", () => {
  expect(() => normalizeRoutineSchedule({ frequency: "weekly", weekdays: ["mon", "fri"] }))
    .toThrow("ROUTINE_WEEKLY_REQUIRES_ONE_WEEKDAY");
});
```

- [ ] **Step 2: Run the tests and verify the schedule module is missing**

Run: `pnpm --filter @prymeira/baase-api test -- routine-schedule.test.ts`

Expected: FAIL with unresolved module exports.

- [ ] **Step 3: Implement discriminated schedule and step types**

```ts
export type RoutineSchedule =
  | { frequency: "daily"; weekdays: RoutineWeekday[] }
  | { frequency: "weekly"; weekdays: [RoutineWeekday] }
  | { frequency: "monthly"; monthDay: number }
  | { frequency: "on_demand" };

export type RoutineStepAssignment =
  | { type: "inherit" }
  | { type: "person"; profileId: string }
  | { type: "role"; roleTemplateId: string };

export type RoutineStepDeadline = {
  kind: "time";
  localTime: string;
} | null;
```

Replace ambiguous `dueHint` on templates with `instructionTiming: string | null` and `deadline: RoutineStepDeadline`. Add `evidenceReason: string | null`. Keep a read-only legacy mapper for existing records until the phase 1 backfill is complete. `normalizeRoutineSchedule` must deduplicate daily weekdays, enforce exactly one weekly weekday, enforce month day 1 through 31, and strip schedule fields from on-demand routines.

- [ ] **Step 4: Run schedule tests and typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- routine-schedule.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: schedule tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit explicit routine schedules**

```bash
git add apps/api/src/modules/routines/routine.types.ts apps/api/src/modules/routines/routine-schedule.ts apps/api/src/modules/routines/routine-schedule.test.ts
git commit -m "feat: define explicit routine schedules"
```

### Task 2: Build the deterministic routine proposal validator

**Files:**
- Create: `apps/api/src/modules/routines/routine-proposal-validator.ts`
- Create: `apps/api/src/modules/routines/routine-proposal-validator.test.ts`

- [ ] **Step 1: Write failing validation tests for all approved rules**

```ts
it("detects a weekly title configured as a daily business-week routine", () => {
  const issues = validateRoutineProposal(proposal({
    title: "Revisão financeira semanal",
    schedule: { frequency: "daily", weekdays: ["mon", "tue", "wed", "thu", "fri"] }
  }));
  expect(issues).toContainEqual(expect.objectContaining({ code: "ROUTINE_FREQUENCY_SEMANTIC_CONFLICT", path: "schedule.frequency" }));
});

it("requires a reason whenever evidence is mandatory", () => {
  const issues = validateRoutineProposal(proposal({
    steps: [step({ evidencePolicy: "photo_required", evidenceReason: null })]
  }));
  expect(issues).toContainEqual(expect.objectContaining({ code: "ROUTINE_EVIDENCE_REASON_REQUIRED", path: "steps.0.evidenceReason" }));
});

it("rejects blanket mandatory evidence without distinct operational reasons", () => {
  const steps = Array.from({ length: 6 }, (_, index) => step({
    title: `Etapa ${index + 1}`, evidencePolicy: "comment_required", evidenceReason: "Confirmar execução"
  }));
  expect(validateRoutineProposal(proposal({ steps }))).toContainEqual(
    expect.objectContaining({ code: "ROUTINE_EVIDENCE_OVERREACH" })
  );
});
```

- [ ] **Step 2: Run the validator tests and verify they fail**

Run: `pnpm --filter @prymeira/baase-api test -- routine-proposal-validator.test.ts`

Expected: FAIL because `validateRoutineProposal` does not exist.

- [ ] **Step 3: Implement stable issue codes and conservative heuristics**

```ts
export type RoutineValidationIssue = {
  code:
    | "ROUTINE_WEEKLY_REQUIRES_ONE_WEEKDAY"
    | "ROUTINE_MONTH_DAY_INVALID"
    | "ROUTINE_FREQUENCY_SEMANTIC_CONFLICT"
    | "ROUTINE_EVIDENCE_REASON_REQUIRED"
    | "ROUTINE_EVIDENCE_OVERREACH"
    | "ROUTINE_DEADLINE_INVALID"
    | "ROUTINE_REFERENCE_NOT_FOUND";
  path: string;
  message: string;
};
```

Recognize Portuguese frequency markers (`diário/diária/todo dia`, `semanal/toda semana`, `mensal/todo mês`) in title plus input summary. Mandatory evidence must have a reason of at least 12 non-whitespace characters. Flag overreach when more than half of at least four steps require evidence and the reasons are repeated or generic. A deadline accepts only `HH:mm`; text such as `durante`, `antes`, `depois`, `ao finalizar`, or `primeira atividade` belongs in `instructionTiming`.

- [ ] **Step 4: Run validator tests**

Run: `pnpm --filter @prymeira/baase-api test -- routine-proposal-validator.test.ts`

Expected: all validator tests PASS.

- [ ] **Step 5: Commit deterministic routine validation**

```bash
git add apps/api/src/modules/routines/routine-proposal-validator.ts apps/api/src/modules/routines/routine-proposal-validator.test.ts
git commit -m "feat: validate routine proposals deterministically"
```

### Task 3: Expand the AI routine draft schema and prompt

**Files:**
- Modify: `apps/api/src/modules/ai/schema-registry.ts`
- Modify: `apps/api/src/modules/ai/prompt-registry.ts`
- Modify: `apps/api/src/modules/ai/providers/mock-ai.provider.ts`
- Test: `apps/api/src/modules/ai/ai-registries.test.ts`
- Test: `apps/api/src/modules/ai/ai-providers.test.ts`

- [ ] **Step 1: Write failing schema and prompt assertions**

```ts
it("parses a routine proposal with schedule, instruction timing, deadline, and evidence reason", () => {
  expect(routineDraftSchema.parse({
    title: "Revisão financeira semanal",
    schedule: { frequency: "weekly", weekdays: ["fri"] },
    areaName: "Financeiro", roleName: "Analista financeiro",
    steps: [{
      title: "Conferir lançamentos", instructionTiming: "Depois do fechamento da semana",
      deadline: { kind: "time", localTime: "16:00" }, assignee: { type: "inherit" },
      evidencePolicy: "optional", evidenceReason: null, approvalMode: "direct"
    }],
    linkedProcessTitle: null, assumptions: [], gaps: []
  })).toBeTruthy();
});
```

- [ ] **Step 2: Run AI registry tests and verify the old schema fails**

Run: `pnpm --filter @prymeira/baase-api test -- ai-registries.test.ts ai-providers.test.ts`

Expected: FAIL because the schema still expects `frequency` and `tasks`.

- [ ] **Step 3: Implement schema version 2 and prompt version 2**

The Zod schema must use a discriminated union for schedule and require `steps` as shown above. In the prompt registry, add `agent/routine-architect@2` with these explicit rules:

```text
- Evidência é optional por padrão.
- Exija comentário somente para decisão, divergência ou bloqueio.
- Exija foto somente para comprovação física ou visual.
- Sempre explique evidenceReason quando evidencePolicy não for optional.
- deadline contém somente horário real HH:mm; sequência operacional vai em instructionTiming.
- weekly usa exatamente um weekday; monthly usa monthDay; on_demand não agenda o Hoje.
- Não marque todas as etapas com evidência ou aprovação por conveniência.
```

Update the mock provider so its weekly example uses Friday, optional evidence on normal steps, and one justified comment requirement only when reporting a divergence.

- [ ] **Step 4: Run AI registry/provider tests**

Run: `pnpm --filter @prymeira/baase-api test -- ai-registries.test.ts ai-providers.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 5: Commit the AI contract**

```bash
git add apps/api/src/modules/ai/schema-registry.ts apps/api/src/modules/ai/prompt-registry.ts apps/api/src/modules/ai/providers/mock-ai.provider.ts apps/api/src/modules/ai/ai-registries.test.ts apps/api/src/modules/ai/ai-providers.test.ts
git commit -m "feat: improve ai routine proposal contract"
```

### Task 4: Validate and retry AI routine generation once

**Files:**
- Create: `apps/api/src/modules/ai/routine-draft.service.ts`
- Create: `apps/api/src/modules/ai/routine-draft.service.test.ts`
- Modify: `apps/api/src/modules/ai/ai.routes.ts`
- Test: `apps/api/src/modules/ai/ai.routes.test.ts`

- [ ] **Step 1: Write failing retry and terminal-error tests**

```ts
it("retries one invalid routine draft with structured validation feedback", async () => {
  provider.queue(invalidDailyWeeklyDraft, validWeeklyDraft);
  const result = await service.generate(input);
  expect(provider.calls).toHaveLength(2);
  expect(provider.calls[1].input.validationFeedback).toContainEqual(
    expect.objectContaining({ code: "ROUTINE_FREQUENCY_SEMANTIC_CONFLICT" })
  );
  expect(result.proposal.schedule).toEqual({ frequency: "weekly", weekdays: ["fri"] });
});

it("returns the last proposal and issues after the correction also fails", async () => {
  provider.queue(invalidDailyWeeklyDraft, invalidDailyWeeklyDraft);
  await expect(service.generate(input)).rejects.toMatchObject({
    code: "AI_ROUTINE_REVIEW_REQUIRED",
    details: { proposal: invalidDailyWeeklyDraft }
  });
});
```

- [ ] **Step 2: Run tests and verify the routine-specific service is missing**

Run: `pnpm --filter @prymeira/baase-api test -- routine-draft.service.test.ts ai.routes.test.ts`

Expected: FAIL with missing module/service behavior.

- [ ] **Step 3: Implement one correction attempt without discarding usable output**

The service calls the AI harness with prompt version `2`, validates the parsed proposal, and returns immediately when no issues exist. On issues, it performs exactly one second run with `{ originalInput, previousProposal, validationFeedback }`. If issues remain, throw `new ApiError(422, "AI_ROUTINE_REVIEW_REQUIRED", "A rotina precisa de revisão antes de ser salva.", { proposal, issues })`; the route must preserve the proposal for the frontend. Other draft types continue through the generic route path unchanged.

- [ ] **Step 4: Run service and route tests**

Run: `pnpm --filter @prymeira/baase-api test -- routine-draft.service.test.ts ai.routes.test.ts ai-harness.test.ts`

Expected: all focused tests PASS and each AI run is recorded.

- [ ] **Step 5: Commit the correction loop**

```bash
git add apps/api/src/modules/ai/routine-draft.service.ts apps/api/src/modules/ai/routine-draft.service.test.ts apps/api/src/modules/ai/ai.routes.ts apps/api/src/modules/ai/ai.routes.test.ts
git commit -m "feat: correct invalid ai routine drafts"
```

### Task 5: Apply the same validator to manual routine saves

**Files:**
- Modify: `apps/api/src/modules/routines/routine.service.ts`
- Modify: `apps/api/src/modules/routines/routine.routes.ts`
- Test: `apps/api/src/modules/routines/routine.service.test.ts`
- Test: `apps/api/src/modules/routines/routine.routes.test.ts`

- [ ] **Step 1: Write failing create, update, and future-occurrence tests**

```ts
it("returns structured issues instead of saving an invalid weekly schedule", async () => {
  const response = await app.inject({
    method: "POST", url: "/routines", headers: ownerHeaders,
    payload: routinePayload({ schedule: { frequency: "weekly", weekdays: ["mon", "fri"] } })
  });
  expect(response.statusCode).toBe(422);
  expect(response.json().error.details.issues[0].code).toBe("ROUTINE_WEEKLY_REQUIRES_ONE_WEEKDAY");
});

it("does not rewrite an existing occurrence after the template is edited", async () => {
  const before = await service.generateOccurrences("workspace_a", routine.id, "2026-07-10");
  await service.updateRoutine("workspace_a", routine.id, changedRoutineInput);
  expect((await repository.findTaskOccurrence("workspace_a", before[0].id))?.stepTitleSnapshot).toBe("Conferir caixa");
});
```

- [ ] **Step 2: Run routine tests and verify invalid input is currently accepted**

Run: `pnpm --filter @prymeira/baase-api test -- routine.service.test.ts routine.routes.test.ts`

Expected: at least the invalid weekly schedule assertion FAILS.

- [ ] **Step 3: Validate references and policies before each transaction**

Parse the new schedule union in routes, map it to domain input, and call `validateRoutineProposal` in both create and update. Resolve area, person, role, and process references within the workspace. Throw `422 ROUTINE_VALIDATION_FAILED` with the stable issue list. Generate occurrences only with `scheduleMatchesDate`; monthly day 29 through 31 simply skips months without that day, and on-demand requires an explicit generate endpoint call.

- [ ] **Step 4: Run the complete routine suite**

Run: `pnpm --filter @prymeira/baase-api test -- routine.service.test.ts routine.routes.test.ts routine-schedule.test.ts routine-proposal-validator.test.ts`

Expected: all routine tests PASS.

- [ ] **Step 5: Commit routine persistence validation**

```bash
git add apps/api/src/modules/routines/routine.service.ts apps/api/src/modules/routines/routine.routes.ts apps/api/src/modules/routines/routine.service.test.ts apps/api/src/modules/routines/routine.routes.test.ts
git commit -m "feat: validate routine saves and recurrence"
```

### Task 6: Build a shared routine editor with bulk defaults and per-step overrides

**Files:**
- Create: `apps/web/src/components/routine-editor.tsx`
- Create: `apps/web/src/components/routine-editor.test.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write failing editor tests**

```tsx
it("enforces one weekday in weekly mode and exposes a monthly day", async () => {
  render(<RoutineEditor value={routineValue()} areas={areas} people={people} roles={roles} onSave={onSave} />);
  await userEvent.click(screen.getByRole("button", { name: "Semanal" }));
  await userEvent.click(screen.getByRole("button", { name: "Sex" }));
  await userEvent.click(screen.getByRole("button", { name: "Seg" }));
  expect(screen.getByRole("button", { name: "Sex" })).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(screen.getByRole("button", { name: "Mensal" }));
  expect(screen.getByLabelText("Dia do mês")).toBeInTheDocument();
});

it("applies routine defaults and lets one step override evidence", async () => {
  render(<RoutineEditor value={routineValue()} areas={areas} people={people} roles={roles} onSave={onSave} />);
  await userEvent.selectOptions(screen.getByLabelText("Evidência padrão"), "optional");
  await userEvent.click(screen.getByRole("button", { name: "Editar etapa 2" }));
  await userEvent.selectOptions(screen.getByLabelText("Evidência da etapa 2"), "comment_required");
  expect(screen.getByLabelText("Motivo da evidência da etapa 2")).toBeRequired();
});
```

- [ ] **Step 2: Run component tests and verify the editor is missing**

Run: `pnpm --filter @prymeira/baase-web test -- routine-editor.test.tsx`

Expected: FAIL with unresolved component import.

- [ ] **Step 3: Implement the shared editor in the existing Baase aesthetic**

The editor must contain: title and area; recurrence segmented control; weekday, month-day, or on-demand controls; routine-level assignee/evidence/approval defaults; ordered step rows; add/remove/reorder controls; and a compact step disclosure for owner, real deadline, instruction timing, evidence policy/reason, approval, and linked process. Use icon buttons for reorder/delete and preserve the current modal dimensions, typography, border radius, colors, and footer. Do not display `Limite:` for `instructionTiming`.

Weekly weekday selection replaces the previous weekday; daily toggles multiple weekdays. Changing a default updates only steps still marked `inherit`. The serialized API payload contains explicit effective values plus `inherit` assignment where applicable.

- [ ] **Step 4: Run editor tests, typecheck, and build**

Run: `pnpm --filter @prymeira/baase-web test -- routine-editor.test.tsx && pnpm --filter @prymeira/baase-web typecheck && pnpm --filter @prymeira/baase-web build`

Expected: tests PASS, TypeScript exits 0, and Vite build succeeds.

- [ ] **Step 5: Commit the shared routine editor**

```bash
git add apps/web/src/components/routine-editor.tsx apps/web/src/components/routine-editor.test.tsx apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "feat: add complete routine editor"
```

### Task 7: Add editable AI routine review before persistence

**Files:**
- Create: `apps/web/src/components/ai-routine-review.tsx`
- Create: `apps/web/src/components/ai-routine-review.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/api.ts`
- Test: `apps/web/src/api.test.ts`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write failing review-flow tests**

```tsx
it("keeps an invalid generated proposal editable and blocks save until corrected", async () => {
  render(<AiRoutineReview proposal={invalidProposal} issues={issues} onSave={onSave} onRegenerate={onRegenerate} />);
  expect(screen.getByText("A frequência sugerida contradiz o nome da rotina.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Salvar rotina" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Semanal" }));
  await userEvent.click(screen.getByRole("button", { name: "Sex" }));
  expect(screen.getByRole("button", { name: "Salvar rotina" })).toBeEnabled();
});
```

- [ ] **Step 2: Run review tests and verify the component is missing**

Run: `pnpm --filter @prymeira/baase-web test -- ai-routine-review.test.tsx`

Expected: FAIL with unresolved component import.

- [ ] **Step 3: Connect generated drafts to the same editor**

When `POST /api/ai/drafts` returns a routine proposal, open `AiRoutineReview` instead of immediately mapping it to the old modal. Render validation messages beside the relevant field, preserve the proposal returned in a 422 response, and offer `Corrigir manualmente` and `Gerar outra sugestão`. Saving calls the standard routine endpoint; no AI-only persistence path exists.

- [ ] **Step 4: Run all web tests and production build**

Run: `pnpm --filter @prymeira/baase-web test && pnpm --filter @prymeira/baase-web typecheck && pnpm --filter @prymeira/baase-web build`

Expected: all web tests PASS and production build succeeds.

- [ ] **Step 5: Commit AI review**

```bash
git add apps/web/src/components/ai-routine-review.tsx apps/web/src/components/ai-routine-review.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/api.ts apps/web/src/api.test.ts
git commit -m "feat: review ai routines before saving"
```

### Task 8: Verify the complete AI and recurrence phase

**Files:**
- Modify: `docs/deployment-operational-migration.md`

- [ ] **Step 1: Add a production smoke-test matrix to the runbook**

Document manual checks for: daily Monday/Wednesday, weekly Friday, monthly day 10, on-demand, AI weekly contradiction correction, optional evidence default, one justified required comment, per-step person/role override, and editing a template after an occurrence exists.

- [ ] **Step 2: Run the full repository verification**

Run: `pnpm test && pnpm typecheck && pnpm build`

Expected: all workspace tests, typechecks, and builds exit 0.

- [ ] **Step 3: Commit phase verification documentation**

```bash
git add docs/deployment-operational-migration.md
git commit -m "docs: add routine validation smoke tests"
```

## Phase 2 Acceptance Gate

- [ ] Daily supports multiple weekdays, weekly exactly one, monthly a valid month day, and on-demand no automatic Today occurrence.
- [ ] AI and manual routine saves use the same deterministic validator and stable issue codes.
- [ ] Evidence defaults to optional; mandatory evidence always has a visible reason.
- [ ] Operational ordering text is never presented as a deadline.
- [ ] Users can edit routine defaults and every step before and after creation.
- [ ] A routine edit changes future occurrences while preserving existing occurrence snapshots.
