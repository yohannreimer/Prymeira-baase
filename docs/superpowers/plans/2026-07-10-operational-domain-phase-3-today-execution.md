# Operational Domain Phase 3: Grouped Today and Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Today task list with compact manual-task and routine-occurrence cards that support inline progress, evidence, approval, and atomic bulk completion on desktop and mobile.

**Architecture:** Treat a routine occurrence as the durable parent of its step task occurrences, and expose a grouped Today read model instead of grouping in React. Individual completion and bulk completion share one validation engine; bulk writes run in one transaction and use an idempotency key. The frontend uses focused responsive components while retaining the current Baase visual language.

**Tech Stack:** TypeScript, Fastify, Zod, PostgreSQL transactions, Vitest, React, Vite, Testing Library, Playwright, existing S3-compatible object storage

---

## File Map

- Create `apps/api/src/modules/routines/today.types.ts`: grouped DTOs, progress, and completion requirements.
- Create `apps/api/src/modules/routines/today.service.ts`: Today generation and grouped read model.
- Create `apps/api/src/modules/routines/today.service.test.ts`: grouping, visibility, and snapshot tests.
- Create `apps/api/src/modules/routines/task-completion.service.ts`: shared evidence, checklist, approval, transaction, and idempotency logic.
- Create `apps/api/src/modules/routines/task-completion.service.test.ts`: individual and bulk completion tests.
- Create `apps/api/src/modules/routines/task-evidence.routes.ts`: photo upload and evidence removal.
- Create `apps/api/src/modules/routines/task-evidence.routes.test.ts`: object storage lifecycle tests.
- Create `apps/web/src/components/today/today-view.tsx`: grouped sections and daily progress.
- Create `apps/web/src/components/today/manual-task-card.tsx`: collapsed manual task with inline checklist.
- Create `apps/web/src/components/today/routine-occurrence-card.tsx`: collapsed routine with ordered steps.
- Create `apps/web/src/components/today/completion-review-dialog.tsx`: confirmation and consolidated missing evidence.
- Create `apps/web/src/components/today/evidence-field.tsx`: comment/photo input with upload state.
- Create `apps/web/src/components/today/today-view.test.tsx`: integrated behavior tests.
- Create `apps/web/playwright.config.ts`: desktop/mobile browser configuration.
- Create `apps/web/e2e/today-execution.spec.ts`: production-like responsive workflow.
- Modify `apps/api/src/db/operational-schema.ts`: completion request table and indexes as migration version 2.
- Modify `apps/api/src/modules/routines/routine.types.ts`: parent occurrence ID and snapshot/status fields.
- Modify `apps/api/src/modules/routines/routine.service.ts`: delegate Today and completion behavior.
- Modify `apps/api/src/modules/routines/routine.routes.ts`: grouped endpoint and completion endpoints.
- Modify `apps/api/src/modules/routines/postgres-routine.repository.ts`: transactional completion and grouped queries.
- Modify `apps/api/src/modules/routines/in-memory-routine.repository.ts`: parity for route tests.
- Modify `apps/api/src/app.ts`: register task evidence routes.
- Modify `apps/web/src/api.ts`: grouped Today and completion API functions.
- Modify `apps/web/src/App.tsx`: replace the inline `TodayView` implementation.
- Modify `apps/web/src/styles.css`: responsive card, disclosure, progress, and review styles.
- Modify `apps/web/package.json`: Playwright scripts and dependency.
- Modify `docs/deployment-operational-migration.md`: production smoke tests.

### Task 1: Make routine occurrences explicit parents

**Files:**
- Modify: `apps/api/src/db/operational-schema.ts`
- Modify: `apps/api/src/modules/routines/routine.types.ts`
- Modify: `apps/api/src/modules/routines/postgres-routine.repository.ts`
- Modify: `apps/api/src/modules/routines/in-memory-routine.repository.ts`
- Test: `apps/api/src/db/operational-schema.test.ts`
- Test: `apps/api/src/db/operational-repositories.test.ts`

- [ ] **Step 1: Write failing parent-occurrence and uniqueness tests**

```ts
it("creates one routine occurrence parent with ordered step occurrences", async () => {
  const generated = await repository.createRoutineOccurrence(routineOccurrenceInput({
    routineId: "routine_opening",
    dueDate: "2026-07-10",
    steps: [stepInput("Conferir agenda", 1), stepInput("Priorizar demandas", 2)]
  }));
  expect(generated.steps.map((step) => step.routineOccurrenceId)).toEqual([generated.id, generated.id]);
  expect(generated.steps.map((step) => step.sortOrder)).toEqual([1, 2]);
});

it("reuses the same parent when generation repeats", async () => {
  const first = await repository.createRoutineOccurrence(input);
  const second = await repository.createRoutineOccurrence(input);
  expect(second.id).toBe(first.id);
  expect(await repository.listRoutineOccurrences("workspace_a", { dueDate: "2026-07-10" })).toHaveLength(1);
});
```

- [ ] **Step 2: Run focused tests and verify the repository contract is missing**

Run: `pnpm --filter @prymeira/baase-api test -- operational-schema.test.ts operational-repositories.test.ts`

Expected: FAIL because parent occurrence methods and fields are absent.

- [ ] **Step 3: Add migration version 2 and repository methods**

Migration version 2 must ensure `task_occurrences.routine_occurrence_id` references `routine_occurrences`, backfill it from `(workspace_id, routine_id, due_date, audience_key)`, and make it required for routine-origin rows. Add:

```sql
create table if not exists routine_completion_requests (
  workspace_id text not null,
  routine_occurrence_id text not null,
  idempotency_key text not null,
  actor_profile_id text not null,
  response_json jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (workspace_id, routine_occurrence_id, idempotency_key),
  foreign key (workspace_id, routine_occurrence_id)
    references routine_occurrences(workspace_id, id)
);
```

Extend `RoutineRepository` with `createRoutineOccurrence`, `findRoutineOccurrence`, `listRoutineOccurrences`, and `runInTransaction`. The Postgres implementation uses one checked-out client; the in-memory implementation clones state and restores it on error.

- [ ] **Step 4: Run schema/repository tests and typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- operational-schema.test.ts operational-repositories.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: focused tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit parent occurrences**

```bash
git add apps/api/src/db/operational-schema.ts apps/api/src/db/operational-schema.test.ts apps/api/src/db/operational-repositories.test.ts apps/api/src/modules/routines/routine.types.ts apps/api/src/modules/routines/postgres-routine.repository.ts apps/api/src/modules/routines/in-memory-routine.repository.ts
git commit -m "feat: model routine occurrence parents"
```

### Task 2: Build the grouped Today read model

**Files:**
- Create: `apps/api/src/modules/routines/today.types.ts`
- Create: `apps/api/src/modules/routines/today.service.ts`
- Create: `apps/api/src/modules/routines/today.service.test.ts`
- Modify: `apps/api/src/modules/routines/routine.service.ts`

- [ ] **Step 1: Write failing grouping and visibility tests**

```ts
it("returns manual tasks and one card per routine occurrence", async () => {
  const today = await service.readToday("workspace_a", "profile_a", "2026-07-10");
  expect(today.manualTasks.map((task) => task.title)).toEqual(["Enviar proposta"]);
  expect(today.routineOccurrences).toHaveLength(1);
  expect(today.routineOccurrences[0]).toMatchObject({
    title: "Abertura do dia",
    progress: { completed: 1, awaitingApproval: 1, total: 3 }
  });
  expect(today.routineOccurrences[0].steps.map((step) => step.title)).toEqual([
    "Conferir agenda", "Priorizar demandas", "Registrar bloqueios"
  ]);
});

it("does not expose a routine assigned to another person", async () => {
  expect((await service.readToday("workspace_a", "profile_b", "2026-07-10")).routineOccurrences).toEqual([]);
});
```

- [ ] **Step 2: Run the Today service test and verify it fails**

Run: `pnpm --filter @prymeira/baase-api test -- today.service.test.ts`

Expected: FAIL because the grouped service and DTOs do not exist.

- [ ] **Step 3: Implement stable grouped DTOs**

```ts
export type TodayProgress = {
  completed: number;
  awaitingApproval: number;
  total: number;
};

export type TodayManualTask = {
  id: string;
  title: string;
  area: { id: string | null; name: string };
  dueDate: string;
  deadline: string | null;
  priority: "low" | "medium" | "high";
  status: TaskStatus;
  checklist: Array<{ id: string; title: string; done: boolean }>;
  progress: TodayProgress;
  evidencePolicy: EvidencePolicy;
  approvalMode: TaskApprovalMode;
};

export type TodayRoutineOccurrence = {
  id: string;
  routineId: string;
  title: string;
  area: { id: string | null; name: string };
  dueDate: string;
  deadline: string | null;
  status: "pending" | "in_progress" | "awaiting_approval" | "completed";
  progress: TodayProgress;
  steps: TodayRoutineStep[];
};
```

`readToday` first ensures scheduled occurrences for the date, then loads only items visible to the profile. It returns snapshots for removed areas and titles. A manual task with checklist uses checklist length as `total`; a task without checklist uses one completion unit. `completed` excludes `awaiting_approval`; the latter has its own count. Sort manual tasks by deadline then creation and routines by deadline then title.

- [ ] **Step 4: Run Today service tests**

Run: `pnpm --filter @prymeira/baase-api test -- today.service.test.ts routine.service.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 5: Commit the Today read model**

```bash
git add apps/api/src/modules/routines/today.types.ts apps/api/src/modules/routines/today.service.ts apps/api/src/modules/routines/today.service.test.ts apps/api/src/modules/routines/routine.service.ts
git commit -m "feat: return grouped today execution"
```

### Task 3: Implement shared individual completion validation

**Files:**
- Create: `apps/api/src/modules/routines/task-completion.service.ts`
- Create: `apps/api/src/modules/routines/task-completion.service.test.ts`
- Modify: `apps/api/src/modules/routines/routine.service.ts`

- [ ] **Step 1: Write failing requirement and approval tests**

```ts
it("describes missing evidence without mutating the task", async () => {
  const preview = await service.previewTaskCompletion("workspace_a", "task_photo", "profile_a", {});
  expect(preview.requirements).toEqual([{
    taskId: "task_photo", title: "Fotografar instalação", evidencePolicy: "photo_required",
    evidenceReason: "Comprovar visualmente a instalação final", missing: ["photo"]
  }]);
  expect((await repository.findTaskOccurrence("workspace_a", "task_photo"))?.status).toBe("pending");
});

it("submits an approval-required task instead of marking it completed", async () => {
  const result = await service.completeTask("workspace_a", "task_approval", "profile_a", { comment: "Conferido" });
  expect(result.status).toBe("awaiting_approval");
});
```

- [ ] **Step 2: Run completion tests and verify they fail**

Run: `pnpm --filter @prymeira/baase-api test -- task-completion.service.test.ts`

Expected: FAIL because preview and shared completion methods do not exist.

- [ ] **Step 3: Implement one requirement engine for manual tasks and routine steps**

```ts
export type CompletionRequirement = {
  taskId: string;
  title: string;
  evidencePolicy: EvidencePolicy;
  evidenceReason: string | null;
  missing: Array<"checklist" | "comment" | "photo">;
};
```

For manual tasks, all checklist items must be done before completion. For routine steps, validate evidence only. Reject completion by a different assignee. `completeTask` throws `new ApiError(422, "TASK_COMPLETION_REQUIREMENTS", "Preencha as validações antes de concluir.", { requirements })` when preview has requirements, otherwise writes evidence, audit actor/time, and `completed` or `awaiting_approval` through `readNextTaskStatus`.

- [ ] **Step 4: Run completion and legacy route tests**

Run: `pnpm --filter @prymeira/baase-api test -- task-completion.service.test.ts routine.routes.test.ts`

Expected: all focused tests PASS; legacy `/tasks/:id/submit` remains compatible by delegating to the new service.

- [ ] **Step 5: Commit shared completion validation**

```bash
git add apps/api/src/modules/routines/task-completion.service.ts apps/api/src/modules/routines/task-completion.service.test.ts apps/api/src/modules/routines/routine.service.ts
git commit -m "feat: centralize task completion requirements"
```

### Task 4: Implement atomic and idempotent routine bulk completion

**Files:**
- Modify: `apps/api/src/modules/routines/task-completion.service.ts`
- Modify: `apps/api/src/modules/routines/task-completion.service.test.ts`
- Modify: `apps/api/src/modules/routines/postgres-routine.repository.ts`

- [ ] **Step 1: Write failing preview, rollback, approval, and idempotency tests**

```ts
it("returns all missing evidence in one bulk preview", async () => {
  const preview = await service.previewRoutineCompletion("workspace_a", "occurrence_1", "profile_a", { evidence: [] });
  expect(preview.requirements.map((item) => item.taskId)).toEqual(["step_comment", "step_photo"]);
});

it("rolls back every step when one completion write fails", async () => {
  repository.failUpdateFor("step_3");
  await expect(service.completeRoutine("workspace_a", "occurrence_1", "profile_a", validPayload, "key_1")).rejects.toThrow();
  expect((await repository.findRoutineOccurrence("workspace_a", "occurrence_1"))?.progress.completed).toBe(0);
});

it("returns the stored response for a repeated idempotency key", async () => {
  const first = await service.completeRoutine("workspace_a", "occurrence_1", "profile_a", validPayload, "key_1");
  const second = await service.completeRoutine("workspace_a", "occurrence_1", "profile_a", validPayload, "key_1");
  expect(second).toEqual(first);
  expect(repository.auditEventsFor("occurrence_1", "routine_bulk_completed")).toHaveLength(1);
});
```

- [ ] **Step 2: Run completion tests and verify bulk methods fail**

Run: `pnpm --filter @prymeira/baase-api test -- task-completion.service.test.ts`

Expected: FAIL because bulk preview/completion is missing.

- [ ] **Step 3: Implement transactional bulk completion**

`previewRoutineCompletion` validates every pending/adjustment step and returns one requirement list. `completeRoutine` requires a non-empty `Idempotency-Key`, checks for a stored completed response, validates again inside the same transaction, completes simple steps, submits approval steps, recalculates parent status/progress, stores the response in `routine_completion_requests`, and writes one parent audit event plus step events. A parent is `completed` only when every step is completed; it is `awaiting_approval` while any step awaits approval.

- [ ] **Step 4: Run completion and repository tests**

Run: `pnpm --filter @prymeira/baase-api test -- task-completion.service.test.ts operational-repositories.test.ts`

Expected: all focused tests PASS, including forced rollback and repeated request.

- [ ] **Step 5: Commit bulk completion**

```bash
git add apps/api/src/modules/routines/task-completion.service.ts apps/api/src/modules/routines/task-completion.service.test.ts apps/api/src/modules/routines/postgres-routine.repository.ts
git commit -m "feat: complete routine occurrences atomically"
```

### Task 5: Expose grouped Today, preview, completion, and evidence routes

**Files:**
- Create: `apps/api/src/modules/routines/task-evidence.routes.ts`
- Create: `apps/api/src/modules/routines/task-evidence.routes.test.ts`
- Modify: `apps/api/src/modules/routines/routine.routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/modules/routines/routine.routes.test.ts`

- [ ] **Step 1: Write failing route contract tests**

```ts
it("returns grouped Today sections", async () => {
  const response = await app.inject({ method: "GET", url: "/today?date=2026-07-10", headers: employeeHeaders });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    date: "2026-07-10",
    manual_tasks: expect.any(Array),
    routine_occurrences: expect.any(Array)
  });
});

it("requires an idempotency key for routine completion", async () => {
  const response = await app.inject({ method: "POST", url: "/routine-occurrences/occurrence_1/complete", headers: employeeHeaders, payload: { evidence: [] } });
  expect(response.statusCode).toBe(400);
  expect(response.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
});
```

- [ ] **Step 2: Run route tests and verify old Today shape/new routes fail**

Run: `pnpm --filter @prymeira/baase-api test -- routine.routes.test.ts task-evidence.routes.test.ts`

Expected: FAIL because grouped fields and completion routes are absent.

- [ ] **Step 3: Register the API contracts**

Add:

```text
GET  /today?date=YYYY-MM-DD
PATCH /tasks/:id/checklist/:itemId
POST /tasks/:id/completion-preview
POST /tasks/:id/complete
POST /routine-occurrences/:id/completion-preview
POST /routine-occurrences/:id/complete
POST /tasks/:id/evidence/files
DELETE /tasks/:id/evidence/:evidenceId
```

The checklist item route accepts `{ done: boolean }` and updates one relational row to avoid lost updates between devices. Bulk bodies use `{ evidence: [{ task_id, comment, evidence_id }] }`. Preview returns `{ requirements }`; completion returns `{ routine_occurrence }`. Photo upload uses the phase 1 object-storage port and returns a task-scoped evidence ID, never a public permanent URL. Continue returning `training_assignments` and `announcements`. Keep legacy `tasks` in the Today response for one release only when `BAASE_TODAY_LEGACY_RESPONSE=true`.

- [ ] **Step 4: Run route tests and the full API suite**

Run: `pnpm --filter @prymeira/baase-api test && pnpm --filter @prymeira/baase-api typecheck`

Expected: all API tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit execution API routes**

```bash
git add apps/api/src/modules/routines/task-evidence.routes.ts apps/api/src/modules/routines/task-evidence.routes.test.ts apps/api/src/modules/routines/routine.routes.ts apps/api/src/modules/routines/routine.routes.test.ts apps/api/src/app.ts
git commit -m "feat: expose grouped today execution api"
```

### Task 6: Build the responsive manual task card

**Files:**
- Create: `apps/web/src/components/today/evidence-field.tsx`
- Create: `apps/web/src/components/today/manual-task-card.tsx`
- Create: `apps/web/src/components/today/manual-task-card.test.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write failing collapsed, checklist, and validation tests**

```tsx
it("starts collapsed, shows progress, and updates checklist inline", async () => {
  render(<ManualTaskCard task={manualTask({ progress: { completed: 0, awaitingApproval: 0, total: 3 } })} api={api} />);
  expect(screen.getByText("0/3")).toBeInTheDocument();
  expect(screen.queryByText("Checklist item 1")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Expandir tarefa Teste" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Checklist item 1" }));
  expect(api.updateChecklistItem).toHaveBeenCalledWith("task_1", "item_1", true);
});

it("opens compact evidence input only when completion requires it", async () => {
  render(<ManualTaskCard task={manualTask({ evidencePolicy: "comment_required" })} api={api} />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Concluir tarefa Teste" }));
  expect(await screen.findByLabelText("Comentário obrigatório")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run card tests and verify components are missing**

Run: `pnpm --filter @prymeira/baase-web test -- manual-task-card.test.tsx`

Expected: FAIL with unresolved component imports.

- [ ] **Step 3: Implement the manual task card**

The collapsed row shows checkbox, title, area, deadline, priority, and `x/y`; the chevron is a separate icon button with `aria-expanded`. Expansion reveals checklist rows with stable height and optimistic updates that roll back on API failure. Card completion previews requirements; optional/no-checklist tasks complete directly, while required evidence opens `EvidenceField`. Preserve the existing `task-row`, pills, border, typography, and neutral background behavior.

- [ ] **Step 4: Run manual card tests and web typecheck**

Run: `pnpm --filter @prymeira/baase-web test -- manual-task-card.test.tsx && pnpm --filter @prymeira/baase-web typecheck`

Expected: tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the manual task card**

```bash
git add apps/web/src/components/today/evidence-field.tsx apps/web/src/components/today/manual-task-card.tsx apps/web/src/components/today/manual-task-card.test.tsx apps/web/src/api.ts apps/web/src/styles.css
git commit -m "feat: add inline manual task execution card"
```

### Task 7: Build the routine card and consolidated bulk review

**Files:**
- Create: `apps/web/src/components/today/routine-occurrence-card.tsx`
- Create: `apps/web/src/components/today/routine-occurrence-card.test.tsx`
- Create: `apps/web/src/components/today/completion-review-dialog.tsx`
- Create: `apps/web/src/components/today/completion-review-dialog.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write failing expansion, confirmation, requirements, and approval tests**

```tsx
it("shows one collapsed routine card instead of nine task rows", () => {
  render(<RoutineOccurrenceCard occurrence={routineOccurrence({ stepCount: 9 })} api={api} />);
  expect(screen.getByText("0/9")).toBeInTheDocument();
  expect(screen.queryByText("Etapa 1")).not.toBeInTheDocument();
});

it("confirms the count and consolidates missing evidence", async () => {
  api.previewRoutineCompletion.mockResolvedValue({ requirements: [commentRequirement, photoRequirement] });
  render(<RoutineOccurrenceCard occurrence={routineOccurrence({ stepCount: 9 })} api={api} />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Concluir rotina Abertura do dia" }));
  expect(screen.getByText("Você está concluindo 9 etapas. Deseja continuar?")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
  expect(await screen.findByText("2 validações pendentes")).toBeInTheDocument();
  expect(screen.getAllByLabelText(/Comentário|Foto/)).toHaveLength(2);
});

it("renders awaiting approval separately from completed progress", () => {
  render(<RoutineOccurrenceCard occurrence={routineOccurrence({ progress: { completed: 6, awaitingApproval: 2, total: 9 } })} api={api} />);
  expect(screen.getByText("6/9")).toBeInTheDocument();
  expect(screen.getByText("2 aguardando aprovação")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run routine card tests and verify components are missing**

Run: `pnpm --filter @prymeira/baase-web test -- routine-occurrence-card.test.tsx completion-review-dialog.test.tsx`

Expected: FAIL with unresolved component imports.

- [ ] **Step 3: Implement routine interaction and one review dialog**

The card starts collapsed and expands into ordered step rows. A simple step checkbox calls individual preview/completion; a step with requirements opens a compact inline evidence disclosure. The parent checkbox always opens the count confirmation. After confirmation, call bulk preview; if requirements exist, replace confirmation content with one scrollable review grouping fields by step. Submit with one idempotency key generated when the dialog opens and retained across retry. Show `Enviado para aprovação` at step level and never mark the parent complete until approvals finish.

- [ ] **Step 4: Run routine card tests and accessibility assertions**

Run: `pnpm --filter @prymeira/baase-web test -- routine-occurrence-card.test.tsx completion-review-dialog.test.tsx`

Expected: all focused tests PASS with no missing accessible names.

- [ ] **Step 5: Commit routine execution UI**

```bash
git add apps/web/src/components/today/routine-occurrence-card.tsx apps/web/src/components/today/routine-occurrence-card.test.tsx apps/web/src/components/today/completion-review-dialog.tsx apps/web/src/components/today/completion-review-dialog.test.tsx apps/web/src/styles.css
git commit -m "feat: add grouped routine execution card"
```

### Task 8: Replace the flat Today page and preserve open state

**Files:**
- Create: `apps/web/src/components/today/today-view.tsx`
- Create: `apps/web/src/components/today/today-view.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write failing integrated Today tests**

```tsx
it("renders separate manual and routine sections from the grouped API", async () => {
  render(<TodayView data={todayData} api={api} canCreateTask onCreateTask={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "Tarefas pontuais" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Rotinas de hoje" })).toBeInTheDocument();
  expect(screen.getAllByTestId("routine-occurrence-card")).toHaveLength(todayData.routineOccurrences.length);
});

it("keeps a routine expanded after its progress refreshes", async () => {
  const { rerender } = render(<TodayView data={todayData} api={api} canCreateTask onCreateTask={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Expandir rotina Abertura do dia" }));
  rerender(<TodayView data={updatedTodayData} api={api} canCreateTask onCreateTask={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Recolher rotina Abertura do dia" })).toHaveAttribute("aria-expanded", "true");
});
```

- [ ] **Step 2: Run Today tests and verify the old flat page fails expectations**

Run: `pnpm --filter @prymeira/baase-web test -- today-view.test.tsx App.test.tsx api.test.ts`

Expected: FAIL because `TodayView` is still inline and consumes `tasks`.

- [ ] **Step 3: Mount the grouped view and remove flat-row execution**

Map API snake_case once inside `api.ts`. Keep expanded IDs in `TodayView` state keyed by occurrence/task ID, not by array index. Daily progress counts completed manual cards plus completed routine steps and excludes awaiting approval. Keep pending announcements and trainings below execution. Remove the click-anywhere behavior that opened `ExecutionModal`; retain that modal only for legacy approval review until its replacement is separately designed.

- [ ] **Step 4: Run all web unit tests and production build**

Run: `pnpm --filter @prymeira/baase-web test && pnpm --filter @prymeira/baase-web typecheck && pnpm --filter @prymeira/baase-web build`

Expected: all web tests PASS and production build succeeds.

- [ ] **Step 5: Commit the grouped Today page**

```bash
git add apps/web/src/components/today/today-view.tsx apps/web/src/components/today/today-view.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/api.ts apps/web/src/api.test.ts apps/web/src/styles.css
git commit -m "feat: replace flat today list with grouped cards"
```

### Task 9: Verify desktop and mobile behavior with Playwright

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/today-execution.spec.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add desktop and mobile end-to-end scenarios**

```ts
test.describe("Today execution", () => {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 }
  ]) {
    test(`${viewport.name}: expands and completes a routine with validation`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/hoje");
      await page.getByRole("button", { name: "Expandir rotina Abertura do dia" }).click();
      await expect(page.getByText("0/3")).toBeVisible();
      await page.getByRole("checkbox", { name: "Concluir rotina Abertura do dia" }).click();
      await expect(page.getByText("Você está concluindo 3 etapas. Deseja continuar?")).toBeVisible();
      await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
    });
  }
});
```

- [ ] **Step 2: Configure Playwright and deterministic API fixtures**

Use Chromium projects named `desktop-chromium` and `mobile-chromium`. Start the Vite app through `webServer`; intercept session and `/api/today` plus completion endpoints with fixture JSON so the test does not depend on Clerk or production data. Save screenshots on failure and traces on first retry.

- [ ] **Step 3: Run the end-to-end suite**

Run: `pnpm --filter @prymeira/baase-web exec playwright install chromium && pnpm --filter @prymeira/baase-web test:e2e`

Expected: both desktop and mobile projects PASS with no horizontal overflow or overlapping controls.

- [ ] **Step 4: Commit responsive browser coverage**

```bash
git add apps/web/playwright.config.ts apps/web/e2e/today-execution.spec.ts apps/web/package.json pnpm-lock.yaml
git commit -m "test: cover today execution on desktop and mobile"
```

### Task 10: Run the production migration and release gate

**Files:**
- Modify: `docs/deployment-operational-migration.md`
- Modify: `.env.production.example`

- [ ] **Step 1: Document the release toggles and smoke workflow**

Add `BAASE_TODAY_LEGACY_RESPONSE=true` for the first deploy. Document tests for one manual task with three checklist items, one nine-step routine, optional step completion, required photo/comment, one approval step, bulk completion retry with the same idempotency key, and mobile Safari viewport. After the new web image is verified, set the legacy response flag to `false` in the next stack update.

- [ ] **Step 2: Run the complete repository verification**

Run: `pnpm test && pnpm typecheck && pnpm build && pnpm --filter @prymeira/baase-web test:e2e && docker compose -f docker-compose.prod.yml config >/tmp/baase-compose.yml`

Expected: unit/integration tests, typechecks, builds, browser tests, and compose validation all exit 0.

- [ ] **Step 3: Commit release documentation**

```bash
git add docs/deployment-operational-migration.md .env.production.example
git commit -m "docs: add grouped today release gate"
```

## Phase 3 Acceptance Gate

- [ ] Today has separate compact sections for manual tasks and routine occurrences.
- [ ] A nine-step routine renders as one collapsed card with `0/9`, not nine top-level rows.
- [ ] Manual checklist items and routine steps can be completed inline.
- [ ] Parent routine completion confirms the count and collects all missing evidence in one review.
- [ ] Bulk completion is transactional and idempotent; partial silent completion is impossible.
- [ ] Awaiting approval is visible and does not count as completed.
- [ ] Expanded state survives progress refreshes during the current navigation.
- [ ] Desktop and mobile use the same real interaction with no demonstration phone or missing controls.
