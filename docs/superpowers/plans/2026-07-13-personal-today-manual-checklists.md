# Personal Today and Manual Checklists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Today personal for individual task occurrences across every role and give manual checklist tasks the same inline progress and controls as routine occurrences.

**Architecture:** Keep global owner and area-manager access policies unchanged for oversight screens. Add a Today-specific visibility rule that narrows individually assigned tasks to the authenticated person while preserving shared unassigned work. Reuse one inline checklist renderer for manual and routine tasks, and derive the day progress from the displayed task rows.

**Tech Stack:** TypeScript, Fastify, React, Vitest, Testing Library, CSS.

---

### Task 1: Today-specific individual visibility

**Files:**
- Modify: `apps/api/src/modules/routines/routine.routes.ts`
- Test: `apps/api/src/modules/routines/routine.routes.test.ts`

- [ ] **Step 1: Write the failing route assertion**

Change the individual routine access test so the owner Today response is empty when the owner is not one of the assignees, while the owner can still open task details through the oversight route.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @prymeira/baase-api exec vitest run src/modules/routines/routine.routes.test.ts -t "isolates individual technical routine tasks"`

Expected: FAIL because `/today` currently returns every individual occurrence to the owner.

- [ ] **Step 3: Add the Today-specific predicate**

Add a predicate in `routine.routes.ts` with this behavior:

```ts
function canReadTodayTask(member: OperationalMembership, task: TaskOccurrence) {
  if (task.assigneeProfileId) return task.assigneeProfileId === member.personId;
  return canReadTask(member, task);
}
```

Use it only in `GET /today`; keep `canReadTask` unchanged for dashboards, task details, and oversight.

- [ ] **Step 4: Run the focused route test**

Run the command from Step 2.

Expected: PASS.

### Task 2: Inline checklist for manual tasks and consistent day progress

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write failing UI assertions**

Extend the manual checklist test to assert that Today shows `0/3 concluídos`, exposes an expand button, renders three checkboxes inline, saves the clicked item through `PATCH /api/tasks/:id/checklist`, and updates to `1/3 concluídos` without opening the execution modal.

Add an assertion that the day progress total matches the displayed task rows even when `dashboard.employeeToday` reports zero.

- [ ] **Step 2: Run the focused UI tests and verify they fail**

Run: `pnpm --filter @prymeira/baase-web exec vitest run src/App.test.tsx -t "manual checklist|individual routine execution"`

Expected: FAIL because manual checklist tasks still use `TodayTaskButton` and the dashboard summary overrides the visible row count.

- [ ] **Step 3: Reuse the inline checklist renderer**

Inside `TodayPage`, extract the current occurrence markup into one renderer used by routine occurrences and manual tasks that have `checklistItems`. Keep `TodayTaskButton` only for tasks without checklist items. Preserve the existing busy state, checkbox persistence, contextual final action, status labels, and accessibility labels.

- [ ] **Step 4: Derive progress from visible rows**

Set the day total and completed values from `taskRows` so the bar and `N de M` always describe the tasks rendered immediately below it.

- [ ] **Step 5: Run the focused UI tests**

Run the command from Step 2.

Expected: PASS.

### Task 3: Regression verification and publication

**Files:**
- Verify all modified source and test files.

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands exit with status 0.

- [ ] **Step 2: Commit and push**

Run:

```bash
git add docs/superpowers/specs/2026-07-13-production-access-today-owner-dashboard-design.md docs/superpowers/plans/2026-07-13-personal-today-manual-checklists.md apps/api/src/modules/routines/routine.routes.ts apps/api/src/modules/routines/routine.routes.test.ts apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/styles.css
git commit -m "fix: keep Today personal across roles"
git push origin main
```

Expected: `origin/main` advances to the new commit and the worktree is clean.
