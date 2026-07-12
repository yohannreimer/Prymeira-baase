# Team Invitations Account Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace legacy workspace-code invitation controls with a clear Account Hub email invitation flow and unambiguous access reach controls.

**Architecture:** Keep the existing company invitation API contract and Account Hub handoff. Simplify the web surface in account mode, derive area access from the selected reach, and display pending email invitations as manageable operational records.

**Tech Stack:** React 19, TypeScript, Vitest, Fastify, Prymeira Account Hub.

---

### Task 1: Cover account invitation behavior in the web app

**Files:**
- Modify: `apps/web/src/App.test.tsx`

- [x] Add a failing integration-style UI test with an account-mode invite fixture.

```tsx
expect(screen.queryByText("Link de convite do workspace")).not.toBeInTheDocument();
expect(screen.queryByText("Aceitar convite por código")).not.toBeInTheDocument();
expect(screen.getByText("Convites pendentes")).toBeInTheDocument();
```

- [x] Assert that the invite dialog exposes `Alcance de acesso` and reveals selected areas only for `Áreas específicas`.
- [x] Run `pnpm --filter @prymeira/baase-web test -- App.test.tsx` and confirm the new test fails before the UI change.

### Task 2: Replace the team invitation surface

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [x] Remove the workspace link copy action and code acceptance panel from `TeamPage`.
- [x] Add a pending-invitations section that shows invitee, email, configured reach, pending state, and an icon action to revoke.
- [x] Refactor `InviteForm` to use `Área principal` and `Alcance de acesso`; map the choices to `accessScope` and `areaAccessIds` without changing API payload names.
- [x] Render specific areas as a stable list of full-width selectable rows only for the specific-area reach.
- [x] Add responsive styles that prevent labels and controls from overlapping at desktop and mobile widths.

### Task 3: Align person editing with invitation semantics

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [x] Use the same `Área principal` and `Alcance de acesso` wording in the existing person editor.
- [x] Keep role templates filtered by primary area and preserve the primary area in selected area access.
- [x] Verify that changing a person from specific areas to assigned-only or company-wide does not leave misleading visible area controls.

### Task 4: Verify production behavior

**Files:**
- Test: `apps/web/src/App.test.tsx`
- Test: `apps/api/src/modules/company/company.routes.test.ts`

- [x] Run `pnpm --filter @prymeira/baase-web test -- App.test.tsx`.
- [x] Run `pnpm --filter @prymeira/baase-api test -- company.routes.test.ts`.
- [x] Run `pnpm typecheck` and `pnpm --filter @prymeira/baase-web build`.
- [x] Confirm with `git diff --check` that the patch has no whitespace errors.
