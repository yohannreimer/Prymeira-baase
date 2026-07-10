# Operational Domain Phase 1: Relational Data and Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the JSONB operational core with relational Postgres repositories, make area removal safe, and make process owners and materials fully editable without losing production history.

**Architecture:** Add versioned SQL migrations beside the existing `baase_records` table, backfill relational rows idempotently, and cut the operational repositories over behind `BAASE_OPERATIONAL_STORE`. Keep onboarding, AI logs, announcements, and trainings on the current JSONB store during this phase. Files use an S3-compatible storage port backed by MinIO in the VPS stack.

**Tech Stack:** TypeScript, Fastify, Zod, PostgreSQL 16, `pg`, Vitest, `pg-mem`, React, Vite, Testing Library, AWS SDK S3 client, MinIO, Docker Swarm/Compose

---

## File Map

- Create `apps/api/src/db/operational-schema.ts`: ordered relational migrations and migration ledger.
- Create `apps/api/src/db/operational-schema.test.ts`: schema constraints and repeatability tests.
- Create `apps/api/src/db/operational-backfill.ts`: idempotent conversion from `baase_records` plus reconciliation report.
- Create `apps/api/src/db/operational-backfill.test.ts`: orphan handling, snapshots, and second-run tests.
- Create `apps/api/src/db/migrate-operational.ts`: command-line migration/backfill entrypoint.
- Create `apps/api/src/modules/company/postgres-company.repository.ts`: relational area, role, and person persistence.
- Create `apps/api/src/modules/company/area-lifecycle.service.ts`: impact calculation and transactional archive decisions.
- Create `apps/api/src/modules/company/area-lifecycle.service.test.ts`: reassignment and unassignment tests.
- Create `apps/api/src/modules/processes/postgres-process.repository.ts`: relational processes, versions, and materials.
- Create `apps/api/src/modules/routines/postgres-routine.repository.ts`: relational routine templates, assignments, occurrences, checklist, and evidence.
- Create `apps/api/src/storage/object-storage.ts`: provider-neutral object storage contract.
- Create `apps/api/src/storage/s3-object-storage.ts`: MinIO/R2/S3 implementation.
- Create `apps/api/src/storage/in-memory-object-storage.ts`: deterministic test implementation.
- Create `apps/api/src/modules/processes/process-material.routes.ts`: link, upload, download, and delete routes.
- Create `apps/web/src/components/area-archive-dialog.tsx`: impact review and resolution UI.
- Create `apps/web/src/components/process-editor.tsx`: area, owner, change note, links, and file editor.
- Modify `apps/api/src/db/postgres.ts`: retain generic repositories and delegate the operational bundle.
- Modify `apps/api/src/app.ts`: inject lifecycle service and object storage into routes.
- Modify `apps/api/src/server.ts`: run schema migrations and choose operational repository mode.
- Modify `apps/api/src/config/runtime.ts`: validate relational store and S3 configuration.
- Modify `apps/api/src/modules/company/company.types.ts`: archived area state and impact types.
- Modify `apps/api/src/modules/company/company.routes.ts`: impact and archive endpoints.
- Modify `apps/api/src/modules/processes/process.types.ts`: role owner and process materials.
- Modify `apps/api/src/modules/processes/process.service.ts`: reference validation and versioned edits.
- Modify `apps/api/src/modules/processes/process.routes.ts`: new editable fields and material route registration.
- Modify `apps/api/src/modules/routines/routine.types.ts`: relational IDs and area snapshot fields without changing Today yet.
- Modify `apps/web/src/api.ts`: API contracts and multipart helpers.
- Modify `apps/web/src/App.tsx`: mount extracted dialogs/editors and suppress unresolved placeholders.
- Modify `apps/web/src/styles.css`: styles using the existing Baase tokens and spacing.
- Modify `apps/api/package.json`: migration script and S3/multipart dependencies.
- Modify `.env.production.example`: operational store and MinIO variables.
- Modify `docker-compose.prod.yml`: MinIO service, persistent volume, and API environment.
- Create `docs/deployment-operational-migration.md`: rehearsal, backfill, reconciliation, and cutover runbook.

### Task 1: Create the versioned relational schema

**Files:**
- Create: `apps/api/src/db/operational-schema.ts`
- Create: `apps/api/src/db/operational-schema.test.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Write schema tests that prove migration repeatability and foreign-key behavior**

```ts
it("applies the operational schema twice without duplicating migrations", async () => {
  await ensureOperationalSchema(db);
  await ensureOperationalSchema(db);
  const result = await db.query("select version from baase_schema_migrations order by version");
  expect(result.rows.map((row) => row.version)).toEqual([1]);
});

it("rejects a process that references an area in another workspace", async () => {
  await seedWorkspace(db, "workspace_a");
  await seedWorkspace(db, "workspace_b");
  await seedArea(db, { id: "area_b", workspaceId: "workspace_b", name: "Financeiro" });
  await expect(db.query(
    "insert into processes (id, workspace_id, area_id, title, status, created_by_profile_id) values ($1,$2,$3,$4,$5,$6)",
    ["process_a", "workspace_a", "area_b", "Fechamento", "draft", "profile_a"]
  )).rejects.toThrow();
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @prymeira/baase-api test -- operational-schema.test.ts`

Expected: FAIL because `ensureOperationalSchema` does not exist.

- [ ] **Step 3: Add migration version 1 with workspace-scoped foreign keys**

Implement `ensureOperationalSchema(db)` as a transaction guarded by a Postgres advisory lock. Create `baase_schema_migrations`, then these tables with `created_at`, `updated_at`, and workspace-scoped unique keys:

```sql
create table if not exists areas (
  id text not null,
  workspace_id text not null,
  name text not null,
  description text,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists processes (
  id text not null,
  workspace_id text not null,
  area_id text,
  title text not null,
  summary text,
  status text not null check (status in ('draft','published','archived')),
  owner_profile_id text,
  owner_role_template_id text,
  current_version integer not null default 1,
  created_by_profile_id text not null,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, area_id) references areas(workspace_id, id)
);
```

The same migration must create `people`, `role_templates`, `process_versions`, `process_materials`, `routines`, `routine_steps`, `routine_assignments`, `routine_occurrences`, `task_occurrences`, `task_checklist_items`, `task_evidence`, and `operational_audit_log`. Use `ON DELETE SET NULL` only for active references that may become `Sem área`; use snapshots (`area_name_snapshot`, `routine_title_snapshot`, `step_title_snapshot`) on occurrence tables. Add unique indexes for `(workspace_id, routine_id, due_date, audience_key)` and `(workspace_id, task_occurrence_id, sort_order)`.

- [ ] **Step 4: Run schema tests and API typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- operational-schema.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: all schema tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the schema**

```bash
git add apps/api/src/db/operational-schema.ts apps/api/src/db/operational-schema.test.ts apps/api/package.json
git commit -m "feat: add relational operational schema"
```

### Task 2: Backfill JSONB data idempotently

**Files:**
- Create: `apps/api/src/db/operational-backfill.ts`
- Create: `apps/api/src/db/operational-backfill.test.ts`
- Create: `apps/api/src/db/migrate-operational.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Write failing tests for normal records, orphan areas, snapshots, and a second run**

```ts
it("moves orphaned references to Sem area without exposing the internal id", async () => {
  await seedLegacyRecord(db, "process", "process_1", {
    id: "process_1", workspaceId: "workspace_a", areaId: "area_5", title: "Fechamento"
  });
  const first = await backfillOperationalData(db);
  const second = await backfillOperationalData(db);
  const process = await db.query("select area_id from processes where workspace_id = $1 and id = $2", ["workspace_a", "process_1"]);
  expect(process.rows[0].area_id).toBeNull();
  expect(first.orphanReferences).toEqual([{ entityType: "process", entityId: "process_1", field: "area_id", legacyValue: "area_5" }]);
  expect(second.insertedTotal).toBe(0);
});
```

- [ ] **Step 2: Run the backfill test and verify it fails**

Run: `pnpm --filter @prymeira/baase-api test -- operational-backfill.test.ts`

Expected: FAIL because `backfillOperationalData` is missing.

- [ ] **Step 3: Implement ordered, resumable conversion and a JSON report**

Export:

```ts
export type OperationalBackfillReport = {
  sourceCounts: Record<string, number>;
  targetCounts: Record<string, number>;
  insertedTotal: number;
  orphanReferences: Array<{
    entityType: string;
    entityId: string;
    field: string;
    legacyValue: string;
  }>;
};

export async function backfillOperationalData(db: Queryable): Promise<OperationalBackfillReport>;
```

Read legacy kinds in dependency order: areas, role templates, people, processes, process versions, routines, routine templates, then task occurrences. Every concrete table insert must end with `ON CONFLICT DO NOTHING`. Convert missing area references to `NULL`, preserve the last known area name in occurrence snapshots, and write each unresolved reference to `operational_audit_log` with action `legacy_reference_unresolved`.

Add the script:

```json
"db:migrate-operational": "tsx src/db/migrate-operational.ts"
```

The CLI must require `DATABASE_URL`, call schema then backfill, print exactly one JSON report, and exit non-zero when source/target reconciliation fails.

- [ ] **Step 4: Run tests and prove the CLI rejects a missing database URL**

Run: `pnpm --filter @prymeira/baase-api test -- operational-backfill.test.ts && env -u DATABASE_URL pnpm --filter @prymeira/baase-api db:migrate-operational`

Expected: tests PASS; CLI exits 1 with `DATABASE_URL is required`.

- [ ] **Step 5: Commit the backfill**

```bash
git add apps/api/src/db/operational-backfill.ts apps/api/src/db/operational-backfill.test.ts apps/api/src/db/migrate-operational.ts apps/api/package.json
git commit -m "feat: add idempotent operational backfill"
```

### Task 3: Implement relational repositories and controlled cutover

**Files:**
- Create: `apps/api/src/modules/company/postgres-company.repository.ts`
- Create: `apps/api/src/modules/processes/postgres-process.repository.ts`
- Create: `apps/api/src/modules/routines/postgres-routine.repository.ts`
- Create: `apps/api/src/db/operational-repositories.test.ts`
- Modify: `apps/api/src/db/postgres.ts`
- Modify: `apps/api/src/config/runtime.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `.env.production.example`

- [ ] **Step 1: Write repository contract tests using the existing service APIs**

```ts
it("keeps an existing occurrence snapshot after the routine template changes", async () => {
  const routine = await routineRepository.createRoutine(routineInput({ title: "Abertura", areaId: "area_ops" }));
  const occurrence = await routineService.generateOccurrences("workspace_a", routine.id, "2026-07-10");
  await routineService.updateRoutine("workspace_a", routine.id, routineInput({ title: "Abertura revisada", areaId: null }));
  const stored = await routineRepository.findTaskOccurrence("workspace_a", occurrence[0].id);
  expect(stored?.routineTitleSnapshot).toBe("Abertura");
  expect(stored?.areaNameSnapshot).toBe("Operações");
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `pnpm --filter @prymeira/baase-api test -- operational-repositories.test.ts`

Expected: FAIL because relational repository factories and snapshot properties do not exist.

- [ ] **Step 3: Implement repository factories and store selection**

Expose factories with the existing repository interfaces:

```ts
export function createPostgresCompanyRepository(db: Queryable): CompanyRepository;
export function createPostgresProcessRepository(db: Queryable): ProcessRepository;
export function createPostgresRoutineRepository(db: Queryable): RoutineRepository;
```

Every mutation must run in a transaction, filter by `workspace_id`, map snake_case rows to domain objects, and append `operational_audit_log`. Reads exclude `archived_at is not null` except version/history reads. In `server.ts`, choose relational repositories only when `BAASE_OPERATIONAL_STORE=relational`; keep JSONB as an explicit rollback mode. Extend `/readiness` with `operational_store` and fail runtime validation if production omits the setting.

- [ ] **Step 4: Run repository tests plus the existing API suite**

Run: `pnpm --filter @prymeira/baase-api test && pnpm --filter @prymeira/baase-api typecheck`

Expected: all API tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the repository cutover**

```bash
git add apps/api/src/modules/company/postgres-company.repository.ts apps/api/src/modules/processes/postgres-process.repository.ts apps/api/src/modules/routines/postgres-routine.repository.ts apps/api/src/db/operational-repositories.test.ts apps/api/src/db/postgres.ts apps/api/src/config/runtime.ts apps/api/src/server.ts .env.production.example
git commit -m "feat: add relational operational repositories"
```

### Task 4: Add safe area impact and archive operations

**Files:**
- Create: `apps/api/src/modules/company/area-lifecycle.service.ts`
- Create: `apps/api/src/modules/company/area-lifecycle.service.test.ts`
- Modify: `apps/api/src/modules/company/company.types.ts`
- Modify: `apps/api/src/modules/company/company.routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/modules/company/company.routes.test.ts`

- [ ] **Step 1: Write failing service and route tests**

```ts
it("refuses to archive an area until active links have a strategy", async () => {
  const response = await app.inject({ method: "POST", url: "/areas/area_ops/archive", headers: ownerHeaders, payload: {} });
  expect(response.statusCode).toBe(409);
  expect(response.json().error.code).toBe("AREA_ARCHIVE_RESOLUTION_REQUIRED");
});

it("reassigns active links atomically before archiving", async () => {
  const response = await app.inject({
    method: "POST", url: "/areas/area_ops/archive", headers: ownerHeaders,
    payload: { strategy: "reassign", target_area_id: "area_finance" }
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().result.reassigned.processes).toBe(1);
});
```

- [ ] **Step 2: Run tests and verify the new route is missing**

Run: `pnpm --filter @prymeira/baase-api test -- area-lifecycle.service.test.ts company.routes.test.ts`

Expected: FAIL with route 404 and missing service exports.

- [ ] **Step 3: Implement impact and archive contracts**

Add:

```ts
export type AreaImpact = {
  area: Area;
  processes: Array<{ id: string; title: string }>;
  routines: Array<{ id: string; title: string }>;
  roleTemplates: Array<{ id: string; name: string }>;
  people: Array<{ id: string; name: string }>;
};

export type ArchiveAreaInput =
  | { strategy: "reassign"; targetAreaId: string }
  | { strategy: "unassign" };
```

Register `GET /areas/:id/impact` and `POST /areas/:id/archive`. The service must lock the source area, reject same-area reassignment, update all active links in one transaction, archive role templates that cannot be left unassigned, write an audit event, and return affected counts. Keep `DELETE /areas/:id` as a deprecated alias that returns `409 AREA_ARCHIVE_RESOLUTION_REQUIRED` when links exist.

- [ ] **Step 4: Run company and repository tests**

Run: `pnpm --filter @prymeira/baase-api test -- area-lifecycle.service.test.ts company.routes.test.ts operational-repositories.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 5: Commit controlled area archive**

```bash
git add apps/api/src/modules/company/area-lifecycle.service.ts apps/api/src/modules/company/area-lifecycle.service.test.ts apps/api/src/modules/company/company.types.ts apps/api/src/modules/company/company.routes.ts apps/api/src/modules/company/company.routes.test.ts apps/api/src/app.ts
git commit -m "feat: resolve area links before archive"
```

### Task 5: Add process owners, versions, and link materials

**Files:**
- Modify: `apps/api/src/modules/processes/process.types.ts`
- Modify: `apps/api/src/modules/processes/process.service.ts`
- Modify: `apps/api/src/modules/processes/process.routes.ts`
- Modify: `apps/api/src/modules/processes/in-memory-process.repository.ts`
- Test: `apps/api/src/modules/processes/process.service.test.ts`
- Test: `apps/api/src/modules/processes/process.routes.test.ts`

- [ ] **Step 1: Write failing process edit tests**

```ts
it("edits area, person owner, role owner, and link materials in one version", async () => {
  const response = await app.inject({
    method: "PATCH", url: "/processes/process_1", headers: ownerHeaders,
    payload: {
      title: "Fechamento revisado", body: "Passos revisados", change_note: "Responsabilidade definida",
      area_id: "area_finance", owner: { type: "role", role_template_id: "role_controller" },
      materials: [{ kind: "link", title: "Planilha oficial", url: "https://example.com/planilha" }]
    }
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().process.owner).toEqual({ type: "role", roleTemplateId: "role_controller" });
  expect(response.json().process.materials[0].title).toBe("Planilha oficial");
});
```

- [ ] **Step 2: Run process tests and verify the schema rejects the new fields**

Run: `pnpm --filter @prymeira/baase-api test -- process.service.test.ts process.routes.test.ts`

Expected: FAIL because owner unions and materials are not in the domain contract.

- [ ] **Step 3: Implement explicit owner and material types**

```ts
export type ProcessOwner =
  | { type: "person"; profileId: string }
  | { type: "role"; roleTemplateId: string };

export type ProcessMaterial = {
  id: string;
  processId: string;
  workspaceId: string;
  kind: "link" | "file";
  title: string;
  url: string | null;
  objectKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
};
```

Validate that exactly one owner target is present and belongs to the workspace. Require a non-empty `change_note` for edits. Persist each edit as a new `process_versions` row and update `current_version` transactionally. Return no `owner` or `materials` display row when values are absent.

- [ ] **Step 4: Run process tests and API typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- process.service.test.ts process.routes.test.ts && pnpm --filter @prymeira/baase-api typecheck`

Expected: focused tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit editable process metadata**

```bash
git add apps/api/src/modules/processes/process.types.ts apps/api/src/modules/processes/process.service.ts apps/api/src/modules/processes/process.routes.ts apps/api/src/modules/processes/in-memory-process.repository.ts apps/api/src/modules/processes/process.service.test.ts apps/api/src/modules/processes/process.routes.test.ts
git commit -m "feat: make process ownership and materials editable"
```

### Task 6: Add S3-compatible file materials and MinIO

**Files:**
- Create: `apps/api/src/storage/object-storage.ts`
- Create: `apps/api/src/storage/s3-object-storage.ts`
- Create: `apps/api/src/storage/in-memory-object-storage.ts`
- Create: `apps/api/src/modules/processes/process-material.routes.ts`
- Create: `apps/api/src/modules/processes/process-material.routes.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/package.json`
- Modify: `.env.production.example`
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: Write upload, download, failure, and removal tests**

```ts
it("uploads a file and only attaches it after object storage succeeds", async () => {
  const response = await uploadFixture(app, "/processes/process_1/materials/files", "checklist.pdf", "application/pdf");
  expect(response.statusCode).toBe(201);
  expect(response.json().material).toMatchObject({ kind: "file", title: "checklist.pdf", contentType: "application/pdf" });
});

it("does not persist a material when object storage fails", async () => {
  objectStorage.failNextPut(new Error("storage unavailable"));
  const response = await uploadFixture(app, "/processes/process_1/materials/files", "checklist.pdf", "application/pdf");
  expect(response.statusCode).toBe(503);
  expect(await processRepository.listMaterials("workspace_a", "process_1")).toEqual([]);
});
```

- [ ] **Step 2: Run the route test and verify it fails**

Run: `pnpm --filter @prymeira/baase-api test -- process-material.routes.test.ts`

Expected: FAIL because multipart and object storage are not registered.

- [ ] **Step 3: Implement the storage port and material routes**

```ts
export type ObjectStorage = {
  put(input: { key: string; body: NodeJS.ReadableStream; contentType: string; sizeBytes?: number }): Promise<void>;
  createDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
};
```

Register `@fastify/multipart` with a 25 MB file limit. Add `POST /processes/:id/materials/links`, `POST /processes/:id/materials/files`, `GET /processes/:id/materials/:materialId/download`, and `DELETE /processes/:id/materials/:materialId`. Generate keys as `workspaces/{workspaceId}/processes/{processId}/{uuid}-{sanitizedName}`. If DB persistence fails after upload, delete the object before returning.

Add `minio/minio` to `docker-compose.prod.yml`, attach it only to the internal overlay network, run `server /data --console-address :9001`, and persist `/data` in external volume `prymeira_baase_minio_data`. Configure the API with `S3_ENDPOINT=http://prymeira_baase_minio:9000`, `S3_FORCE_PATH_STYLE=true`, bucket, access key, and secret key.

- [ ] **Step 4: Run route tests and render the production compose config**

Run: `pnpm --filter @prymeira/baase-api test -- process-material.routes.test.ts && docker compose -f docker-compose.prod.yml config >/tmp/baase-compose.yml`

Expected: tests PASS and Docker Compose exits 0 without unresolved required variables when supplied through the documented env file.

- [ ] **Step 5: Commit object storage support**

```bash
git add apps/api/src/storage apps/api/src/modules/processes/process-material.routes.ts apps/api/src/modules/processes/process-material.routes.test.ts apps/api/src/app.ts apps/api/src/server.ts apps/api/package.json pnpm-lock.yaml .env.production.example docker-compose.prod.yml
git commit -m "feat: add process file materials with minio"
```

### Task 7: Build area archive and process editing UI

**Files:**
- Create: `apps/web/src/components/area-archive-dialog.tsx`
- Create: `apps/web/src/components/area-archive-dialog.test.tsx`
- Create: `apps/web/src/components/process-editor.tsx`
- Create: `apps/web/src/components/process-editor.test.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/App.test.tsx`
- Test: `apps/web/src/api.test.ts`

- [ ] **Step 1: Write failing UI tests for visible impact and editable process metadata**

```tsx
it("shows affected records and requires an area resolution", async () => {
  render(<AreaArchiveDialog area={area} impact={impact} areas={areas} onConfirm={onConfirm} onClose={vi.fn()} />);
  expect(screen.getByText("2 processos")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Arquivar área" })).toBeDisabled();
  await userEvent.click(screen.getByLabelText("Transferir vínculos"));
  await userEvent.selectOptions(screen.getByLabelText("Nova área"), "area_finance");
  expect(screen.getByRole("button", { name: "Arquivar área" })).toBeEnabled();
});
```

- [ ] **Step 2: Run web tests and verify the components are missing**

Run: `pnpm --filter @prymeira/baase-web test -- area-archive-dialog.test.tsx process-editor.test.tsx`

Expected: FAIL because both component modules do not exist.

- [ ] **Step 3: Implement the dialogs using current visual primitives**

The area dialog must show counts and names, a radio choice between transfer and `Sem área`, a target area select, destructive confirmation, loading/error state, and focus return. The process editor must expose title, summary, area, owner mode (`Pessoa`, `Cargo`, `Sem responsável`), corresponding select, change note, link rows, file rows with upload progress/retry, and the existing SOP body. Use the current `modal-form`, `secondary-btn`, `accent-solid`, input, border, and color tokens; do not introduce a second card layer.

Map missing/archived area names through one helper:

```ts
export function areaDisplayName(areaId: string | null, areas: ApiArea[], snapshot?: string | null) {
  if (!areaId) return "Sem área";
  return areas.find((area) => area.id === areaId)?.name ?? snapshot ?? "Área removida";
}
```

Never fall back to `areaId` in visible text. In process read view, omit the responsible and materials rows entirely when neither exists.

- [ ] **Step 4: Run web tests, typecheck, and production build**

Run: `pnpm --filter @prymeira/baase-web test && pnpm --filter @prymeira/baase-web typecheck && pnpm --filter @prymeira/baase-web build`

Expected: all web tests PASS, TypeScript exits 0, and Vite build succeeds.

- [ ] **Step 5: Commit the editing UI**

```bash
git add apps/web/src/components/area-archive-dialog.tsx apps/web/src/components/area-archive-dialog.test.tsx apps/web/src/components/process-editor.tsx apps/web/src/components/process-editor.test.tsx apps/web/src/api.ts apps/web/src/api.test.ts apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/styles.css
git commit -m "feat: add safe area and process editing flows"
```

### Task 8: Rehearse migration and document the production cutover

**Files:**
- Create: `docs/deployment-operational-migration.md`
- Modify: `docker-compose.prod.yml`
- Modify: `.env.production.example`

- [ ] **Step 1: Add a runbook with exact backup, rehearsal, and rollback commands**

Document this sequence with actual stack/service names:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=baase-pre-operational.dump
createdb baase_rehearsal
pg_restore --no-owner --dbname="$REHEARSAL_DATABASE_URL" baase-pre-operational.dump
DATABASE_URL="$REHEARSAL_DATABASE_URL" pnpm --filter @prymeira/baase-api db:migrate-operational > operational-report.json
jq '.sourceCounts, .targetCounts, .orphanReferences' operational-report.json
```

The production sequence must deploy first with `BAASE_OPERATIONAL_STORE=jsonb`, run migration once, compare counts, then update the stack to `BAASE_OPERATIONAL_STORE=relational`. Rollback changes only that environment variable; it never deletes new tables or the existing volume.

- [ ] **Step 2: Validate every command and environment name against the repository**

Run: `rg -n "BAASE_OPERATIONAL_STORE|S3_|MINIO_|prymeira_baase_minio_data" .env.production.example docker-compose.prod.yml apps/api/src docs/deployment-operational-migration.md`

Expected: every variable appears in runtime code, the example env, compose, and the runbook.

- [ ] **Step 3: Run the full phase verification**

Run: `pnpm test && pnpm typecheck && pnpm build && docker compose -f docker-compose.prod.yml config >/tmp/baase-compose.yml`

Expected: all tests, typechecks, builds, and compose validation exit 0.

- [ ] **Step 4: Commit deployment documentation**

```bash
git add docs/deployment-operational-migration.md docker-compose.prod.yml .env.production.example
git commit -m "docs: add operational data cutover runbook"
```

## Phase 1 Acceptance Gate

- [ ] Migration runs twice on a production database copy with zero duplicate target rows.
- [ ] Reconciliation report explains every orphaned reference and no UI exposes internal IDs.
- [ ] Existing occurrences retain area and routine snapshots after template edits.
- [ ] Area archive requires transfer or unassignment and updates all links atomically.
- [ ] Process owner can be a person, role, or empty, and is editable after creation.
- [ ] Link and file materials upload, download, retry, and delete correctly.
- [ ] JSONB rollback mode remains deployable until the relational production soak is approved.
