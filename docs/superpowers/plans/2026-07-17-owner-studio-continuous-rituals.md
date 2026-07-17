# Owner Studio Continuous Rituals — Lean Implementation Plan

> **Execution:** inline on `codex/studio-continuous-rituals`, with focused tests per block and one complete verification at the end.

**Goal:** Make daily rituals simple and persistent, preserve dated history, and let the owner choose how active the AI should be.

**Architecture:** Persist `support_mode` on the ritual and snapshot it into each session. Keep the existing session/history foundation, but separate the answer revision from background AI updates so preparation cannot create a false tab conflict. Reuse the current ritual UI and API instead of rebuilding the whole Studio.

**Out of this round:** comparison views, per-execution material linking, structured creation of goals/decisions/plans, and a separate ritual-version table. These can be added after the central experience is proven.

---

### Block 1: Support modes and grounded defaults

**Files:**
- `packages/shared/src/studio-structures.ts`
- `packages/shared/src/studio-structures.test.ts`
- `apps/api/src/modules/studio/studio.schemas.ts`
- `apps/api/src/modules/studio/studio.types.ts`
- `apps/web/src/studio/studio.types.ts`
- `apps/web/src/studio/StudioRituals.tsx`

- [x] Add `record_only`, `light_summary`, and `guided_reflection` to the shared contract.
- [x] Derive the initial suggestion from cadence: daily → record only, weekly → light summary, monthly → guided reflection.
- [x] Allow the owner to override the suggestion in the builder; once manually selected, cadence changes do not overwrite it.
- [x] Persist the explicit mode in `properties_json.support_mode`.
- [x] Add focused contract, schema, and builder tests.

Verification:

```bash
pnpm --filter @prymeira/baase-shared test -- studio-structures.test.ts
pnpm --filter @prymeira/baase-api test -- studio.schemas.test.ts
pnpm --filter @prymeira/baase-web test -- StudioRituals.test.tsx
```

### Block 2: Separate human answers from background IA

**Files:**
- `apps/api/src/db/operational-schema.ts`
- `apps/api/src/db/operational-schema.test.ts`
- `apps/api/src/modules/studio/studio.types.ts`
- `apps/api/src/modules/studio/postgres-studio.repository.ts`
- `apps/api/src/modules/studio/in-memory-studio.repository.ts`
- `apps/api/src/modules/studio/studio.repository.test.ts`
- `apps/api/src/modules/studio/studio-ritual.service.ts`
- `apps/api/src/modules/studio/studio-ritual.service.test.ts`

- [x] Add migration 32 columns `support_mode`, `occurrence_at`, and `answer_revision` to ritual sessions.
- [x] Snapshot mode and occurrence when a session starts.
- [x] Add a repository operation that updates answers using only `answer_revision`; AI jobs continue using the internal session revision.
- [x] Make `record_only` start ready and finish without preparation or synthesis calls.
- [x] Queue/execute AI only for assisted modes.
- [x] Reproduce the current race in a test, then prove preparation and answer saving can finish in either order without false conflict.

Verification:

```bash
pnpm --filter @prymeira/baase-api test -- \
  operational-schema.test.ts \
  studio.repository.test.ts \
  studio-ritual.service.test.ts
```

### Block 3: Ritual detail and dated history

**Files:**
- `apps/api/src/modules/studio/studio.schemas.ts`
- `apps/api/src/modules/studio/studio.routes.ts`
- `apps/api/src/modules/studio/studio-ritual.routes.test.ts`
- `apps/web/src/studio/studio-api.ts`
- `apps/web/src/studio/studio-api.test.ts`
- `apps/web/src/studio/StudioRituals.tsx`
- `apps/web/src/studio/studio.css`

- [x] Clicking a ritual opens its detail instead of immediately creating a session.
- [x] Show name, cadence, selected support mode, next execution, and an explicit `Começar agora` action.
- [x] Render existing sessions as a dated timeline with original answers and AI content in separate sections.
- [x] Keep pagination with the existing session cursor; period filtering remains out of this lean round.
- [x] Provide a settings action to change mode for future executions only.
- [x] Keep the original mode visible on historical sessions.

Verification:

```bash
pnpm --filter @prymeira/baase-api test -- studio-ritual.routes.test.ts
pnpm --filter @prymeira/baase-web test -- studio-api.test.ts StudioRituals.test.tsx
```

### Block 4: Calm completion and intentional AI

**Files:**
- `apps/api/src/modules/studio/studio-ritual.service.ts`
- `apps/api/src/modules/studio/studio-ritual.service.test.ts`
- `apps/web/src/studio/StudioRituals.tsx`
- `apps/web/src/studio/StudioRituals.test.tsx`
- `apps/web/src/studio/studio.css`

- [x] In `record_only`, finish with `Ritual registrado`, the saved answers, and no automatic suggestion list.
- [x] In `light_summary`, show a short AI summary separated from original answers.
- [x] In `guided_reflection`, keep a deeper reflection but cap visible suggestions and remove the meaningless `Pendente` badges.
- [x] Add `Aprofundar com IA` to a completed record so analysis remains an explicit option.
- [x] If AI fails, preserve completion and show a quiet retry action.
- [x] Replace generic conflict copy with answer-specific conflict copy only when `answer_revision` is stale.

Verification:

```bash
pnpm --filter @prymeira/baase-api test -- studio-ritual.service.test.ts
pnpm --filter @prymeira/baase-web test -- StudioRituals.test.tsx
```

### Block 5: Final browser and repository verification

**Files:**
- `tests/e2e/owner-studio-server.ts`
- `tests/e2e/owner-studio.spec.ts`
- `docs/qa/2026-07-17-owner-studio-continuous-rituals.md`

- [x] Update the deterministic harness for all three modes.
- [x] Cover a daily three-question record with zero automatic AI and history after reopening.
- [x] Cover a weekly light summary and a monthly guided reflection.
- [x] Cover one-tab preparation while typing without conflict and a genuine stale answer revision with conflict.
- [x] Inspect the final desktop and narrow layouts in the browser.
- [x] Run the complete typecheck, build, focused E2E, and diff audit once.

Final verification:

```bash
pnpm typecheck
pnpm build
pnpm exec playwright test tests/e2e/owner-studio.spec.ts --project=chromium
git diff --check
```

Expected result: daily rituals are fast and grounded; every execution stays visible by date; mode changes affect future executions; AI is optional and clearly separated; background preparation no longer masquerades as another browser tab.
