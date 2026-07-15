# Owner Studio Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the owner-only Studio reliable end to end: configurable AI, vector connections, checkpoint history, compact materials, working structure libraries, durable collections, trash, non-blocking rituals, observable exports, and production smoke coverage.

**Architecture:** Keep `studio_documents` as the mutable current draft and make `studio_document_versions` immutable checkpoints only. Reuse the existing owner-scoped repositories and workers, adding explicit runtime capability diagnostics and pgvector-backed indexing. Build calm query-driven libraries and side inspectors in React while preserving the original document as the single source of truth.

**Tech Stack:** TypeScript, Fastify, React 19, TipTap, PostgreSQL 16 + pgvector, MinIO/S3, OpenAI Responses/Embeddings APIs, Vitest, Testing Library, Playwright, Docker Swarm Compose.

---

## File map and boundaries

- `apps/api/src/config/runtime.ts`: parse AI/vector Studio runtime settings; never contain UI behavior.
- `apps/api/src/modules/ai/providers/default-ai.provider.ts`: select real, mock, or unavailable providers from runtime policy.
- `apps/api/src/modules/studio/studio-readiness.ts`: evaluate Studio AI/vector/worker capabilities without accessing private content.
- `apps/api/src/modules/studio/studio.types.ts`: shared API domain types for checkpoints, trash, and index state.
- `apps/api/src/modules/studio/studio.schemas.ts`: request validation only.
- `apps/api/src/modules/studio/studio.service.ts`: document lifecycle, checkpoint rules, and owner-scope invariants.
- `apps/api/src/modules/studio/{in-memory,postgres}-studio.repository.ts`: persistence; draft writes must not create versions.
- `apps/api/src/modules/studio/studio.routes.ts`: owner-only HTTP contract and error mapping.
- `apps/api/src/modules/studio/studio-memory.ts`: index job status and checkpoint-driven processing.
- `apps/api/src/modules/studio/studio-ritual.service.ts`: immediate session plus background preparation.
- `apps/api/src/modules/studio/studio-portability.service.ts`: export state machine and downloadable result.
- `apps/api/src/db/operational-schema.ts`: additive migration for checkpoints, trash, and vector readiness metadata.
- `apps/web/src/studio/studio-api.ts`: typed wire adapter; no view state.
- `apps/web/src/studio/StudioStructureLibrary.tsx`: calm Goals/Decisions/Plans library.
- `apps/web/src/studio/StudioVersionDrawer.tsx`: paginated checkpoint history.
- `apps/web/src/studio/StudioMaterialList.tsx`: compact material rows.
- `apps/web/src/studio/StudioMaterialInspector.tsx`: secondary material actions and full extraction.
- `apps/web/src/studio/StudioTrash.tsx`: restore and permanent deletion.
- `apps/web/src/studio/StudioPage.tsx`: route composition and cache invalidation only.
- `apps/web/src/studio/studio.css`: Quiet Ops visuals, responsive states, focus and motion.
- `tests/e2e/owner-studio.spec.ts`: full owner flows against the E2E API.
- `tests/e2e/owner-studio-production-smoke.spec.ts`: opt-in deployed-environment smoke.
- `docker-compose.prod.yml`: pgvector image, Studio env, and healthchecks.

## Phase 1 — Runtime, AI, and vector prerequisites

### Task 1: Parse the Studio model settings once

**Files:**
- Modify: `apps/api/src/config/runtime.ts`
- Test: `apps/api/src/config/runtime.test.ts`

- [x] **Step 1: Write the failing runtime configuration test**

```ts
it("uses the approved Studio models and allows explicit overrides", () => {
  expect(readRuntimeConfig({ OPENAI_API_KEY: "sk-test" }).studio).toEqual({
    enabled: false,
    vectorConfigured: false,
    aiModel: "gpt-5.6-terra",
    embeddingModel: "text-embedding-3-small"
  });
  expect(readRuntimeConfig({
    OPENAI_API_KEY: "sk-test",
    BAASE_STUDIO_AI_MODEL: "studio-private-model",
    BAASE_STUDIO_EMBEDDING_MODEL: "text-embedding-3-large"
  }).studio).toMatchObject({
    aiModel: "studio-private-model",
    embeddingModel: "text-embedding-3-large"
  });
});
```

- [x] **Step 2: Run the focused test and confirm the missing fields**

Run: `pnpm --filter @prymeira/baase-api test -- src/config/runtime.test.ts`  
Expected: FAIL because `aiModel` and `embeddingModel` are absent.

- [x] **Step 3: Add validated model settings**

```ts
const DEFAULT_STUDIO_AI_MODEL = "gpt-5.6-terra";
const DEFAULT_STUDIO_EMBEDDING_MODEL = "text-embedding-3-small";

function readModelId(value: string | undefined, fallback: string) {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(normalized)) {
    throw new Error("STUDIO_MODEL_ID_INVALID");
  }
  return normalized;
}
```

Return both fields under `runtimeConfig.studio` and extend `BaaseRuntimeConfig` accordingly.

- [x] **Step 4: Re-run the runtime tests**

Run: `pnpm --filter @prymeira/baase-api test -- src/config/runtime.test.ts`  
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/config/runtime.ts apps/api/src/config/runtime.test.ts
git commit -m "feat(studio): configure approved AI models"
```

### Task 2: Inject the configured model into every Studio AI call

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/modules/studio/studio-assistant.service.ts`
- Modify: `apps/api/src/modules/studio/studio-ritual.service.ts`
- Test: `apps/api/src/modules/studio/studio-assistant.service.test.ts`
- Test: `apps/api/src/modules/studio/studio-ritual.service.test.ts`

- [x] **Step 1: Write tests proving the configured model reaches the harness**

```ts
const service = createStudioAssistantService({
  repository,
  harness,
  contextBuilder,
  model: "gpt-5.6-terra"
});
await collect(service.runTurn(scope, { message: "Revise", documentId }));
expect(harness.runText).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.6-terra" }));
```

Add the equivalent expectation for ritual preparation and synthesis.

- [x] **Step 2: Run both focused suites and verify they fail**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-assistant.service.test.ts src/modules/studio/studio-ritual.service.test.ts`  
Expected: FAIL because the services still send `gpt-5.5`.

- [x] **Step 3: Add required `model` options and remove Studio hardcoding**

```ts
type StudioAssistantServiceOptions = {
  repository: StudioRepository;
  harness: AiHarness;
  contextBuilder: StudioContextBuilder;
  model: string;
  now?: () => Date;
};

// Every Studio harness request:
model: options.model
```

In `buildApp`, pass `runtimeConfig.studio.aiModel` to assistant and ritual services and `runtimeConfig.studio.embeddingModel` to the memory index.

- [x] **Step 4: Re-run focused tests and typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-assistant.service.test.ts src/modules/studio/studio-ritual.service.test.ts && pnpm --filter @prymeira/baase-api typecheck`  
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/modules/studio/studio-assistant.service.ts apps/api/src/modules/studio/studio-ritual.service.ts apps/api/src/modules/studio/*service.test.ts
git commit -m "fix(studio): use configured AI model"
```

### Task 3: Remove silent production AI mocks and expose readiness

**Files:**
- Create: `apps/api/src/modules/ai/providers/unavailable-ai.provider.ts`
- Create: `apps/api/src/modules/studio/studio-readiness.ts`
- Create: `apps/api/src/modules/studio/studio-readiness.test.ts`
- Modify: `apps/api/src/modules/ai/providers/default-ai.provider.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/modules/studio/studio.routes.ts`

- [ ] **Step 1: Write failing readiness and provider-policy tests**

```ts
it("reports unavailable instead of returning mock Studio AI in production", async () => {
  const provider = createDefaultAiProvider({ mode: "production", openAiApiKey: null });
  await expect(provider.generateStructured(request)).rejects.toThrow("AI_PROVIDER_UNAVAILABLE");
});

it("never includes private text in readiness output", async () => {
  const status = await readStudioReadiness(dependencies);
  expect(JSON.stringify(status)).not.toContain("private document body");
});
```

- [ ] **Step 2: Run and observe failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-readiness.test.ts`  
Expected: FAIL because the readiness module and unavailable provider do not exist.

- [ ] **Step 3: Implement safe capability status**

```ts
export type StudioCapability = { status: "ready" | "degraded" | "unavailable"; code: string | null };
export type StudioReadiness = {
  ai: StudioCapability;
  embeddings: StudioCapability;
  vector: StudioCapability;
  maintenance: StudioCapability;
};

export function createUnavailableAiProvider(code = "AI_PROVIDER_UNAVAILABLE"): AiProvider {
  const unavailable = async () => { throw new Error(code); };
  return {
    generateStructured: unavailable,
    streamText: async function* () { throw new Error(code); },
    createEmbeddings: unavailable,
    transcribeAudio: unavailable
  };
}
```

Register owner-only `GET /studio/readiness` and map provider/model/vector errors to stable codes without message bodies.

- [ ] **Step 4: Run readiness, route, and provider tests**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-readiness.test.ts src/modules/studio/studio.routes.test.ts src/modules/ai/ai-providers.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ai/providers apps/api/src/modules/studio/studio-readiness* apps/api/src/modules/studio/studio.routes.ts apps/api/src/app.ts
git commit -m "feat(studio): expose honest AI readiness"
```

### Task 4: Make pgvector a production prerequisite

**Files:**
- Modify: `docker-compose.prod.yml`
- Modify: `.env.production.example`
- Modify: `apps/api/src/server-initialization.ts`
- Test: `apps/api/src/server-initialization.test.ts`
- Test: `apps/api/src/db/operational-schema.postgres.test.ts`

- [ ] **Step 1: Add failing runtime prerequisite tests**

```ts
it("rejects vector-enabled Studio when pgvector cannot be initialized", async () => {
  const pool = vectorUnavailablePool();
  await expect(initializeStudioVectorRuntime(pool, {
    enabled: true,
    vectorConfigured: true,
    aiModel: "gpt-5.6-terra",
    embeddingModel: "text-embedding-3-small"
  })).rejects.toThrow("STUDIO_MEMORY_VECTOR_PREREQUISITE_UNAVAILABLE");
});
```

- [ ] **Step 2: Run the focused initialization tests**

Run: `pnpm --filter @prymeira/baase-api test -- src/server-initialization.test.ts src/db/operational-schema.postgres.test.ts`  
Expected: FAIL because vector readiness is lazy.

- [ ] **Step 3: Update compose and startup initialization**

```yaml
prymeira_baase_postgres:
  image: pgvector/pgvector:pg16
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres -d baase"]
    interval: 10s
    timeout: 5s
    retries: 12

prymeira_baase_api:
  environment:
    BAASE_STUDIO_ENABLED: "true"
    BAASE_STUDIO_VECTOR_ENABLED: "true"
    BAASE_STUDIO_AI_MODEL: ${BAASE_STUDIO_AI_MODEL:-gpt-5.6-terra}
    BAASE_STUDIO_EMBEDDING_MODEL: ${BAASE_STUDIO_EMBEDDING_MODEL:-text-embedding-3-small}
  healthcheck:
    test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3090/studio/readiness',{headers:{'x-baase-role':'dono','x-workspace-id':'health','x-profile-id':'health'}}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"]
    interval: 15s
    timeout: 8s
    retries: 12

prymeira_baase_minio:
  healthcheck:
    test: ["CMD-SHELL", "wget -q -O- http://127.0.0.1:9000/minio/health/live >/dev/null"]
    interval: 10s
    timeout: 5s
    retries: 12
```

Call `CREATE EXTENSION IF NOT EXISTS vector` during PostgreSQL runtime initialization when vector is enabled. Preserve the named external volume.

- [ ] **Step 4: Run tests and validate compose rendering**

Run: `pnpm --filter @prymeira/baase-api test -- src/server-initialization.test.ts src/db/operational-schema.postgres.test.ts && docker compose -f docker-compose.prod.yml config >/dev/null`  
Expected: PASS and compose exits 0.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.prod.yml .env.production.example apps/api/src/server-initialization.ts apps/api/src/server-initialization.test.ts apps/api/src/db/operational-schema.postgres.test.ts
git commit -m "fix(studio): require pgvector in production"
```

## Phase 2 — Draft persistence, checkpoints, history, and materials

### Task 5: Add checkpoint and trash fields through an additive migration

**Files:**
- Modify: `apps/api/src/db/operational-schema.ts`
- Modify: `apps/api/src/modules/studio/studio.types.ts`
- Modify: `apps/web/src/studio/studio.types.ts`
- Test: `apps/api/src/db/operational-schema.test.ts`
- Test: `apps/api/src/db/operational-schema.postgres.test.ts`

- [ ] **Step 1: Write migration contract tests**

```ts
expect(columns("studio_document_versions")).toEqual(expect.arrayContaining([
  "title", "checkpoint_reason", "source_revision", "is_legacy"
]));
expect(columns("studio_documents")).toEqual(expect.arrayContaining([
  "trashed_at", "pre_trash_status"
]));
```

- [ ] **Step 2: Run schema tests and verify missing columns**

Run: `pnpm --filter @prymeira/baase-api test -- src/db/operational-schema.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Add the next migration and compatible types**

```sql
ALTER TABLE studio_documents
  ADD COLUMN trashed_at TIMESTAMPTZ,
  ADD COLUMN pre_trash_status TEXT;
ALTER TABLE studio_documents DROP CONSTRAINT studio_documents_status_check;
ALTER TABLE studio_documents ADD CONSTRAINT studio_documents_status_check
  CHECK (status IN ('active','archived','trashed'));

ALTER TABLE studio_document_versions
  ADD COLUMN title TEXT,
  ADD COLUMN checkpoint_reason TEXT NOT NULL DEFAULT 'legacy_autosave',
  ADD COLUMN source_revision INTEGER,
  ADD COLUMN is_legacy BOOLEAN NOT NULL DEFAULT TRUE;
```

Extend statuses and wire types with `trashed`, checkpoint `title`, `checkpointReason`, `sourceRevision`, and `isLegacy`.

- [ ] **Step 4: Run schema suites**

Run: `pnpm --filter @prymeira/baase-api test -- src/db/operational-schema.test.ts src/db/operational-schema.postgres.test.ts`  
Expected: PASS; PostgreSQL test may skip only with the explicit vector prerequisite code.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/operational-schema.ts apps/api/src/db/operational-schema*.test.ts apps/api/src/modules/studio/studio.types.ts apps/web/src/studio/studio.types.ts
git commit -m "feat(studio): add checkpoint and trash schema"
```

### Task 6: Stop draft writes from creating immutable versions

**Files:**
- Modify: `apps/api/src/modules/studio/postgres-studio.repository.ts`
- Modify: `apps/api/src/modules/studio/in-memory-studio.repository.ts`
- Test: `apps/api/src/modules/studio/studio.repository.test.ts`
- Test: `apps/api/src/db/postgres.repositories.test.ts`

- [ ] **Step 1: Add the repository invariant test**

```ts
const created = await repository.createDocument(documentInput);
await repository.updateDocument({ ...created, bodyText: "draft 1" }, created.revision);
const updated = await repository.findDocument(scope, created.id);
await repository.updateDocument({ ...updated!, bodyText: "draft 2" }, updated!.revision);
expect(await repository.listVersions(scope, created.id)).toHaveLength(1);
```

- [ ] **Step 2: Run and confirm excess versions**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.repository.test.ts`  
Expected: FAIL because each update inserts a version.

- [ ] **Step 3: Remove `insertVersion` from ordinary update transactions**

```ts
async updateDocument(input, expectedRevision) {
  return withOperationalTransaction(db, async (client) => {
    const updated = await client.query<StudioDocumentRow>(UPDATE_DOCUMENT_SQL, values);
    if (!updated.rows[0]) throw new Error("STUDIO_DOCUMENT_STALE");
    return documentFromRow(updated.rows[0]);
  });
}
```

Keep the initial imported checkpoint on document creation and explicit version appends for accepted AI suggestions.

- [ ] **Step 4: Run in-memory and PostgreSQL repository suites**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.repository.test.ts src/db/postgres.repositories.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/studio/*studio.repository.ts apps/api/src/modules/studio/studio.repository.test.ts apps/api/src/db/postgres.repositories.test.ts
git commit -m "fix(studio): separate draft saves from versions"
```

### Task 7: Add explicit checkpoint creation and paginated history

**Files:**
- Modify: `apps/api/src/modules/studio/studio.types.ts`
- Modify: `apps/api/src/modules/studio/studio.schemas.ts`
- Modify: `apps/api/src/modules/studio/studio.service.ts`
- Modify: `apps/api/src/modules/studio/studio.routes.ts`
- Modify: both Studio repositories
- Test: `apps/api/src/modules/studio/studio.routes.test.ts`
- Test: `apps/api/src/modules/studio/studio.service.test.ts`

- [ ] **Step 1: Write failing checkpoint route tests**

```ts
const checkpoint = await app.inject({
  method: "POST",
  url: `/studio/documents/${document.id}/checkpoints`,
  headers: ownerA,
  payload: { expected_revision: document.revision, reason: "significant_pause" }
});
expect(checkpoint.statusCode).toBe(201);

const page = await app.inject({
  method: "GET",
  url: `/studio/documents/${document.id}/versions?limit=20`,
  headers: ownerA
});
expect(page.json()).toMatchObject({ versions: expect.any(Array), nextCursor: null });

const restored = await app.inject({
  method: "POST",
  url: `/studio/documents/${document.id}/versions/${version.id}/restore`,
  headers: ownerA,
  payload: { expected_revision: document.revision }
});
expect(restored.statusCode).toBe(200);
expect(restored.json().version.checkpointReason).toBe("restored");
```

- [ ] **Step 2: Run and observe 404/schema failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.routes.test.ts src/modules/studio/studio.service.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement checkpoint rules and pagination**

```ts
export type StudioCheckpointReason =
  | "significant_pause" | "document_exit" | "structure_changed"
  | "accepted_ai_suggestion" | "transcript_inserted" | "restored" | "manual";

async createCheckpoint(scope, actorProfileId, id, input) {
  assertActor(scope, actorProfileId);
  const document = await requireDocument(repository, scope, id);
  if (document.revision !== input.expected_revision) throw new Error("STUDIO_DOCUMENT_STALE");
  return repository.appendVersion({
    ...scope,
    documentId: id,
    title: document.title,
    bodyJson: document.bodyJson,
    bodyText: document.bodyText,
    origin: "user",
    actorProfileId,
    aiRunId: null,
    checkpointReason: input.reason,
    sourceRevision: document.revision,
    isLegacy: false
  });
}
```

Deduplicate against the latest checkpoint by normalized title/body JSON/body text. Enqueue an index job only when a checkpoint is inserted.
Add `POST /studio/documents/:documentId/versions/:versionId/restore`; it copies the selected checkpoint into the current draft under optimistic revision control and appends a new `restored` checkpoint without deleting later history.

- [ ] **Step 4: Run route, service, and memory tests**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.routes.test.ts src/modules/studio/studio.service.test.ts src/modules/studio/studio-memory.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/studio
git commit -m "feat(studio): create explicit checkpoints"
```

### Task 8: Add the client checkpoint policy

**Files:**
- Create: `apps/web/src/studio/studio-checkpoint-policy.ts`
- Create: `apps/web/src/studio/studio-checkpoint-policy.test.ts`
- Modify: `apps/web/src/studio/studio-api.ts`
- Modify: `apps/web/src/studio/useStudioAutosave.ts`
- Modify: `apps/web/src/studio/StudioEditor.tsx`
- Test: `apps/web/src/studio/useStudioAutosave.test.tsx`

- [ ] **Step 1: Write failing policy tests**

```ts
it("creates one significant-pause checkpoint after meaningful editing", () => {
  const policy = createCheckpointPolicy({ pauseMs: 30_000, minimumChangedCharacters: 20 });
  policy.recordSaved({ revision: 2, bodyText: "A meaningful changed paragraph" }, 0);
  expect(policy.dueAt(29_999)).toBe(false);
  expect(policy.dueAt(30_000)).toBe(true);
  policy.recordCheckpoint(30_000);
  expect(policy.dueAt(60_000)).toBe(false);
});
```

- [ ] **Step 2: Run and confirm the module is absent**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/studio-checkpoint-policy.test.ts src/studio/useStudioAutosave.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Implement the deterministic policy and API call**

```ts
export async function createStudioCheckpoint(documentId: string, input: {
  expected_revision: number;
  reason: StudioCheckpointReason;
}, signal?: AbortSignal, fetcher: StudioFetcher = fetch) {
  const response = await studioRequest<{ version: RawStudioDocumentVersion }>(
    `/documents/${encodeURIComponent(documentId)}/checkpoints`,
    { method: "POST", body: JSON.stringify(input), signal },
    fetcher
  );
  return mapStudioDocumentVersion(response.version);
}
```

Trigger a checkpoint after a 30-second meaningful pause and on editor unmount/navigation. Do not block or retry draft saves behind checkpoint creation.

- [ ] **Step 4: Run autosave/editor/API tests**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/studio-checkpoint-policy.test.ts src/studio/useStudioAutosave.test.tsx src/studio/StudioEditor.test.tsx src/studio/studio-api.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/studio
git commit -m "feat(studio): checkpoint meaningful editing pauses"
```

### Task 9: Replace inline history with a bounded drawer

**Files:**
- Create: `apps/web/src/studio/StudioVersionDrawer.tsx`
- Create: `apps/web/src/studio/StudioVersionDrawer.test.tsx`
- Modify: `apps/web/src/studio/StudioEditor.tsx`
- Modify: `apps/web/src/studio/studio.css`

- [ ] **Step 1: Write the drawer behavior test**

```tsx
render(<StudioVersionDrawer documentId="doc_1" open onClose={onClose} />);
expect(await screen.findByRole("dialog", { name: "Histórico de versões" })).toBeVisible();
expect(screen.getByText("Histórico anterior")).toHaveAttribute("aria-expanded", "false");
expect(screen.getByRole("button", { name: "Carregar versões anteriores" })).toBeVisible();
```

- [ ] **Step 2: Run and verify the component is missing**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioVersionDrawer.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Build the accessible drawer**

```tsx
<aside className="studio-version-drawer" role="dialog" aria-modal="true" aria-labelledby="studio-history-title">
  <header>
    <h2 id="studio-history-title">Histórico de versões</h2>
    <button type="button" onClick={onClose} aria-label="Fechar histórico">×</button>
  </header>
  <div className="studio-version-drawer__scroll">{checkpointGroups}</div>
</aside>
```

Paginate new checkpoints, collapse legacy entries, restore focus to the trigger, and keep the main document height unchanged.

- [ ] **Step 4: Run drawer/editor/accessibility tests**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioVersionDrawer.test.tsx src/studio/StudioEditor.test.tsx src/studio/studio-accessibility.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/studio/StudioVersionDrawer* apps/web/src/studio/StudioEditor.tsx apps/web/src/studio/studio.css
git commit -m "feat(studio): move history into bounded drawer"
```

### Task 10: Render compact material rows

**Files:**
- Create: `apps/web/src/studio/StudioMaterialList.tsx`
- Create: `apps/web/src/studio/StudioMaterialList.test.tsx`
- Modify: `apps/web/src/studio/StudioPage.tsx`
- Modify: `apps/web/src/studio/studio.css`

- [ ] **Step 1: Write a regression test for long PDF extraction**

```tsx
render(<StudioMaterialList assets={[pdfAsset({ extractedText: "Long text ".repeat(10_000) })]} onSelect={onSelect} />);
expect(screen.getByText("strategy.pdf")).toBeVisible();
expect(screen.queryByText(/Long text Long text/u)).not.toBeInTheDocument();
await user.click(screen.getByRole("button", { name: /Abrir strategy.pdf/u }));
expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "asset_pdf" }));
```

- [ ] **Step 2: Run and confirm current inline rendering violates the test**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioMaterialList.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Implement the compact list and status labels**

```tsx
<ul className="studio-material-list" aria-label="Materiais do documento">
  {assets.map((asset) => (
    <li key={asset.id}>
      <button type="button" onClick={() => onSelect(asset)} aria-label={`Abrir ${asset.displayName}`}>
        <MaterialIcon kind={asset.kind} />
        <span>{asset.displayName}</span>
        <MaterialStatus status={asset.extractionStatus} />
      </button>
    </li>
  ))}
</ul>
```

- [ ] **Step 4: Run page and list tests**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioMaterialList.test.tsx src/studio/StudioPage.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/studio/StudioMaterialList* apps/web/src/studio/StudioPage.tsx apps/web/src/studio/studio.css
git commit -m "feat(studio): present compact document materials"
```

### Task 11: Move material details and actions into an inspector

**Files:**
- Create: `apps/web/src/studio/StudioMaterialInspector.tsx`
- Create: `apps/web/src/studio/StudioMaterialInspector.test.tsx`
- Modify: `apps/web/src/studio/StudioAssetProcessingStatus.tsx`
- Modify: `apps/web/src/studio/StudioPage.tsx`
- Modify: `apps/web/src/studio/studio.css`

- [ ] **Step 1: Write inspector interaction tests**

```tsx
render(<StudioMaterialInspector asset={readyPdf} open onClose={onClose} onInsertText={onInsertText} />);
expect(screen.getByRole("dialog", { name: "Material strategy.pdf" })).toBeVisible();
expect(screen.getByRole("button", { name: "Ver texto completo" })).toBeVisible();
expect(screen.queryByText(readyPdf.extractedText!)).not.toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "Ver texto completo" }));
expect(screen.getByText(readyPdf.extractedText!)).toBeVisible();
```

- [ ] **Step 2: Run and verify the inspector is absent**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioMaterialInspector.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Implement per-kind inspector actions**

```tsx
<aside role="dialog" aria-modal="true" aria-labelledby="material-inspector-title" className="studio-material-inspector">
  <header><h2 id="material-inspector-title">{asset.displayName}</h2></header>
  <MaterialPreview asset={asset} />
  <MaterialExtraction asset={asset} initiallyExpanded={false} />
  <footer>
    {canInsert ? <button onClick={() => onInsertText(asset.extractedText!)}>Inserir no documento</button> : null}
    <button onClick={() => void downloadOriginal(asset.id)}>Baixar original</button>
    <button className="danger" onClick={() => setDeleteConfirm(true)}>Excluir material</button>
  </footer>
</aside>
```

Reuse audio URL renewal and retry logic from `StudioAssetProcessingStatus`; reduce that component to polling/status primitives instead of full layout. After `onInsertText` persists the new draft, call `createStudioCheckpoint` with reason `transcript_inserted`.

- [ ] **Step 4: Run material regression suites**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioMaterialInspector.test.tsx src/studio/StudioAssetProcessingStatus.test.tsx src/studio/StudioPage.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/studio/StudioMaterialInspector* apps/web/src/studio/StudioAssetProcessingStatus.tsx apps/web/src/studio/StudioPage.tsx apps/web/src/studio/studio.css
git commit -m "feat(studio): inspect materials without page expansion"
```

## Phase 3 — Structure libraries, durable collections, and lifecycle

### Task 12: Build the calm structure library

**Files:**
- Create: `apps/web/src/studio/StudioStructureLibrary.tsx`
- Create: `apps/web/src/studio/StudioStructureLibrary.test.tsx`
- Modify: `apps/web/src/studio/studio-api.ts`
- Modify: `apps/web/src/studio/StudioPage.tsx`
- Modify: `apps/web/src/studio/studio.css`

- [ ] **Step 1: Write tests for Goals, Decisions, and Plans**

```tsx
render(<StudioStructureLibrary kind="decision" onOpenDocument={onOpenDocument} />);
expect(await screen.findByRole("heading", { name: "Decisões" })).toBeVisible();
expect(screen.getByText("Reorganizar atendimento")).toBeVisible();
await user.click(screen.getByRole("button", { name: "Abrir Reorganizar atendimento" }));
expect(onOpenDocument).toHaveBeenCalledWith("document_1");
```

- [ ] **Step 2: Run and confirm current placeholder behavior**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioStructureLibrary.test.tsx src/studio/StudioPage.test.tsx`  
Expected: FAIL because those sections render `studio-empty`.

- [ ] **Step 3: Compose the query-driven library**

```tsx
const KIND_BY_SECTION = { goals: "goal", decisions: "decision", plans: "plan" } as const;

{section === "goals" || section === "decisions" || section === "plans" ? (
  <StudioStructureLibrary
    kind={KIND_BY_SECTION[section]}
    onOpenDocument={(documentId) => void openDocumentById(documentId)}
  />
) : null}
```

Use `listStudioStructures({ kind, lifecycle_status: "active", limit: 30 })`, client search over loaded titles, status filters from properties, and incremental pagination.

- [ ] **Step 4: Run structure, page, and accessibility tests**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioStructureLibrary.test.tsx src/studio/StudioPage.test.tsx src/studio/studio-accessibility.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/studio/StudioStructureLibrary* apps/web/src/studio/StudioPage.tsx apps/web/src/studio/studio-api.ts apps/web/src/studio/studio.css
git commit -m "feat(studio): connect structure libraries"
```

### Task 13: Invalidate libraries immediately after structure changes

**Files:**
- Create: `apps/web/src/studio/studio-events.ts`
- Create: `apps/web/src/studio/studio-events.test.ts`
- Modify: `apps/web/src/studio/StudioStructures.tsx`
- Modify: `apps/web/src/studio/StudioStructureLibrary.tsx`
- Modify: `apps/web/src/studio/StudioPage.tsx`

- [ ] **Step 1: Write an integration test for immediate visibility**

```tsx
render(<StudioPage />);
await openDocumentAndCreateDecision(user);
await user.click(screen.getByRole("button", { name: "Decisões" }));
expect(await screen.findByText("Nova decisão estratégica")).toBeVisible();
```

- [ ] **Step 2: Run and verify stale section data**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioPage.test.tsx src/studio/studio-events.test.ts`  
Expected: FAIL before event invalidation exists.

- [ ] **Step 3: Add a small typed invalidation bus**

```ts
export type StudioDataEvent =
  | { type: "structure-changed"; documentId: string; kind: StudioStructureKind }
  | { type: "document-lifecycle-changed"; documentId: string };

const target = new EventTarget();
export function publishStudioEvent(event: StudioDataEvent) {
  target.dispatchEvent(new CustomEvent("studio-data", { detail: event }));
}
export function subscribeStudioEvents(listener: (event: StudioDataEvent) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<StudioDataEvent>).detail);
  target.addEventListener("studio-data", handler);
  return () => target.removeEventListener("studio-data", handler);
}
```

Publish only after successful persistence. Libraries reload or update the relevant row.
After a successful structure create/update/archive, create a `structure_changed` checkpoint for the current saved document revision before publishing the event. If the checkpoint call fails, preserve the structure mutation and surface a non-blocking history warning.

- [ ] **Step 4: Run page and structures tests**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioPage.test.tsx src/studio/StudioStructures.test.tsx src/studio/StudioStructureLibrary.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/studio
git commit -m "fix(studio): refresh libraries after structure changes"
```

### Task 14: Reconcile collection membership with the server

**Files:**
- Modify: `apps/api/src/modules/studio/studio.routes.ts`
- Modify: `apps/api/src/modules/studio/studio.service.ts`
- Modify: `apps/api/src/modules/studio/studio.types.ts`
- Modify: `apps/web/src/studio/studio-api.ts`
- Modify: `apps/web/src/studio/StudioLibrary.tsx`
- Test: `apps/api/src/modules/studio/studio.routes.test.ts`
- Test: `apps/web/src/studio/StudioLibrary.test.tsx`

- [ ] **Step 1: Write reload and canonical-response tests**

```ts
expect((await app.inject({
  method: "PUT",
  url: `/studio/collections/${collection.id}/documents/${document.id}`,
  headers: ownerA
})).json()).toMatchObject({ collections: [{ id: collection.id }] });
```

```tsx
await user.click(screen.getByRole("checkbox", { name: "Estratégia" }));
expect(addMembership).toHaveResolved();
const libraryProps = {
  query: { status: "active" as const },
  loadDocuments,
  loadCollections,
  addMembership,
  removeMembership,
  onOpenDocument: vi.fn()
};
rerender(<StudioLibrary {...libraryProps} />);
expect(await screen.findByRole("checkbox", { name: "Estratégia" })).toBeChecked();
```

- [ ] **Step 2: Run and confirm the mutation currently returns no canonical set**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.routes.test.ts && pnpm --filter @prymeira/baase-web test -- src/studio/StudioLibrary.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Return and apply canonical memberships**

```ts
const membership = await service.addDocumentToCollection(
  scope,
  scope.ownerProfileId,
  params.collectionId,
  params.documentId
);
return {
  membership,
  collections: await service.listDocumentCollections(scope, params.documentId)
};
```

Add `listDocumentCollections(scope, documentId)` to `StudioService` and delegate to the existing repository method after `requireDocument`. Call it with `scope`, `scope.ownerProfileId`, `params.collectionId`, and `params.documentId` in the mutation route; do not bypass the service from HTTP code.

Map the returned collection IDs and replace `membershipActual`, `membershipDesired`, and component state after every successful mutation. Keep optimistic rollback for errors.

- [ ] **Step 4: Run route, UI, and PostgreSQL tests**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.routes.test.ts src/db/postgres.repositories.test.ts && pnpm --filter @prymeira/baase-web test -- src/studio/StudioLibrary.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/studio/studio.routes.ts apps/web/src/studio/studio-api.ts apps/web/src/studio/StudioLibrary.tsx apps/api/src/modules/studio/studio.routes.test.ts apps/web/src/studio/StudioLibrary.test.tsx
git commit -m "fix(studio): reconcile collection persistence"
```

### Task 15: Implement trash, restore, and permanent deletion in the API

**Files:**
- Modify: `apps/api/src/modules/studio/studio.types.ts`
- Modify: `apps/api/src/modules/studio/studio.schemas.ts`
- Modify: `apps/api/src/modules/studio/studio.service.ts`
- Modify: both Studio repositories
- Modify: `apps/api/src/modules/studio/studio.routes.ts`
- Test: `apps/api/src/modules/studio/studio.routes.test.ts`
- Test: `apps/api/src/modules/studio/studio.repository.test.ts`

- [ ] **Step 1: Write lifecycle and idempotency tests**

```ts
await request("POST", `/studio/documents/${id}/trash`, ownerA);
expect(await repository.findDocument(scope, id)).toMatchObject({ status: "trashed", trashedAt: expect.any(String) });
await request("POST", `/studio/documents/${id}/restore-from-trash`, ownerA);
expect(await repository.findDocument(scope, id)).toMatchObject({ status: "active", trashedAt: null });
expect((await request("DELETE", `/studio/documents/${id}`, ownerA)).statusCode).toBe(204);
expect((await request("DELETE", `/studio/documents/${id}`, ownerA)).statusCode).toBe(204);
```

- [ ] **Step 2: Run and confirm routes are missing**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.routes.test.ts src/modules/studio/studio.repository.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement the lifecycle transactionally**

```ts
async trashDocument(scope, actorProfileId, id) {
  assertActor(scope, actorProfileId);
  return applyDesiredDocumentState(repository, scope, id,
    (document) => document.status === "trashed",
    (document) => ({
      ...document,
      preTrashStatus: document.status === "trashed" ? document.preTrashStatus : document.status,
      status: "trashed",
      trashedAt: currentTimestamp(clock)
    })
  );
}
```

Permanent deletion must remove DB dependents in one transaction and enqueue object deletion jobs for active asset keys. Owner-scope all predicates.
Moving to trash must enqueue the current checkpoint for index removal so trashed content stops appearing in connections before the 30-day purge.

- [ ] **Step 4: Run lifecycle, portability, and isolation suites**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.routes.test.ts src/modules/studio/studio.repository.test.ts src/modules/studio/studio-portability.service.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/studio
git commit -m "feat(studio): add document trash lifecycle"
```

### Task 16: Add the Trash UI and 30-day cleanup processor

**Files:**
- Create: `apps/api/src/modules/studio/studio-trash-cleanup.ts`
- Create: `apps/api/src/modules/studio/studio-trash-cleanup.test.ts`
- Modify: `apps/api/src/modules/studio/studio-asset-maintenance-runner.ts`
- Create: `apps/web/src/studio/StudioTrash.tsx`
- Create: `apps/web/src/studio/StudioTrash.test.tsx`
- Modify: `apps/web/src/studio/StudioPage.tsx`
- Modify: `apps/web/src/studio/studio-api.ts`
- Modify: `apps/web/src/studio/studio.css`

- [ ] **Step 1: Write cleanup and UI confirmation tests**

```ts
expect(await processor.processNext()).toMatchObject({ id: "expired_document" });
expect(await repository.findDocument(scope, "fresh_document")).not.toBeNull();
```

```tsx
render(<StudioTrash />);
await user.click(await screen.findByRole("button", { name: "Excluir definitivamente Documento antigo" }));
expect(screen.getByRole("dialog", { name: "Excluir definitivamente?" })).toBeVisible();
```

- [ ] **Step 2: Run and confirm missing processor/UI**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-trash-cleanup.test.ts && pnpm --filter @prymeira/baase-web test -- src/studio/StudioTrash.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Implement cleanup and calm Trash view**

```ts
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const cutoff = new Date(now().getTime() - TRASH_RETENTION_MS).toISOString();
const document = await repository.claimNextExpiredTrash(cutoff, leaseMs);
if (!document) return null;
await repository.permanentlyDeleteDocument(scope, document.id, document.claimToken!);
return document;
```

Add `trash` to Studio navigation, show deletion date and remaining retention, and require typed confirmation only for permanent deletion.

- [ ] **Step 4: Run maintenance, UI, and accessibility suites**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-trash-cleanup.test.ts src/modules/studio/studio-asset-maintenance-runner.test.ts && pnpm --filter @prymeira/baase-web test -- src/studio/StudioTrash.test.tsx src/studio/studio-accessibility.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/studio apps/web/src/studio
git commit -m "feat(studio): add trash view and retention cleanup"
```

## Phase 4 — Honest async states, rituals, export, and verification

### Task 17: Expose connection index state and honest empty states

**Files:**
- Modify: `apps/api/src/modules/studio/studio-memory.ts`
- Modify: `apps/api/src/modules/studio/studio.routes.ts`
- Modify: `apps/web/src/studio/studio.types.ts`
- Modify: `apps/web/src/studio/studio-api.ts`
- Modify: `apps/web/src/studio/RelatedThoughts.tsx`
- Test: `apps/api/src/modules/studio/studio.routes.test.ts`
- Test: `apps/web/src/studio/RelatedThoughts.test.tsx`

- [ ] **Step 1: Write API/UI state tests**

```ts
expect((await request("GET", `/studio/documents/${id}/related`, ownerA)).json()).toMatchObject({
  index: { status: "pending", code: null },
  related: []
});
```

```tsx
expect(await screen.findByText("Preparando conexões deste pensamento…")).toBeVisible();
expect(screen.queryByText("Nenhuma conexão encontrada")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run and verify the endpoint only returns `related`**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.routes.test.ts && pnpm --filter @prymeira/baase-web test -- src/studio/RelatedThoughts.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Add a stable index projection**

```ts
export type StudioDocumentIndexState = {
  status: "pending" | "processing" | "ready" | "failed" | "stale" | "unavailable";
  code: string | null;
  indexedVersionId: string | null;
};
```

Return the projection with results. Map `StudioVectorPrerequisiteError` and embedding/provider failures to `unavailable`/`failed` instead of converting them to an empty list.

- [ ] **Step 4: Run memory, route, and related-thought tests**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-memory.test.ts src/modules/studio/studio.routes.test.ts && pnpm --filter @prymeira/baase-web test -- src/studio/RelatedThoughts.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/studio apps/web/src/studio/RelatedThoughts.tsx apps/web/src/studio/studio-api.ts apps/web/src/studio/studio.types.ts
git commit -m "fix(studio): show honest connection states"
```

### Task 18: Start rituals immediately and prepare AI in background

**Files:**
- Modify: `apps/api/src/modules/studio/studio-ritual.service.ts`
- Modify: `apps/api/src/modules/studio/studio.routes.ts`
- Modify: `apps/api/src/modules/studio/studio-asset-maintenance-runner.ts`
- Modify: `apps/web/src/studio/StudioRituals.tsx`
- Test: `apps/api/src/modules/studio/studio-ritual.service.test.ts`
- Test: `apps/web/src/studio/StudioRituals.test.tsx`

- [ ] **Step 1: Write non-blocking start tests**

```ts
const session = await ritualService.startSession(scope, ritual.id);
expect(session).toMatchObject({ status: "preparing", answersJson: {} });
expect(provider.generateStructured).not.toHaveBeenCalled();
await ritualService.processNextPreparation();
expect((await repository.findRitualSession(scope, session.id))?.status).toBe("ready");
```

```tsx
await user.click(screen.getByRole("button", { name: "Iniciar ritual" }));
expect(await screen.findByRole("textbox", { name: /Resposta/u })).toBeEnabled();
expect(screen.getByText("Preparando contexto em segundo plano…")).toBeVisible();
```

- [ ] **Step 2: Run and confirm start currently awaits AI**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-ritual.service.test.ts && pnpm --filter @prymeira/baase-web test -- src/studio/StudioRituals.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Persist a preparation job and poll session state**

```ts
async startSession(scope, ritualId) {
  await requireRitual(repository, scope, ritualId);
  return repository.createRitualSession({
    ...scope,
    ritualId,
    preparationToken: randomUUID(),
    preparationLeaseExpiresAt: new Date(now().getTime() + leaseMs).toISOString()
  });
}
```

Move AI generation into a maintenance processor. Keep base guide questions available from the ritual structure and merge preparation only if the session revision/claim is current.

- [ ] **Step 4: Run ritual, maintenance, and UI tests**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-ritual.service.test.ts src/modules/studio/studio-asset-maintenance-runner.test.ts && pnpm --filter @prymeira/baase-web test -- src/studio/StudioRituals.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/studio apps/web/src/studio/StudioRituals.tsx apps/web/src/studio/StudioRituals.test.tsx
git commit -m "fix(studio): prepare rituals without blocking"
```

### Task 19: Make export progress and Copilot preference explicit

**Files:**
- Modify: `apps/web/src/studio/StudioPrivacySettings.tsx`
- Modify: `apps/web/src/studio/StudioPrivacySettings.test.tsx`
- Modify: `apps/web/src/studio/StudioCopilot.tsx`
- Modify: `apps/web/src/studio/StudioCopilot.test.tsx`
- Modify: `apps/web/src/studio/studio.css`
- Modify: `apps/api/src/modules/studio/studio-portability.routes.ts`
- Modify: `apps/api/src/modules/studio/studio-portability.service.ts`
- Test: `apps/api/src/modules/studio/studio-portability.routes.test.ts`

- [ ] **Step 1: Write visibility and preference tests**

```tsx
expect(await screen.findByText("Sua cópia está na fila")).toBeVisible();
expect(screen.getByText(/Inclui documentos e metadados privados do Estúdio/u)).toBeVisible();
expect(await screen.findByRole("link", { name: "Baixar cópia privada" })).toHaveAttribute("href", exportUrl);
```

```tsx
await user.click(screen.getByRole("button", { name: "Recolher Copiloto" }));
unmount();
render(<StudioCopilot {...props} />);
expect(screen.getByRole("button", { name: "Abrir Copiloto" })).toBeVisible();
```

- [ ] **Step 2: Run and confirm missing persistent preference/copy**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioPrivacySettings.test.tsx src/studio/StudioCopilot.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Add persistent, accessible states**

```ts
const COPILOT_OPEN_KEY = "baase:studio:copilot-open";
const [open, setOpenState] = useState(() => localStorage.getItem(COPILOT_OPEN_KEY) !== "false");
function setOpen(next: boolean) {
  setOpenState(next);
  localStorage.setItem(COPILOT_OPEN_KEY, String(next));
}
```

In Privacy, render a status card for pending/processing/ready/failed/expired with request time, filename, size, expiry, download, and regenerate action. Stop polling on terminal states and abort on unmount.
Extend the export projection returned by the API with `requestedAt`, `filename`, and `sizeBytes`; populate the size from the generated object metadata rather than estimating it in the browser.

- [ ] **Step 4: Run privacy, Copilot, and accessibility suites**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-portability.routes.test.ts && pnpm --filter @prymeira/baase-web test -- src/studio/StudioPrivacySettings.test.tsx src/studio/StudioCopilot.test.tsx src/studio/studio-accessibility.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/studio/studio-portability* apps/web/src/studio/StudioPrivacySettings* apps/web/src/studio/StudioCopilot* apps/web/src/studio/studio.css
git commit -m "feat(studio): clarify export and Copilot states"
```

### Task 20: Add end-to-end, production smoke, and deployment evidence

**Files:**
- Modify: `tests/e2e/owner-studio-server.ts`
- Modify: `tests/e2e/owner-studio.spec.ts`
- Create: `tests/e2e/owner-studio-production-smoke.spec.ts`
- Modify: `playwright.config.ts`
- Create: `docs/qa/2026-07-15-owner-studio-stabilization-results.md`
- Create: `docs/operations/owner-studio.md`

- [ ] **Step 1: Write failing complete-flow E2E tests**

```ts
test("owner structures, reconnects, and deletes a Studio document", async ({ page, request }) => {
  const document = await createDocument(request, ownerA, "Quarterly direction");
  await page.goto(`/#estudio/document/${encodeURIComponent(document.id)}`);
  await createDecisionInUi(page);
  await page.getByRole("button", { name: "Decisões" }).click();
  await expect(page.getByText("Quarterly direction")).toBeVisible();
  await addCollectionAndReload(page, "Q3");
  await openConnectionsAndExpectReady(page);
  await moveToTrashAndPermanentlyDelete(page);
});
```

Add separate E2E coverage for checkpoint count, compact PDF, non-blocking ritual, and downloadable export.

- [ ] **Step 2: Run E2E and record the initial failures**

Run: `pnpm test:e2e -- tests/e2e/owner-studio.spec.ts`  
Expected: FAIL until the E2E server exposes the new contracts and all features are integrated.

- [ ] **Step 3: Extend the fixture server and add opt-in production smoke**

```ts
test.skip(!process.env.BAASE_PRODUCTION_URL || !process.env.BAASE_PRODUCTION_AUTH_STATE,
  "production Studio smoke needs URL and owner auth state");

test("deployed Studio AI and vector readiness are honest", async ({ page }) => {
  await page.goto(`${process.env.BAASE_PRODUCTION_URL}/#estudio`);
  await expect(page.getByRole("heading", { name: "Estúdio" })).toBeVisible();
  const response = await page.request.get(`${process.env.BAASE_PRODUCTION_URL}/api/studio/readiness`);
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({ ai: { status: "ready" }, vector: { status: "ready" } });
});
```

Document the exact Swarm deploy sequence, pgvector validation query, MinIO check, readiness response, rollback command, and volume preservation check.

- [ ] **Step 4: Run the full verification matrix**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
docker compose -f docker-compose.prod.yml config >/dev/null
```

Expected: all commands exit 0. Production smoke remains skipped unless both opt-in variables are supplied; when supplied, it must pass before release completion.

- [ ] **Step 5: Record evidence and commit**

```bash
git add tests/e2e playwright.config.ts docs/qa/2026-07-15-owner-studio-stabilization-results.md docs/operations docker-compose.prod.yml
git commit -m "test(studio): cover stabilized owner workflows"
```

## Final release checklist

- [ ] Confirm the worktree is clean and every task commit exists.
- [ ] Run `git diff main...HEAD --check`; expected: no whitespace errors.
- [ ] Verify the migration on a disposable copy of the production schema and data volume.
- [ ] Verify `SELECT extversion FROM pg_extension WHERE extname = 'vector'` returns one row.
- [ ] Verify `/api/studio/readiness` reports AI, embeddings, vector, and maintenance as ready.
- [ ] Run the opt-in real `gpt-5.6-terra` smoke without logging prompts or document bodies.
- [ ] Deploy API, web, and PostgreSQL image changes together.
- [ ] Run the deployed Playwright smoke.
- [ ] Confirm existing documents, materials, structures, collections, and legacy versions remain accessible.
- [ ] Only then merge to `main` and push.
