# Owner Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the private, AI-assisted Owner Studio described in `docs/superpowers/specs/2026-07-13-owner-studio-design.md`, including free capture, strategic structures, grounded AI, rituals, operational promotion, and quiet-ops polish.

**Architecture:** Add an owner-scoped `studio` domain to the Fastify API with relational persistence, immutable document versions, private assets, suggestions, citations, semantic memory, and audited AI calls. Keep the React/Vite app shell integration small and implement the Studio as lazy-loaded feature components with its own API client, state boundaries, editor, and styles that consume the existing Baase tokens.

**Tech Stack:** TypeScript 5.8, Fastify 5, PostgreSQL 16, pg, Zod 4, OpenAI Responses API, Deepgram, S3-compatible object storage, React 19, Vite 7, TipTap, Vitest, Testing Library.

---

## Delivery order

This specification spans four testable tracks. Execute them in order; do not expose the navigation item in production until Track D is complete.

1. Track A — private foundation and writing.
2. Track B — AI, citations, research, and memory.
3. Track C — strategic structures, rituals, and operational bridge.
4. Track D — export, security, accessibility, performance, and acceptance.

## File map

### Shared

- Modify `packages/shared/src/roles.ts`: owner Studio permission.
- Modify `packages/shared/src/roles.test.ts`: role matrix.
- Modify `packages/shared/src/index.ts`: export permission helper.

### API foundation

- Create `apps/api/src/modules/studio/studio.types.ts`: domain entities and repository contract.
- Create `apps/api/src/modules/studio/studio.schemas.ts`: request and persisted-payload Zod schemas.
- Create `apps/api/src/modules/studio/in-memory-studio.repository.ts`: deterministic local/test repository.
- Create `apps/api/src/modules/studio/postgres-studio.repository.ts`: relational repository.
- Create `apps/api/src/modules/studio/studio.service.ts`: documents, versions, collections, structures, and suggestion lifecycle.
- Create `apps/api/src/modules/studio/studio.routes.ts`: owner-scoped domain routes.
- Create `apps/api/src/modules/studio/studio-assets.routes.ts`: private upload/download/link capture.
- Create `apps/api/src/modules/studio/studio-search.ts`: lexical search boundary.
- Modify `apps/api/src/db/operational-schema.ts`: Studio migrations.
- Modify `apps/api/src/db/operational-schema.test.ts`: migration ledger and constraints.
- Modify `apps/api/src/db/operational-schema.postgres.test.ts`: real PostgreSQL indexes and isolation.
- Modify `apps/api/src/db/postgres.ts`: repository bundle.
- Modify `apps/api/src/app.ts`: dependencies, conflict mapping, routes.

### API intelligence and orchestration

- Modify `apps/api/src/modules/ai/ai.types.ts`: Studio source, tasks, streaming, embeddings, research.
- Modify `apps/api/src/modules/ai/ai-harness.ts`: audited streaming and embeddings.
- Modify `apps/api/src/modules/ai/providers/openai.provider.ts`: stream, embeddings, explicit web search.
- Modify `apps/api/src/modules/ai/providers/mock-ai.provider.ts`: deterministic Studio behavior.
- Modify `apps/api/src/modules/ai/prompt-registry.ts`: Studio agents.
- Modify `apps/api/src/modules/ai/schema-registry.ts`: suggestion schemas.
- Create `apps/api/src/modules/studio/studio-context-builder.ts`: allowlisted operational snapshots.
- Create `apps/api/src/modules/studio/studio-memory.ts`: hybrid retrieval interface and in-memory adapter.
- Create `apps/api/src/modules/studio/postgres-studio-memory.ts`: PostgreSQL vector adapter.
- Create `apps/api/src/modules/studio/studio-assistant.service.ts`: conversations, citations, suggestions.
- Create `apps/api/src/modules/studio/studio-assistant.routes.ts`: SSE and suggestion decisions.
- Create `apps/api/src/modules/studio/studio-ritual.service.ts`: ritual preparation and sessions.
- Create `apps/api/src/modules/studio/studio-operations-bridge.ts`: preview and confirmed creation.

### Web

- Modify `apps/web/package.json`: TipTap dependencies.
- Create `apps/web/src/studio/studio.types.ts`: API view types.
- Create `apps/web/src/studio/studio-api.ts`: typed HTTP and SSE client.
- Create `apps/web/src/studio/StudioPage.tsx`: feature boundary and internal navigation.
- Create `apps/web/src/studio/StudioHome.tsx`: Mesa tranquila.
- Create `apps/web/src/studio/UniversalCaptureComposer.tsx`: multimodal capture.
- Create `apps/web/src/studio/StudioEditor.tsx`: Caderno aberto and autosave.
- Create `apps/web/src/studio/StudioCopilot.tsx`: chat, sources, and suggestions.
- Create `apps/web/src/studio/StudioStructures.tsx`: goals, decisions, plans.
- Create `apps/web/src/studio/StudioRituals.tsx`: ritual builder and sessions.
- Create `apps/web/src/studio/OperationPreview.tsx`: explicit operational confirmation.
- Create `apps/web/src/studio/studio.css`: feature layout using existing tokens.
- Create focused tests beside each Studio component.
- Modify `apps/web/src/App.tsx`: owner-only lazy route and sidebar item.
- Modify `apps/web/src/api.ts`: load boundary only if needed by bootstrap.
- Modify `apps/web/src/App.test.tsx`: role visibility and lazy-route integration.

## Track A — Private foundation and writing

### Task 1: Add the explicit owner Studio permission

**Files:**
- Modify: `packages/shared/src/roles.ts`
- Modify: `packages/shared/src/roles.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing role-matrix test**

Add to `packages/shared/src/roles.test.ts`:

```ts
import { canAccessOwnerStudio } from "./roles";

it.each([
  ["owner", true],
  ["manager", false],
  ["employee", false]
] as const)("returns Studio access for %s", (role, expected) => {
  expect(canAccessOwnerStudio(role)).toBe(expected);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --filter @prymeira/baase-shared test -- roles.test.ts`

Expected: FAIL because `canAccessOwnerStudio` is not exported.

- [ ] **Step 3: Implement and export the helper**

Add to `packages/shared/src/roles.ts`:

```ts
export function canAccessOwnerStudio(role: BaaseRole) {
  return role === "owner";
}
```

Add to `packages/shared/src/index.ts` if roles are explicitly re-exported:

```ts
export { canAccessOwnerStudio } from "./roles";
```

- [ ] **Step 4: Run the focused test and shared typecheck**

Run: `pnpm --filter @prymeira/baase-shared test -- roles.test.ts && pnpm --filter @prymeira/baase-shared typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/roles.ts packages/shared/src/roles.test.ts packages/shared/src/index.ts
git commit -m "feat: add owner studio permission"
```

### Task 2: Define Studio domain types and validated payloads

**Files:**
- Create: `apps/api/src/modules/studio/studio.types.ts`
- Create: `apps/api/src/modules/studio/studio.schemas.ts`
- Create: `apps/api/src/modules/studio/studio.schemas.test.ts`

- [ ] **Step 1: Write failing schema tests**

Create `studio.schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createStudioDocumentSchema, studioStructurePropertiesSchema } from "./studio.schemas";

describe("Studio schemas", () => {
  it("accepts an unclassified text capture", () => {
    expect(createStudioDocumentSchema.parse({
      title: null,
      body_json: { type: "doc", content: [] },
      body_text: "Uma ideia solta",
      capture_mode: "text"
    })).toMatchObject({ capture_mode: "text" });
  });

  it("rejects a metric without a goal target", () => {
    expect(() => studioStructurePropertiesSchema("goal").parse({
      metric: { label: "Receita", current: 100 }
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.schemas.test.ts`

Expected: FAIL because the Studio schemas do not exist.

- [ ] **Step 3: Add the domain contract**

Create `studio.types.ts` with these exact public contracts:

```ts
export type StudioOwnerScope = { workspaceId: string; ownerProfileId: string };
export type StudioCaptureMode = "text" | "audio" | "file" | "image" | "link" | "mixed";
export type StudioDocumentStatus = "active" | "archived";
export type StudioStructureKind = "goal" | "decision" | "plan" | "ritual";
export type StudioSuggestionStatus = "pending" | "accepted" | "dismissed" | "expired";

export type StudioDocument = StudioOwnerScope & {
  id: string;
  title: string | null;
  bodyJson: Record<string, unknown>;
  bodyText: string;
  revision: number;
  captureMode: StudioCaptureMode;
  inboxState: "pending_review" | "reviewed";
  isFocused: boolean;
  status: StudioDocumentStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type StudioDocumentVersion = StudioOwnerScope & {
  id: string;
  documentId: string;
  versionNumber: number;
  bodyJson: Record<string, unknown>;
  bodyText: string;
  origin: "user" | "import" | "accepted_ai_suggestion";
  actorProfileId: string;
  aiRunId: string | null;
  createdAt: string;
};

export type StudioRepository = {
  listDocuments(scope: StudioOwnerScope, input: { cursor?: string; limit: number; status?: StudioDocumentStatus }): Promise<{ items: StudioDocument[]; nextCursor: string | null }>;
  findDocument(scope: StudioOwnerScope, documentId: string): Promise<StudioDocument | null>;
  createDocument(input: Omit<StudioDocument, "id" | "revision" | "createdAt" | "updatedAt" | "archivedAt">): Promise<StudioDocument>;
  updateDocument(input: StudioDocument, expectedRevision: number): Promise<StudioDocument>;
  listVersions(scope: StudioOwnerScope, documentId: string): Promise<StudioDocumentVersion[]>;
  appendVersion(input: Omit<StudioDocumentVersion, "id" | "versionNumber" | "createdAt">): Promise<StudioDocumentVersion>;
};
```

Create `studio.schemas.ts` with strict Zod schemas for document create/patch, collection, asset, and the four structure kinds. Use `z.record(z.string(), z.unknown())` for editor JSON, cap `body_text` at 500,000 characters, titles at 240, and collection names at 120.

- [ ] **Step 4: Run schemas tests and API typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.schemas.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/studio/studio.types.ts apps/api/src/modules/studio/studio.schemas.ts apps/api/src/modules/studio/studio.schemas.test.ts
git commit -m "feat: define owner studio domain"
```

### Task 3: Add the relational Studio foundation migration

**Files:**
- Modify: `apps/api/src/db/operational-schema.ts`
- Modify: `apps/api/src/db/operational-schema.test.ts`
- Modify: `apps/api/src/db/operational-schema.postgres.test.ts`

- [ ] **Step 1: Write migration tests for version 9 and owner-safe foreign keys**

Update the migration ledger expectation to `[1,2,3,4,5,6,7,8,9]` and add:

```ts
it("creates owner-scoped Studio tables", async () => {
  await ensureOperationalSchema(db);
  const tables = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_name like 'studio_%' order by table_name`
  );
  expect(tables.rows.map((row) => row.table_name)).toEqual(expect.arrayContaining([
    "studio_documents",
    "studio_document_versions",
    "studio_assets",
    "studio_collections",
    "studio_collection_items"
  ]));
});
```

In the real PostgreSQL test, attempt to link a document owned by `owner_b` into a collection owned by `owner_a` and expect the composite foreign key to reject it.

- [ ] **Step 2: Run the schema tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/db/operational-schema.test.ts`

Expected: FAIL because migration 9 and tables are absent.

- [ ] **Step 3: Add migration 9**

Append a migration named `owner_studio_foundation`. It must create:

```sql
CREATE TABLE studio_documents (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  owner_profile_id TEXT NOT NULL,
  title TEXT,
  body_json JSONB NOT NULL,
  body_text TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  capture_mode TEXT NOT NULL CHECK (capture_mode IN ('text','audio','file','image','link','mixed')),
  inbox_state TEXT NOT NULL DEFAULT 'pending_review' CHECK (inbox_state IN ('pending_review','reviewed')),
  is_focused BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, owner_profile_id, id)
);

CREATE TABLE studio_document_versions (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  owner_profile_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  body_json JSONB NOT NULL,
  body_text TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('user','import','accepted_ai_suggestion')),
  actor_profile_id TEXT NOT NULL,
  ai_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, owner_profile_id, id),
  UNIQUE (workspace_id, owner_profile_id, document_id, version_number),
  FOREIGN KEY (workspace_id, owner_profile_id, document_id)
    REFERENCES studio_documents(workspace_id, owner_profile_id, id) ON DELETE CASCADE
);
```

Add equivalent owner-composite keys for `studio_assets`, `studio_collections`, and `studio_collection_items`; add indexes on `(workspace_id,owner_profile_id,updated_at DESC)`, inbox state, `is_focused` where true, status, and collection membership.

- [ ] **Step 4: Run memory and real PostgreSQL schema checks**

Run: `pnpm --filter @prymeira/baase-api test -- src/db/operational-schema.test.ts`

Run when `TEST_DATABASE_URL` is configured: `pnpm --filter @prymeira/baase-api test:postgres-schema`

Expected: PASS with version 9 present exactly once.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/operational-schema.ts apps/api/src/db/operational-schema.test.ts apps/api/src/db/operational-schema.postgres.test.ts
git commit -m "feat: add owner studio schema"
```

### Task 4: Implement in-memory and PostgreSQL document repositories

**Files:**
- Create: `apps/api/src/modules/studio/in-memory-studio.repository.ts`
- Create: `apps/api/src/modules/studio/postgres-studio.repository.ts`
- Create: `apps/api/src/modules/studio/studio.repository.test.ts`
- Modify: `apps/api/src/db/postgres.ts`

- [ ] **Step 1: Write the shared repository contract test**

Create a test factory that runs against the in-memory repository and, when `TEST_DATABASE_URL` exists, the PostgreSQL repository. Assert:

```ts
const created = await repository.createDocument({
  workspaceId: "workspace_a",
  ownerProfileId: "owner_a",
  title: null,
  bodyJson: { type: "doc", content: [] },
  bodyText: "Primeira ideia",
  captureMode: "text",
  inboxState: "pending_review",
  status: "active"
});
expect(await repository.findDocument(
  { workspaceId: "workspace_a", ownerProfileId: "owner_b" },
  created.id
)).toBeNull();
await expect(repository.updateDocument({ ...created, bodyText: "mudou" }, 0))
  .rejects.toThrow("STUDIO_DOCUMENT_STALE");
```

- [ ] **Step 2: Run the repository test and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.repository.test.ts`

Expected: FAIL because repositories are missing.

- [ ] **Step 3: Implement both adapters**

The in-memory adapter must keep separate arrays for documents and versions and always filter both scope fields before ID comparison.

The PostgreSQL update must be atomic:

```ts
const result = await db.query<StudioDocumentRow>(
  `UPDATE studio_documents SET
     title=$4, body_json=$5::jsonb, body_text=$6,
     inbox_state=$7, status=$8, archived_at=$9,
     revision=revision+1, updated_at=NOW()
   WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3 AND revision=$10
   RETURNING *`,
  [scope.workspaceId, scope.ownerProfileId, document.id, document.title,
   JSON.stringify(document.bodyJson), document.bodyText, document.inboxState,
   document.status, document.archivedAt, expectedRevision]
);
if (!result.rows[0]) {
  const exists = await findDocument(scope, document.id);
  throw new Error(exists ? "STUDIO_DOCUMENT_STALE" : "STUDIO_DOCUMENT_NOT_FOUND");
}
```

Create the initial version in the same transaction as the document. Append later versions only after a successful revision update.

Add `studioRepository` to the PostgreSQL bundle. The JSONB/relational operational-store switch must not affect Studio; Studio always uses its relational repository when PostgreSQL is configured.

- [ ] **Step 4: Run repository tests and typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.repository.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/studio/in-memory-studio.repository.ts apps/api/src/modules/studio/postgres-studio.repository.ts apps/api/src/modules/studio/studio.repository.test.ts apps/api/src/db/postgres.ts
git commit -m "feat: persist private studio documents"
```

### Task 5: Add document, version, collection, and search services

**Files:**
- Modify: `apps/api/src/modules/studio/studio.types.ts`
- Create: `apps/api/src/modules/studio/studio.service.ts`
- Create: `apps/api/src/modules/studio/studio-search.ts`
- Create: `apps/api/src/modules/studio/studio.service.test.ts`

- [ ] **Step 1: Write failing service tests**

Cover create, update, archive, restore, collections, cursor pagination, and lexical search. The key preservation test is:

```ts
const original = await service.createDocument(scope, "owner_a", {
  title: null,
  body_json: { type: "doc", content: [] },
  body_text: "Crescer sem perder qualidade",
  capture_mode: "text"
});
const updated = await service.updateDocument(scope, "owner_a", original.id, {
  revision: original.revision,
  title: "Expansão",
  body_json: original.bodyJson,
  body_text: "Talvez crescer depois de estabilizar"
});
expect((await service.listVersions(scope, original.id)).map((item) => item.bodyText))
  .toEqual(["Crescer sem perder qualidade", "Talvez crescer depois de estabilizar"]);
expect(updated.revision).toBe(2);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.service.test.ts`

Expected: FAIL because the service is missing.

- [ ] **Step 3: Implement service rules**

Expose:

```ts
export type StudioService = {
  readHome(scope: StudioOwnerScope): Promise<StudioHome>;
  listDocuments(scope: StudioOwnerScope, query: StudioDocumentQuery): Promise<StudioDocumentPage>;
  getDocument(scope: StudioOwnerScope, id: string): Promise<StudioDocument>;
  createDocument(scope: StudioOwnerScope, actorProfileId: string, input: CreateStudioDocument): Promise<StudioDocument>;
  updateDocument(scope: StudioOwnerScope, actorProfileId: string, id: string, input: UpdateStudioDocument): Promise<StudioDocument>;
  archiveDocument(scope: StudioOwnerScope, actorProfileId: string, id: string): Promise<StudioDocument>;
  restoreDocument(scope: StudioOwnerScope, actorProfileId: string, id: string): Promise<StudioDocument>;
  setFocused(scope: StudioOwnerScope, actorProfileId: string, id: string, focused: boolean): Promise<StudioDocument>;
  listVersions(scope: StudioOwnerScope, id: string): Promise<StudioDocumentVersion[]>;
  search(scope: StudioOwnerScope, query: string, limit: number): Promise<StudioSearchResult[]>;
};
```

Normalize whitespace only in `bodyText`; never rewrite `bodyJson`. Use `revision` for conflicts. `readHome` returns recent documents, owner-selected focus items, inbox count, and next ritual placeholders without operational KPI cards.

- [ ] **Step 4: Run service tests and typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.service.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/studio/studio.types.ts apps/api/src/modules/studio/studio.service.ts apps/api/src/modules/studio/studio-search.ts apps/api/src/modules/studio/studio.service.test.ts
git commit -m "feat: add studio document service"
```

### Task 6: Expose owner-scoped Studio routes and wire the app

**Files:**
- Create: `apps/api/src/modules/studio/studio.routes.ts`
- Create: `apps/api/src/modules/studio/studio.routes.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/db/postgres.ts`

- [ ] **Step 1: Write the authorization and CRUD route tests**

Use Fastify injection with two owners, one manager, and one employee. Assert:

```ts
expect((await app.inject({ method: "GET", url: "/studio/home", headers: ownerA })).statusCode).toBe(200);
expect((await app.inject({ method: "GET", url: "/studio/home", headers: manager })).statusCode).toBe(403);
expect((await app.inject({ method: "GET", url: "/studio/home", headers: employee })).statusCode).toBe(403);
expect((await app.inject({ method: "GET", url: `/studio/documents/${ownerADocument.id}`, headers: ownerB })).statusCode).toBe(404);
```

Also assert PATCH with an old revision returns `409` and code `STUDIO_DOCUMENT_CHANGED`.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.routes.test.ts`

Expected: FAIL because routes are not registered.

- [ ] **Step 3: Implement routes with a single scope helper**

Use this boundary in every handler:

```ts
function requireStudioScope(request: FastifyRequest): StudioOwnerScope {
  const context = readRequestContext(request);
  if (!canAccessOwnerStudio(context.role)) throw forbiddenError();
  return { workspaceId: context.workspaceId, ownerProfileId: context.profileId };
}
```

Register home, list, create, get, patch, archive, restore, versions, search, collections, and collection membership routes from the spec. Parse every body/query/params object with strict Zod schemas.

Add `studioRepository?: StudioRepository` to `BuildAppOptions`, create the in-memory default, register routes, and map `STUDIO_DOCUMENT_STALE` to HTTP 409 with code `STUDIO_DOCUMENT_CHANGED`.

- [ ] **Step 4: Run route tests, app tests, and typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio.routes.test.ts src/app.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/studio/studio.routes.ts apps/api/src/modules/studio/studio.routes.test.ts apps/api/src/app.ts apps/api/src/db/postgres.ts
git commit -m "feat: expose private studio api"
```

### Task 7: Add private Studio assets and link snapshots

**Files:**
- Modify: `apps/api/src/modules/studio/studio.types.ts`
- Modify: `apps/api/src/modules/studio/studio.schemas.ts`
- Create: `apps/api/src/modules/studio/studio-assets.routes.ts`
- Create: `apps/api/src/modules/studio/studio-assets.routes.test.ts`
- Create: `apps/api/src/modules/studio/studio-asset-processor.ts`
- Create: `apps/api/src/modules/studio/studio-asset-processor.test.ts`
- Modify: `apps/api/src/storage/object-storage.ts`
- Modify: `apps/api/src/storage/in-memory-object-storage.ts`
- Modify: `apps/api/src/storage/s3-object-storage.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write failing upload, download, and isolation tests**

Upload a text file as `owner_a`, request its download URL as `owner_a`, then assert `owner_b` receives 404. Add tests for empty file, 25 MB limit, unsupported private-network links, object cleanup when repository persistence fails, persistent audio transcription, PDF extraction, and a retryable processing failure.

- [ ] **Step 2: Run the route test and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-assets.routes.test.ts`

Expected: FAIL because asset routes do not exist.

- [ ] **Step 3: Implement private object storage and safe links**

Use keys that include both boundaries:

```ts
function studioAssetKey(scope: StudioOwnerScope, documentId: string, fileName: string) {
  return `workspaces/${scope.workspaceId}/studio/${scope.ownerProfileId}/${documentId}/${randomUUID()}-${sanitizeFilename(fileName)}`;
}
```

Persist the asset only after `ObjectStorage.put` succeeds; delete the object if persistence fails. Generate ten-minute download URLs only after repository lookup with the full owner scope.

For links, accept only `http:` and `https:`, resolve DNS before fetch, reject loopback/link-local/private ranges, cap redirects at three, response at 5 MB, and timeout at ten seconds. Persist title, extracted text, final URL, and fetched timestamp as a `link_snapshot`; never execute remote scripts.

`studio-asset-processor.ts` claims pending assets, reads the private object, calls the existing transcription harness for audio or the existing PDF/text extraction path for supported documents, and persists `extractedText`, provider metadata, and `ready|failed` state. It never removes the original object. A failed item keeps `lastErrorCode`, `attemptCount`, and `nextAttemptAt` for the maintenance job.

Extend `ObjectStorage` with `get(key): Promise<{ body: Readable; contentType: string | null; sizeBytes: number | null }>` and implement it in both adapters so processing never uses a public download URL.

- [ ] **Step 4: Run route tests and API typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-assets.routes.test.ts src/modules/studio/studio-asset-processor.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/studio/studio.types.ts apps/api/src/modules/studio/studio.schemas.ts apps/api/src/modules/studio/studio-assets.routes.ts apps/api/src/modules/studio/studio-assets.routes.test.ts apps/api/src/modules/studio/studio-asset-processor.ts apps/api/src/modules/studio/studio-asset-processor.test.ts apps/api/src/storage apps/api/src/app.ts
git commit -m "feat: add private studio captures"
```

### Task 8: Add the owner-only lazy Studio shell and typed client

**Files:**
- Create: `apps/web/src/studio/studio.types.ts`
- Create: `apps/web/src/studio/studio-api.ts`
- Create: `apps/web/src/studio/studio-api.test.ts`
- Create: `apps/web/src/studio/StudioPage.tsx`
- Create: `apps/web/src/studio/StudioPage.test.tsx`
- Create: `apps/web/src/studio/studio.css`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write failing owner-navigation and API mapping tests**

In `App.test.tsx`, assert the owner sees `Estúdio`, manager/employee do not, and direct navigation cannot render the feature for non-owners. In `studio-api.test.ts`, assert snake_case API fields map to the camelCase view type and non-2xx responses preserve the API error code.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/studio-api.test.ts src/studio/StudioPage.test.tsx src/App.test.tsx`

Expected: FAIL because the feature and navigation item do not exist.

- [ ] **Step 3: Implement the lazy feature boundary**

Define view types matching the API and a request helper:

```ts
export async function studioRequest<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`/api/studio${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers }
  });
  const payload = await response.json();
  if (!response.ok) throw new StudioApiError(payload.error?.code ?? "STUDIO_REQUEST_FAILED", payload.error?.message ?? "Não foi possível concluir a operação.");
  return payload as T;
}
```

In `App.tsx`:

```tsx
const StudioPage = lazy(() => import("./studio/StudioPage"));

// Screen union
| "estudio"

// owner nav, immediately after Hoje
{ key: "estudio", label: "Estúdio", icon: "ph-sparkle" }

// render boundary
{screen === "estudio" && role === "dono" ? (
  <Suspense fallback={<div className="studio-route-skeleton" aria-label="Carregando Estúdio" />}>
    <StudioPage />
  </Suspense>
) : null}
```

`StudioPage` owns its internal route state (`home`, `inbox`, `all`, `goals`, `decisions`, `plans`, `rituals`, `collection`, `document`) and renders a secondary navigation. Do not add Studio state to `App.tsx`.

Use only existing CSS variables in `studio.css`; no hard-coded brand palette.

- [ ] **Step 4: Run tests, typecheck, and build**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/studio-api.test.ts src/studio/StudioPage.test.tsx src/App.test.tsx && pnpm --filter @prymeira/baase-web typecheck && pnpm --filter @prymeira/baase-web build`

Expected: PASS and Studio emitted as a separate lazy chunk.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/studio apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat: add private studio shell"
```

### Task 9: Build Mesa tranquila and the universal capture composer

**Files:**
- Create: `apps/web/src/studio/StudioHome.tsx`
- Create: `apps/web/src/studio/StudioHome.test.tsx`
- Create: `apps/web/src/studio/UniversalCaptureComposer.tsx`
- Create: `apps/web/src/studio/UniversalCaptureComposer.test.tsx`
- Modify: `apps/web/src/studio/studio-api.ts`
- Modify: `apps/web/src/studio/StudioPage.tsx`
- Modify: `apps/web/src/studio/studio.css`

- [ ] **Step 1: Write failing capture and calm-home tests**

Assert the home contains `Continue de onde parou`, `Em foco`, `Recentes`, and optional `Próximo ritual`, but no score, streak, overdue count, or fake progress. Test a text capture creates immediately and opens the returned document. Test audio/file/image/link buttons are keyboard accessible.

- [ ] **Step 2: Run component tests and verify failure**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioHome.test.tsx src/studio/UniversalCaptureComposer.test.tsx`

Expected: FAIL because components are missing.

- [ ] **Step 3: Implement home and capture modes**

Use one accessible form:

```tsx
<form className="studio-composer" onSubmit={submitTextCapture}>
  <label className="sr-only" htmlFor="studio-capture">Registre um pensamento</label>
  <textarea id="studio-capture" value={text} onChange={(event) => setText(event.target.value)} placeholder="Escreva, grave ou adicione qualquer coisa…" />
  <div className="studio-composer-actions">
    <button type="button" aria-label="Gravar áudio" onClick={toggleRecording}><Icon name="ph-microphone" /></button>
    <label aria-label="Adicionar arquivo"><input hidden type="file" onChange={attachFile} /><Icon name="ph-paperclip" /></label>
    <button type="button" aria-label="Adicionar link" onClick={() => setLinkMode(true)}><Icon name="ph-link" /></button>
    <button type="submit" disabled={!text.trim() || saving}>Guardar</button>
  </div>
</form>
```

Create the document before optional processing. For audio, upload first, associate the asset, then request transcription; if transcription fails, keep and open the document with a retry state.

Home loading uses geometry-matching skeletons. Empty states invite capture without claiming the owner has “nothing to do”.

- [ ] **Step 4: Run tests, typecheck, and verify keyboard behavior**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioHome.test.tsx src/studio/UniversalCaptureComposer.test.tsx && pnpm --filter @prymeira/baase-web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/studio/StudioHome.tsx apps/web/src/studio/StudioHome.test.tsx apps/web/src/studio/UniversalCaptureComposer.tsx apps/web/src/studio/UniversalCaptureComposer.test.tsx apps/web/src/studio/studio-api.ts apps/web/src/studio/StudioPage.tsx apps/web/src/studio/studio.css
git commit -m "feat: add calm studio capture"
```

### Task 10: Add the rich editor, autosave queue, and version recovery

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/studio/StudioEditor.tsx`
- Create: `apps/web/src/studio/StudioEditor.test.tsx`
- Create: `apps/web/src/studio/useStudioAutosave.ts`
- Create: `apps/web/src/studio/useStudioAutosave.test.tsx`
- Modify: `apps/web/src/studio/studio-api.ts`
- Modify: `apps/web/src/studio/StudioPage.tsx`
- Modify: `apps/web/src/studio/studio.css`

- [ ] **Step 1: Install editor dependencies and write failing autosave tests**

Run: `pnpm --filter @prymeira/baase-web add @tiptap/react @tiptap/starter-kit @tiptap/extension-link`

Test that rapid changes collapse into one PATCH, a second edit during an in-flight save queues another PATCH, 409 enters conflict state, and network failure stores a draft under `baase:studio:draft:<documentId>`.

- [ ] **Step 2: Run tests and verify implementation failure**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/useStudioAutosave.test.tsx src/studio/StudioEditor.test.tsx`

Expected: FAIL because editor and hook are missing.

- [ ] **Step 3: Implement Caderno aberto**

The autosave hook state is explicit:

```ts
export type AutosaveState = "idle" | "dirty" | "saving" | "saved" | "offline" | "conflict" | "error";

export function useStudioAutosave(document: StudioDocument, save: SaveStudioDocument) {
  const [state, setState] = useState<AutosaveState>("idle");
  const queued = useRef<StudioDocumentDraft | null>(null);
  const saving = useRef(false);
  // debounce 700 ms; serialize PATCH calls; update revision from every success;
  // persist local draft before network; clear it only after matching server success.
  return { state, queueSave, retry, resolveConflict };
}
```

Configure TipTap with StarterKit and Link. On every update, persist both `editor.getJSON()` and `editor.getText()`. Lazy-load the editor component inside the Studio chunk.

Display persistent save status near the title. Conflict UI offers `Recarregar versão do servidor` and `Manter minha cópia como novo documento`; never silently overwrite.

Add a versions drawer that reads immutable versions and lets the owner preview or restore by creating a new user version.

- [ ] **Step 4: Run focused tests, build, and inspect chunking**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/useStudioAutosave.test.tsx src/studio/StudioEditor.test.tsx && pnpm --filter @prymeira/baase-web typecheck && pnpm --filter @prymeira/baase-web build`

Expected: PASS; editor dependencies must not enter the initial non-Studio chunk.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/studio/StudioEditor.tsx apps/web/src/studio/StudioEditor.test.tsx apps/web/src/studio/useStudioAutosave.ts apps/web/src/studio/useStudioAutosave.test.tsx apps/web/src/studio/studio-api.ts apps/web/src/studio/StudioPage.tsx apps/web/src/studio/studio.css
git commit -m "feat: add studio writing experience"
```

### Task 11: Complete inbox, collections, archive, and lexical search

**Files:**
- Create: `apps/web/src/studio/StudioLibrary.tsx`
- Create: `apps/web/src/studio/StudioLibrary.test.tsx`
- Create: `apps/web/src/studio/StudioSearch.tsx`
- Create: `apps/web/src/studio/StudioSearch.test.tsx`
- Modify: `apps/web/src/studio/studio-api.ts`
- Modify: `apps/web/src/studio/StudioPage.tsx`
- Modify: `apps/web/src/studio/studio.css`

- [ ] **Step 1: Write failing library behavior tests**

Test cursor loading, inbox review, multi-collection membership without duplication, archive/restore, debounced search cancellation, and empty states. Assert search results show title, excerpt, updated date, and collection/structure context without exposing body content in analytics.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioLibrary.test.tsx src/studio/StudioSearch.test.tsx`

Expected: FAIL because library components are missing.

- [ ] **Step 3: Implement library views**

Use one list component driven by query state rather than separate duplicated pages. Keep cursor in component state, cancel obsolete search requests with `AbortController`, and use a roving focus pattern for keyboard list navigation.

Archive uses an inline confirmation and immediately removes the item optimistically; rollback if the API fails. Collection assignment uses checkboxes and PUT/DELETE membership routes.

- [ ] **Step 4: Run Track A tests and full workspace checks**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio src/db/operational-schema.test.ts`

Run: `pnpm --filter @prymeira/baase-web test -- src/studio src/App.test.tsx`

Run: `pnpm typecheck && pnpm build`

Expected: PASS. Manually verify owner A cannot retrieve owner B content using altered IDs.

- [ ] **Step 5: Commit Track A**

```bash
git add apps/web/src/studio
git commit -m "feat: complete studio private foundation"
```

## Track B — AI, citations, research, and memory

### Task 12: Extend the AI contracts for audited streaming, embeddings, and explicit research

**Files:**
- Modify: `apps/api/src/modules/ai/ai.types.ts`
- Modify: `apps/api/src/modules/ai/ai-harness.ts`
- Modify: `apps/api/src/modules/ai/ai-harness.test.ts`
- Modify: `apps/api/src/modules/ai/providers/openai.provider.ts`
- Modify: `apps/api/src/modules/ai/providers/mock-ai.provider.ts`
- Modify: `apps/api/src/modules/ai/ai-providers.test.ts`

- [ ] **Step 1: Write failing harness lifecycle tests**

Test that a successful stream creates `running`, yields deltas, persists `completed`, and stores the final summary; cancellation/failure persists `failed`. Test embeddings return one vector per input. Test web search is absent unless `allowExternalResearch === true`.

- [ ] **Step 2: Run focused AI tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/ai/ai-harness.test.ts src/modules/ai/ai-providers.test.ts`

Expected: FAIL because the new contracts do not exist.

- [ ] **Step 3: Extend types and implement audited generators**

Add `owner_studio` to `AiRunSource` and the Studio task kinds from the design. Add:

```ts
export type AiTextStreamRequest = {
  taskKind: AiTaskKind;
  agentKey: string;
  promptKey: string;
  promptVersion: string;
  model: string;
  reasoningEffort: AiReasoningEffort;
  input: unknown;
  allowExternalResearch: boolean;
};

export type AiTextStreamEvent =
  | { type: "delta"; text: string }
  | { type: "citation"; title: string; url: string; publishedAt: string | null }
  | { type: "done"; text: string };

export type AiEmbeddingRequest = { model: string; inputs: string[] };

export type AiProvider = {
  generateStructured(request: AiStructuredProviderRequest): Promise<unknown>;
  streamText(request: AiTextStreamRequest): AsyncIterable<AiTextStreamEvent>;
  createEmbeddings(request: AiEmbeddingRequest): Promise<number[][]>;
  transcribeAudio(request: AudioTranscriptionProviderRequest): Promise<AudioTranscriptionResult>;
};
```

`AiHarness.runTextStream` returns `{ run, events }`; wrap provider iteration in `try/finally`, accumulate only the bounded summary, and update the AiRun exactly once. `createEmbeddings` rejects length mismatch and non-finite values.

In OpenAI provider, add `web_search` only when explicitly allowed. Parse annotations into citation events. In the mock provider, emit deterministic deltas and a citation only for allowed research.

- [ ] **Step 4: Run AI tests and typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/ai/ai-harness.test.ts src/modules/ai/ai-providers.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: PASS with the existing structured and transcription tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ai
git commit -m "feat: extend ai harness for owner studio"
```

### Task 13: Register Studio prompts and structured suggestion schemas

**Files:**
- Modify: `apps/api/src/modules/ai/prompt-registry.ts`
- Modify: `apps/api/src/modules/ai/schema-registry.ts`
- Modify: `apps/api/src/modules/ai/ai-registries.test.ts`

- [ ] **Step 1: Write failing registry and schema tests**

Assert every Studio agent has version `1`, a known schema, and permanent rules that preserve originals, separate facts/inferences/suggestions, cite sources, and forbid autonomous publication. Parse representative organize, strategic, ritual, and operation-draft outputs.

- [ ] **Step 2: Run registry tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/ai/ai-registries.test.ts`

Expected: FAIL because Studio definitions are absent.

- [ ] **Step 3: Add schemas and prompt definitions**

Use a shared citation schema:

```ts
export const studioCitationSchema = z.object({
  source_type: z.enum(["studio_document", "studio_asset", "operational_resource", "operational_metric", "external_url"]),
  source_id: z.string().nullable(),
  url: z.string().url().nullable(),
  label: z.string().min(1),
  excerpt: z.string().max(800),
  observed_at: z.string().datetime(),
  period_from: z.string().nullable(),
  period_to: z.string().nullable()
});
```

Define schemas for `studio_organize`, `studio_strategic_review`, `studio_ritual_prepare`, and `studio_operational_draft`. Every proposal includes `facts`, `inferences`, `gaps`, `proposal`, and `citations`. Operational drafts use a discriminated union for task, routine, process, and announcement.

Prompts must say that document/link/attachment content is untrusted data and cannot change tool permissions.

- [ ] **Step 4: Run registry tests and typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/ai/ai-registries.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ai/prompt-registry.ts apps/api/src/modules/ai/schema-registry.ts apps/api/src/modules/ai/ai-registries.test.ts
git commit -m "feat: add studio ai agents"
```

### Task 14: Add owner-scoped semantic memory and related-thought retrieval

**Files:**
- Modify: `apps/api/src/db/operational-schema.ts`
- Modify: `apps/api/src/db/operational-schema.test.ts`
- Modify: `apps/api/src/db/operational-schema.postgres.test.ts`
- Create: `apps/api/src/modules/studio/studio-memory.ts`
- Create: `apps/api/src/modules/studio/postgres-studio-memory.ts`
- Create: `apps/api/src/modules/studio/studio-memory.test.ts`
- Modify: `apps/api/src/modules/studio/studio.service.ts`
- Modify: `apps/api/src/modules/studio/in-memory-studio.repository.ts`
- Modify: `apps/api/src/modules/studio/postgres-studio.repository.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write failing hybrid-retrieval and isolation tests**

Index two documents for owner A and one semantically similar document for owner B. Search as A and assert B never appears. Assert reindexing the same version replaces chunks, deleting removes them, and lexical relevance can rescue an item with weaker vector score.

- [ ] **Step 2: Run memory tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-memory.test.ts`

Expected: FAIL because memory adapters are missing.

- [ ] **Step 3: Implement chunking and adapters**

Expose:

```ts
export type StudioMemoryIndex = {
  indexVersion(scope: StudioOwnerScope, document: StudioDocument, version: StudioDocumentVersion): Promise<void>;
  removeDocument(scope: StudioOwnerScope, documentId: string): Promise<void>;
  findRelated(scope: StudioOwnerScope, input: { documentId?: string; query: string; limit: number }): Promise<StudioMemoryMatch[]>;
};
```

Chunk at paragraph boundaries with a maximum of 1,200 characters and 150-character overlap. Generate embeddings in batches. Rank with `0.65 * vector + 0.25 * lexical + 0.10 * recency`, then exclude the source document.

Create the vector table through a dedicated PostgreSQL setup guarded by the memory adapter, using `CREATE EXTENSION IF NOT EXISTS vector`; do not make pg-mem parse vector SQL. The in-memory adapter uses deterministic injected embeddings.

Migration 10 also adds owner-scoped `studio_relations` and `studio_index_jobs`; update the ledger expectation through version 10. Every committed document version enqueues one unique index job in the same persistence transaction. Accepting a related-thought suggestion inserts a relation only after verifying both documents belong to the same owner; relation types are `related_to|supports|contradicts|originated|informs|supersedes`.

Every query includes workspace and owner filters inside SQL before distance ordering. Index failure updates the job attempt without affecting the saved document.

- [ ] **Step 4: Run memory tests and real PostgreSQL test**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-memory.test.ts`

Run with `TEST_DATABASE_URL`: `pnpm --filter @prymeira/baase-api test:postgres-schema`

Expected: PASS; the PostgreSQL test skips only if vector extension is unavailable and reports that prerequisite explicitly.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/operational-schema.ts apps/api/src/db/operational-schema.test.ts apps/api/src/db/operational-schema.postgres.test.ts apps/api/src/modules/studio/studio-memory.ts apps/api/src/modules/studio/postgres-studio-memory.ts apps/api/src/modules/studio/studio-memory.test.ts apps/api/src/modules/studio/studio.service.ts apps/api/src/modules/studio/in-memory-studio.repository.ts apps/api/src/modules/studio/postgres-studio.repository.ts apps/api/src/app.ts
git commit -m "feat: add private studio memory"
```

### Task 15: Build allowlisted operational context and durable citations

**Files:**
- Modify: `apps/api/src/modules/studio/studio.types.ts`
- Create: `apps/api/src/modules/studio/studio-context-builder.ts`
- Create: `apps/api/src/modules/studio/studio-context-builder.test.ts`
- Modify: `apps/api/src/modules/studio/in-memory-studio.repository.ts`
- Modify: `apps/api/src/modules/studio/postgres-studio.repository.ts`

- [ ] **Step 1: Write failing context and citation tests**

Use real repository fixtures to ask for the last 30 days. Assert the builder returns bounded task/routine/dashboard facts, includes resource IDs and period, excludes full unrelated records, labels inferred summaries, and stores citations under the current owner scope.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-context-builder.test.ts`

Expected: FAIL because the builder is missing.

- [ ] **Step 3: Implement the context builder**

Inject domain repositories and expose:

```ts
export type StudioContextRequest = {
  from: string | null;
  to: string | null;
  resourceTypes: Array<"dashboard" | "task" | "routine" | "process" | "training" | "announcement" | "people">;
  personIds: string[];
};

export async function buildStudioContext(scope: StudioOwnerScope, request: StudioContextRequest): Promise<{
  facts: Array<{ key: string; value: unknown; citationIndex: number }>;
  citations: StudioCitationInput[];
}>;
```

Reuse existing dashboard and domain semantics instead of recomputing task status differently. Cap each resource type and total serialized context. Persist citations only when an assistant message or suggestion is committed.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-context-builder.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/studio
git commit -m "feat: ground studio ai in operations"
```

### Task 16: Add assistant conversations, SSE, citations, and suggestion decisions

**Files:**
- Modify: `apps/api/src/db/operational-schema.ts`
- Modify: `apps/api/src/db/operational-schema.test.ts`
- Create: `apps/api/src/modules/studio/studio-assistant.service.ts`
- Create: `apps/api/src/modules/studio/studio-assistant.service.test.ts`
- Create: `apps/api/src/modules/studio/studio-assistant.routes.ts`
- Create: `apps/api/src/modules/studio/studio-assistant.routes.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write failing conversation and suggestion lifecycle tests**

Test a streamed turn with document context, internal citations, explicit external research, cancellation, invalid structured output, accept, dismiss, repeated accept, and owner-B access. Assert external research is not called when the flag is false.

- [ ] **Step 2: Run assistant tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-assistant.service.test.ts src/modules/studio/studio-assistant.routes.test.ts`

Expected: FAIL because assistant service/routes are missing.

- [ ] **Step 3: Implement service and SSE protocol**

Use these SSE events:

```ts
type StudioSseEvent =
  | { event: "run"; data: { ai_run_id: string; conversation_id: string } }
  | { event: "delta"; data: { text: string } }
  | { event: "citation"; data: StudioCitationDto }
  | { event: "suggestion"; data: StudioSuggestionDto }
  | { event: "done"; data: { message_id: string } }
  | { event: "error"; data: { code: string; retryable: boolean } };
```

The service saves the user message first, builds bounded context, streams narrative output, persists the final assistant message and citations, and only then emits `done`. Actionable proposals are generated through a separate `runStructured` call and persisted as pending suggestions.

Migration 11 adds relational tables `studio_conversations`, `studio_messages`, `studio_suggestions`, and `studio_citations`. Every primary/foreign key carries workspace and owner scope. Suggestions reference AiRun by opaque ID without a cross-store foreign key; citations require exactly one source identity (`source_id` or external `url`) and store observed/period timestamps.

Accepting a text suggestion creates a new document version with `origin=accepted_ai_suggestion`. Dismiss only changes suggestion status. Both operations use one atomic repository transaction and are idempotent.

- [ ] **Step 4: Run assistant tests and API typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-assistant.service.test.ts src/modules/studio/studio-assistant.routes.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/operational-schema.ts apps/api/src/db/operational-schema.test.ts apps/api/src/modules/studio/studio-assistant.service.ts apps/api/src/modules/studio/studio-assistant.service.test.ts apps/api/src/modules/studio/studio-assistant.routes.ts apps/api/src/modules/studio/studio-assistant.routes.test.ts apps/api/src/app.ts
git commit -m "feat: add grounded studio copilot"
```

### Task 17: Build the Studio Copilot, source drawer, and related thoughts

**Files:**
- Create: `apps/web/src/studio/StudioCopilot.tsx`
- Create: `apps/web/src/studio/StudioCopilot.test.tsx`
- Create: `apps/web/src/studio/StudioCitations.tsx`
- Create: `apps/web/src/studio/RelatedThoughts.tsx`
- Modify: `apps/web/src/studio/studio-api.ts`
- Modify: `apps/web/src/studio/StudioEditor.tsx`
- Modify: `apps/web/src/studio/studio.css`

- [ ] **Step 1: Write failing interaction tests**

Test streaming deltas, cancel, retry, internal/external source labels, explicit research toggle per turn, suggestion preview/edit/accept/dismiss, selected-text context, and related-thought explanations. Assert accepting a suggestion does not mutate editor content until the API returns the new version.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioCopilot.test.tsx`

Expected: FAIL because copilot components are missing.

- [ ] **Step 3: Implement the sidecar experience**

`studio-api.ts` must parse SSE incrementally and abort with an `AbortController`. Keep `allowExternalResearch` false for every new composer turn until the owner toggles it.

Render facts, inferences, gaps, and proposal in distinct semantic sections. Sources open internal resources through callbacks passed from `App`, while external URLs use `target="_blank" rel="noreferrer"`.

The desktop sidecar is resizable/recolhível; below the Studio breakpoint it becomes a focus-trapped sheet. Respect `prefers-reduced-motion`.

- [ ] **Step 4: Run Track B tests and full checks**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/ai src/modules/studio`

Run: `pnpm --filter @prymeira/baase-web test -- src/studio`

Run: `pnpm typecheck && pnpm build`

Expected: PASS. Manually verify research sources and owner isolation.

- [ ] **Step 5: Commit Track B**

```bash
git add apps/web/src/studio
git commit -m "feat: complete studio intelligence"
```

## Track C — Strategic structures, rituals, and operational bridge

### Task 18: Persist and expose goals, decisions, plans, and rituals

**Files:**
- Modify: `apps/api/src/db/operational-schema.ts`
- Modify: `apps/api/src/db/operational-schema.test.ts`
- Modify: `apps/api/src/modules/studio/studio.types.ts`
- Modify: `apps/api/src/modules/studio/studio.schemas.ts`
- Modify: `apps/api/src/modules/studio/studio.service.ts`
- Modify: `apps/api/src/modules/studio/studio.routes.ts`
- Create: `apps/api/src/modules/studio/studio-structures.test.ts`

- [ ] **Step 1: Write failing schema, service, and route tests**

Test a text-only goal, a measurable goal, decision review date, plan fronts, ritual cadence, duplicate structure prevention, archive, owner isolation, and filtering by kind/status. Assert a document remains unchanged when a structure is attached.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-structures.test.ts`

Expected: FAIL because structures are not persisted.

- [ ] **Step 3: Add migration and domain operations**

Migration 12 creates `studio_structures` with the composite owner/document foreign key, kind/lifecycle checks, horizon, metric/cadence JSON, `next_run_at`, properties JSON, timestamps, and indexes by kind, lifecycle, and next run; update the migration ledger expectation through version 12.

Expose service methods:

```ts
createStructure(scope, actorProfileId, documentId, input)
updateStructure(scope, actorProfileId, structureId, input)
archiveStructure(scope, actorProfileId, structureId)
listStructures(scope, { kind, lifecycleStatus, cursor, limit })
```

Validate `propertiesJson` with the kind-specific schema both before persistence and after reading legacy data. Do not calculate a progress percentage for text-only goals.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-structures.test.ts src/db/operational-schema.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/operational-schema.ts apps/api/src/db/operational-schema.test.ts apps/api/src/modules/studio
git commit -m "feat: add studio strategic structures"
```

### Task 19: Build progressive strategic structure UI

**Files:**
- Create: `apps/web/src/studio/StudioStructures.tsx`
- Create: `apps/web/src/studio/StudioStructures.test.tsx`
- Create: `apps/web/src/studio/GoalDetails.tsx`
- Create: `apps/web/src/studio/DecisionDetails.tsx`
- Create: `apps/web/src/studio/PlanDetails.tsx`
- Modify: `apps/web/src/studio/StudioEditor.tsx`
- Modify: `apps/web/src/studio/studio-api.ts`
- Modify: `apps/web/src/studio/studio.css`

- [ ] **Step 1: Write failing progressive-field tests**

Assert creating a goal requires only a title/result, metric fields appear only after choosing `Adicionar indicador`, date only after `Adicionar horizonte`, and removing optional fields does not delete the document. Test decision and plan fields plus keyboard/focus behavior.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioStructures.test.tsx`

Expected: FAIL because the structure UI is missing.

- [ ] **Step 3: Implement progressive disclosure**

Render a compact structure badge in the editor header and a details panel only when open. Use the API kind schemas as the source of field names and preserve unknown compatible properties when editing.

Goal progress displays either evidence text or the numeric indicator; never invent a percentage. Decision history shows original context, review date, and later learning. Plans use fronts/milestones, not task checkboxes.

- [ ] **Step 4: Run tests and visual regression checks**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioStructures.test.tsx && pnpm --filter @prymeira/baase-web typecheck`

Expected: PASS. Manually compare typography, borders, buttons, and spacing with existing process/routine screens.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/studio
git commit -m "feat: add studio strategic planning"
```

### Task 20: Add ritual sessions and deterministic preparation

**Files:**
- Modify: `apps/api/src/db/operational-schema.ts`
- Modify: `apps/api/src/db/operational-schema.test.ts`
- Modify: `apps/api/src/modules/studio/studio.types.ts`
- Create: `apps/api/src/modules/studio/studio-ritual.service.ts`
- Create: `apps/api/src/modules/studio/studio-ritual.service.test.ts`
- Modify: `apps/api/src/modules/studio/studio.routes.ts`
- Create: `apps/api/src/modules/studio/studio-ritual.routes.test.ts`

- [ ] **Step 1: Write failing ritual lifecycle tests**

Test active cadence, time zone, next-run calculation, single open session, prepared context snapshot, partial answers, finish, restart prevention, and owner isolation. Freeze time in every recurrence test.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-ritual.service.test.ts src/modules/studio/studio-ritual.routes.test.ts`

Expected: FAIL because ritual sessions are missing.

- [ ] **Step 3: Implement sessions and preparation**

Migration 13 adds `studio_ritual_sessions` with status `preparing|ready|in_progress|completed|failed`, composite owner/ritual keys, unique partial index for one open session, context/synthesis JSON, and timestamps; update the migration ledger expectation through version 13.

The service flow is:

```ts
const session = await repository.createRitualSession(scope, ritualId, now);
const context = await contextBuilder.build(scope, ritualContextRequest(ritual));
const related = await memory.findRelated(scope, { query: ritual.intent, limit: 12 });
const suggestion = await harness.runStructured({ taskKind: "studio_ritual_prepare", input: { ritual, context, related }, ... });
return repository.markRitualSessionReady(scope, session.id, suggestion.output, suggestion.run.id);
```

Preparation failure leaves a retryable session and never blocks manual answers. Completion stores the owner's answers before requesting an optional synthesis.

- [ ] **Step 4: Run ritual tests and typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-ritual.service.test.ts src/modules/studio/studio-ritual.routes.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/operational-schema.ts apps/api/src/db/operational-schema.test.ts apps/api/src/modules/studio
git commit -m "feat: add private studio rituals"
```

### Task 21: Add the private ritual UI

**Files:**
- Create: `apps/web/src/studio/StudioRituals.tsx`
- Create: `apps/web/src/studio/StudioRituals.test.tsx`
- Modify: `apps/web/src/studio/StudioHome.tsx`
- Modify: `apps/web/src/studio/studio-api.ts`
- Modify: `apps/web/src/studio/studio.css`

- [ ] **Step 1: Write failing ritual and settings tests**

Assert ritual questions save incrementally, failed preparation still permits manual start, the next configured ritual appears without an overdue badge, and finishing shows suggestions as pending rather than applying them.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioRituals.test.tsx`

Expected: FAIL because ritual UI is missing.

- [ ] **Step 3: Implement ritual builder and session**

Use a calm single-column session with one visible question group at a time, persistent save state, and an optional `Ver contexto preparado` drawer. The home shows only the next enabled ritual; no overdue badge.

- [ ] **Step 4: Run tests and accessibility checks**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioRituals.test.tsx && pnpm --filter @prymeira/baase-web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/studio
git commit -m "feat: add quiet studio rituals"
```

### Task 22: Implement idempotent strategic-to-operational previews

**Files:**
- Modify: `apps/api/src/db/operational-schema.ts`
- Modify: `apps/api/src/db/operational-schema.test.ts`
- Create: `apps/api/src/modules/studio/studio-operations-bridge.ts`
- Create: `apps/api/src/modules/studio/studio-operations-bridge.test.ts`
- Modify: `apps/api/src/modules/studio/studio-assistant.routes.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write failing preview and confirmation tests**

For task, routine, process, and announcement: generate a preview, assert no operational record exists, edit the preview, confirm, assert one record exists, repeat confirmation with the same key, and assert still one. Test invalid person/area references and owner-B access.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-operations-bridge.test.ts`

Expected: FAIL because the bridge is missing.

- [ ] **Step 3: Implement previews, links, and domain-service calls**

Migration 14 adds `studio_operation_previews` and `studio_operational_links`; update the migration ledger expectation through version 14. Store preview payload, source suggestion, expiry, status, idempotency key, and resulting resource ID.

Expose:

```ts
preview(scope, actorProfileId, suggestionId): Promise<StudioOperationPreview>
confirm(scope, actorProfileId, previewId, idempotencyKey, editedPayload): Promise<StudioOperationalLink>
```

Validate referenced areas/people immediately before confirmation. Call `createRoutineService`, process service, announcement service, or the manual-task application path; do not insert their tables directly. Process and announcement outputs remain drafts. Wrap preview status and link persistence around the domain call with idempotency recovery.

- [ ] **Step 4: Run bridge tests and affected domain tests**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-operations-bridge.test.ts src/modules/routines src/modules/processes src/modules/announcements`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/operational-schema.ts apps/api/src/db/operational-schema.test.ts apps/api/src/modules/studio apps/api/src/app.ts
git commit -m "feat: bridge studio strategy to operations"
```

### Task 23: Build the explicit operation preview UI

**Files:**
- Create: `apps/web/src/studio/OperationPreview.tsx`
- Create: `apps/web/src/studio/OperationPreview.test.tsx`
- Modify: `apps/web/src/studio/StudioCopilot.tsx`
- Modify: `apps/web/src/studio/studio-api.ts`
- Modify: `apps/web/src/studio/studio.css`

- [ ] **Step 1: Write failing preview UI tests**

Assert the preview shows resource type, total records, every field, area, assignee, due date, checklist/steps, missing references, and source document. Confirm requires a final button and double-click cannot duplicate the request.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/OperationPreview.test.tsx`

Expected: FAIL because the preview is missing.

- [ ] **Step 3: Implement review-before-create**

Generate one UUID idempotency key when the preview opens and reuse it across retries. Disable confirmation while invalid or in flight. After success, replace the form with a linked resource card and navigation action; do not mark the strategic source as completed.

For multi-record drafts, show the exact count and an expandable item list before confirmation.

- [ ] **Step 4: Run Track C tests and full checks**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio`

Run: `pnpm --filter @prymeira/baase-web test -- src/studio`

Run: `pnpm typecheck && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit Track C**

```bash
git add apps/web/src/studio
git commit -m "feat: complete studio orchestration"
```

## Track D — Privacy, resilience, polish, and acceptance

### Task 24: Add scheduled ritual preparation and configurable proactivity

**Files:**
- Modify: `apps/api/src/db/operational-schema.ts`
- Modify: `apps/api/src/db/operational-schema.test.ts`
- Create: `apps/api/src/modules/studio/studio-proactivity.service.ts`
- Create: `apps/api/src/modules/studio/studio-proactivity.service.test.ts`
- Create: `apps/api/src/jobs/run-studio-maintenance.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/modules/studio/studio.routes.ts`
- Create: `apps/web/src/studio/StudioProactivitySettings.tsx`
- Create: `apps/web/src/studio/StudioProactivitySettings.test.tsx`
- Modify: `apps/web/src/studio/StudioHome.tsx`
- Modify: `apps/web/src/studio/studio-api.ts`

- [ ] **Step 1: Write failing settings and due-job tests**

Freeze time and assert all signal types are disabled by default, enabling ritual reminders prepares only due rituals, a rerun is idempotent, snooze suppresses the reminder without changing cadence, owner scopes never mix, and one failing owner does not stop another. In the web test, assert each signal toggle is independent and explains why it appears.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-proactivity.service.test.ts`

Expected: FAIL because settings and maintenance runner are missing.

- [ ] **Step 3: Implement settings and a retry-safe job entry point**

Migration 15 adds `studio_proactivity_settings` and `studio_proactive_signals`, both owner-scoped; update the migration ledger expectation through version 15. The service exposes:

```ts
readSettings(scope)
updateSettings(scope, input)
runDuePreparations(now, limit)
snoozeSignal(scope, signalId, until)
dismissSignal(scope, signalId)
```

`run-studio-maintenance.ts` loads the configured repository bundle, claims due rows with `FOR UPDATE SKIP LOCKED`, runs bounded batches, records attempts, and exits non-zero only for infrastructure failure. Add `studio:maintenance` to the API package scripts so deployment can schedule it.

The same bounded runner also claims `studio_index_jobs` and failed/pending asset-processing jobs before ritual preparation. Each queue has its own retry/backoff and per-owner limits, so one large upload or broken document cannot starve ritual jobs.

Build `StudioProactivitySettings` only after these endpoints exist. `Adiar` updates `next_reminder_at`; it never changes ritual cadence or creates a task. The home renders at most one quiet signal and always offers dismiss/snooze.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-proactivity.service.test.ts && pnpm --filter @prymeira/baase-web test -- src/studio/StudioProactivitySettings.test.tsx && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/operational-schema.ts apps/api/src/db/operational-schema.test.ts apps/api/src/modules/studio/studio-proactivity.service.ts apps/api/src/modules/studio/studio-proactivity.service.test.ts apps/api/src/jobs/run-studio-maintenance.ts apps/api/package.json apps/api/src/modules/studio/studio.routes.ts apps/web/src/studio
git commit -m "feat: schedule quiet studio rituals"
```

### Task 25: Add private export, full deletion, and role-loss behavior

**Files:**
- Create: `apps/api/src/modules/studio/studio-portability.service.ts`
- Create: `apps/api/src/modules/studio/studio-portability.service.test.ts`
- Create: `apps/api/src/modules/studio/studio-portability.routes.ts`
- Create: `apps/api/src/modules/studio/studio-portability.routes.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/web/src/studio/StudioPage.tsx`
- Create: `apps/web/src/studio/StudioPrivacySettings.tsx`
- Create: `apps/web/src/studio/StudioPrivacySettings.test.tsx`

- [ ] **Step 1: Write failing export/deletion/privacy tests**

Assert export contains only the current owner's documents, versions, assets metadata, structures, conversations, citations, and relations; export object key is owner-scoped and URL expires. Assert full deletion removes private rows, objects, and memory chunks but preserves operational resources and changes their link display to `origem excluída`. Assert a downgraded manager receives 403 and another owner cannot export the data.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-portability.service.test.ts src/modules/studio/studio-portability.routes.test.ts`

Expected: FAIL because portability is missing.

- [ ] **Step 3: Implement export and deletion transaction boundaries**

Export creates a ZIP/JSON stream in private object storage containing a manifest and original files; do not place document bodies in logs. Store an expiring export record and return a signed URL only after owner authorization.

Deletion requires the exact confirmation string `EXCLUIR MEU ESTÚDIO`, rechecks role and profile, marks the deletion request, deletes object keys best-effort with reconciliation records, removes relational/private index rows in a transaction, and never calls delete on operational repositories.

In the UI, place these actions under Studio privacy settings, require confirmation, explain irreversibility, and never expose them in a generic workspace admin screen.

- [ ] **Step 4: Run API/web tests and typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-portability*`

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioPrivacySettings.test.tsx`

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/studio apps/api/src/app.ts apps/web/src/studio
git commit -m "feat: add studio privacy controls"
```

### Task 26: Add content-safe observability and security regression tests

**Files:**
- Create: `apps/api/src/modules/studio/studio-telemetry.ts`
- Create: `apps/api/src/modules/studio/studio-security.test.ts`
- Modify: `apps/api/src/modules/studio/studio.service.ts`
- Modify: `apps/api/src/modules/studio/studio-assistant.service.ts`
- Modify: `apps/api/src/modules/studio/studio-assets.routes.ts`
- Modify: `apps/api/src/config/runtime.ts`
- Modify: `apps/api/src/config/runtime.test.ts`

- [ ] **Step 1: Write failing telemetry-redaction and attack tests**

Test that telemetry events contain IDs, duration, status, modality, counts, and model but never body text, transcript, prompt, extracted text, or message content. Add prompt-injection fixtures in a link/PDF, SSRF variants, oversized context, rapid requests, malformed SSE cancellation, altered owner IDs, and malicious editor JSON.

- [ ] **Step 2: Run security tests and verify failure**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-security.test.ts src/config/runtime.test.ts`

Expected: FAIL until redaction, limits, and runtime requirements are enforced.

- [ ] **Step 3: Implement safe telemetry and runtime guards**

Define an event union without free-form content:

```ts
type StudioTelemetryEvent =
  | { name: "studio_capture_created"; workspaceId: string; ownerProfileId: string; mode: StudioCaptureMode; assetCount: number }
  | { name: "studio_ai_run_finished"; workspaceId: string; ownerProfileId: string; taskKind: AiTaskKind; status: "completed" | "failed" | "cancelled"; latencyMs: number; citationCount: number }
  | { name: "studio_suggestion_decided"; workspaceId: string; ownerProfileId: string; kind: string; decision: "accepted" | "dismissed" };
```

Add per-owner request limits, total-context bounds, upload MIME/size allowlists, editor JSON depth/node limits, URL/DNS revalidation after redirects, tool allowlists, and sensitive-field redaction. Runtime readiness must warn when Studio is enabled without durable storage, AI provider, or vector capability.

- [ ] **Step 4: Run security, AI, and runtime tests**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/studio/studio-security.test.ts src/modules/ai src/config/runtime.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/studio apps/api/src/config
git commit -m "feat: harden owner studio"
```

### Task 27: Finish quiet-ops accessibility, responsiveness, and performance

**Files:**
- Modify: `apps/web/src/studio/studio.css`
- Modify: `apps/web/src/studio/StudioPage.tsx`
- Modify: `apps/web/src/studio/StudioHome.tsx`
- Modify: `apps/web/src/studio/StudioEditor.tsx`
- Modify: `apps/web/src/studio/StudioCopilot.tsx`
- Create: `apps/web/src/studio/studio-accessibility.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write failing accessibility and reduced-motion tests**

Assert landmark names, heading order, form labels, focus return from sheets/dialogs, keyboard internal navigation, live save status, SSE announcements that do not read every token, color-independent states, reduced motion, and usable layouts at 1440, 1024, 768, and 390 CSS pixels.

- [ ] **Step 2: Run tests and capture baseline build sizes**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/studio-accessibility.test.tsx`

Run: `pnpm --filter @prymeira/baase-web build`

Expected: accessibility test FAIL before fixes; save build chunk sizes in the task notes.

- [ ] **Step 3: Apply the quiet-ops polish pass**

Use existing variables for all colors/lines/backgrounds. Add only Studio layout tokens that reference them. Match `.screen`, panel radii, type scale, buttons, focus ring, skeleton tone, and spacing rhythm from the rest of Baase.

Use CSS grid for internal navigation/editor/sidecar, switch sidecar to sheet below 900px, collapse internal navigation below 720px, and preserve a minimum 44px touch target. Gate all transforms/transitions under `prefers-reduced-motion: no-preference`.

Memoize large list rows, paginate/cursor load, lazy-load editor/copilot, and avoid putting streaming text into top-level App state.

- [ ] **Step 4: Run web tests, typecheck, build, and manual visual review**

Run: `pnpm --filter @prymeira/baase-web test && pnpm --filter @prymeira/baase-web typecheck && pnpm --filter @prymeira/baase-web build`

Expected: PASS; initial non-Studio chunk must not materially grow from editor/AI dependencies. Manually verify the Studio alongside Painel, Hoje, Processos, and Rotinas at all target widths.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/studio apps/web/src/styles.css
git commit -m "feat: polish owner studio experience"
```

### Task 28: Add E2E coverage, product documentation, and release gate

**Files:**
- Modify: `package.json`
- Create: `playwright.config.ts`
- Create: `tests/e2e/owner-studio.spec.ts`
- Modify: `docs/ai-operations.md`
- Modify: `docs/database-schema.md`
- Modify: `PRODUCT.md`
- Create: `docs/owner-studio-operations.md`

- [ ] **Step 1: Install Playwright and write the acceptance scenarios**

Run: `pnpm add -Dw @playwright/test && pnpm exec playwright install chromium`

Create tests for all nine E2E flows in the design spec: resilient audio capture, AI organization preserving original, related thoughts, operational citations, explicit web research, prepared ritual, idempotent routine creation, cross-owner/role isolation, and writing during provider outage.

Use fixtures with owner A, owner B, manager, employee, deterministic AI, and fake object storage. Never depend on production credentials.

- [ ] **Step 2: Run E2E and verify uncovered behavior fails**

Run: `pnpm exec playwright test tests/e2e/owner-studio.spec.ts --project=chromium`

Expected: any missing release behavior fails with a named scenario; do not weaken assertions to make it pass.

- [ ] **Step 3: Fix only acceptance gaps and document operations**

Document:

- required environment variables and provider/storage/vector readiness;
- migration and rollback procedure;
- Studio maintenance schedule;
- failed asset/index reconciliation;
- AiRun and cost inspection without private content;
- export/deletion support procedure;
- feature rollout and rollback;
- privacy promise and role-loss behavior.

Update product and schema docs to identify the Studio as private per owner and keep managers/employees out of scope.

- [ ] **Step 4: Run the complete release gate**

Run: `pnpm test`

Run: `pnpm typecheck`

Run: `pnpm build`

Run with PostgreSQL 16: `pnpm --filter @prymeira/baase-api test:postgres-schema`

Run: `pnpm exec playwright test tests/e2e/owner-studio.spec.ts --project=chromium`

Expected: all commands PASS. Then manually demonstrate the six WOW moments and verify no Studio content appears in logs or another owner's session.

- [ ] **Step 5: Commit the release gate**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts tests/e2e docs PRODUCT.md
git commit -m "test: complete owner studio release gate"
```

## Final verification checklist

- [ ] Every API query includes both `workspace_id` and `owner_profile_id`.
- [ ] Managers, employees, and other owners cannot see Studio navigation or data.
- [ ] Original versions remain readable after every AI acceptance.
- [ ] External research requires consent for each turn and displays external sources separately.
- [ ] Operational context uses existing domain semantics and displays period/source.
- [ ] AI/provider failure never blocks writing or destroys captures.
- [ ] Proactivity starts disabled and creates no operational task.
- [ ] Operational confirmation is previewed and idempotent.
- [ ] Export/deletion affect only the current private Studio.
- [ ] The Studio visually belongs to the same quiet-ops Baase.
- [ ] Full tests, typechecks, builds, PostgreSQL schema tests, and E2E pass.
