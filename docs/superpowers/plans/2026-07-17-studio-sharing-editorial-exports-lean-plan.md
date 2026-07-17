# Studio Sharing and Editorial Exports — Lean Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline, one functional block at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let owners share and import Studio sheets, export complete professional publications, and replace the current process SOP PDF with the approved editorial renderer.

**Architecture:** Add an explicit owner-scoped sharing domain and a separate asynchronous publication-export domain. Normalize Studio sheets and processes into versioned publication models, then render both with one server-side HTML/CSS-to-PDF engine backed by existing object-storage and maintenance patterns.

**Tech Stack:** TypeScript, Fastify, PostgreSQL/in-memory repositories, React, Zod, object storage, headless Chromium through `playwright-core`, Vitest, Playwright E2E.

**Execution constraint:** Deliver the approved functional flows only. No inline comments, real-time editing, reactions, animation work, alternative themes, or extra microinteractions.

---

## File map

New backend boundaries:

- `apps/api/src/modules/studio/studio-sharing.types.ts` — share, comment, import, and lineage contracts.
- `apps/api/src/modules/studio/studio-sharing.store.ts` — persistence interface and in-memory implementation.
- `apps/api/src/modules/studio/postgres-studio-sharing.store.ts` — relational persistence.
- `apps/api/src/modules/studio/studio-sharing.service.ts` — access policy, comments, import, and source-update rules.
- `apps/api/src/modules/studio/studio-sharing.routes.ts` — owner-only HTTP API.
- `apps/api/src/modules/publications/publication.types.ts` — normalized publication/export contracts.
- `apps/api/src/modules/publications/publication.service.ts` — job lifecycle, access grants, object storage, ZIP packaging.
- `apps/api/src/modules/publications/publication.store.ts` — in-memory persistence interface.
- `apps/api/src/modules/publications/postgres-publication.store.ts` — relational persistence.
- `apps/api/src/modules/publications/publication-renderer.ts` — renderer interface and Chromium implementation.
- `apps/api/src/modules/publications/templates/editorial.css` — approved print design system.
- `apps/api/src/modules/publications/templates/studio-sheet.ts` — Studio publication HTML.
- `apps/api/src/modules/publications/templates/process-sop.ts` — adaptive SOP HTML.
- `apps/api/src/modules/publications/publication.routes.ts` — internal/export/external access API.

New web boundaries:

- `apps/web/src/studio/StudioDocumentMenu.tsx` — the quiet “more” menu.
- `apps/web/src/studio/StudioSharePanel.tsx` — recipients, general comments, import, provenance/update notice.
- `apps/web/src/studio/StudioExportPanel.tsx` — PDF/ZIP, audience, expiry, and optional-content form.
- `apps/web/src/publication-api.ts` — publication job and process-export client.

Focused existing files:

- `apps/api/src/db/operational-schema.ts`
- `apps/api/src/app.ts`
- `apps/api/src/modules/studio/studio.routes.ts`
- `apps/api/src/modules/studio/studio.types.ts`
- `apps/api/src/modules/studio/studio-asset-maintenance-runner.ts`
- `apps/api/Dockerfile`
- `apps/api/package.json`
- `apps/web/src/studio/StudioPage.tsx`
- `apps/web/src/studio/StudioEditor.tsx`
- `apps/web/src/studio/StudioLibrary.tsx`
- `apps/web/src/studio/studio-api.ts`
- `apps/web/src/studio/studio.types.ts`
- `apps/web/src/studio/studio.css`
- `apps/web/src/App.tsx`
- `tests/e2e/owner-studio.spec.ts`

---

### Task 1: Sharing, comments, and independent import backend

**Files:** sharing files above; migration 33 in `operational-schema.ts`; registration in `app.ts`; focused unit/route/repository tests beside the new files.

- [ ] **Define and test the access contract first**

Use these stable service shapes:

```ts
export type StudioShareAudience =
  | { type: "owner"; profileId: string }
  | { type: "all_owners" };

export type StudioSheetAccess = "owned" | "shared_read_comment";

export type StudioSharingService = {
  replaceShares(scope: StudioOwnerScope, documentId: string, audiences: StudioShareAudience[]): Promise<StudioShare[]>;
  listSharedWithMe(scope: StudioOwnerScope, query: StudioDocumentQuery): Promise<StudioDocumentPage>;
  listComments(scope: StudioOwnerScope, documentId: string): Promise<StudioComment[]>;
  addComment(scope: StudioOwnerScope, documentId: string, body: string): Promise<StudioComment>;
  editOwnComment(scope: StudioOwnerScope, commentId: string, body: string): Promise<StudioComment>;
  deleteOwnComment(scope: StudioOwnerScope, commentId: string): Promise<void>;
  moderateComment(scope: StudioOwnerScope, documentId: string, commentId: string): Promise<void>;
  importSheet(scope: StudioOwnerScope, documentId: string, idempotencyKey: string): Promise<StudioDocument>;
  readImportUpdate(scope: StudioOwnerScope, importedDocumentId: string): Promise<StudioImportUpdate>;
};
```

Tests must fail initially for: nominal sharing, dynamic all-owner access, cross-workspace/manager/employee denial, own-comment mutation, author moderation audit, idempotent import, independent copy, source update notice, and copy survival after revoke/delete.

- [ ] **Add migration 33 and both stores**

Create `studio_document_shares`, `studio_document_comments`, and `studio_document_imports` with workspace/owner/document indexes, one active all-owner rule per source, one active nominal rule per recipient, comment author metadata, import idempotency, source-version provenance, dismissed version, and source-unavailable state. Foreign keys must preserve imported provenance when a source is removed.

- [ ] **Implement the service and owner-only routes**

Expose:

```text
PUT    /studio/documents/:documentId/shares
GET    /studio/documents/shared
GET    /studio/documents/:documentId/comments
POST   /studio/documents/:documentId/comments
PATCH  /studio/comments/:commentId
DELETE /studio/comments/:commentId
DELETE /studio/documents/:documentId/comments/:commentId/moderate
POST   /studio/documents/:documentId/import
GET    /studio/documents/:documentId/import-update
POST   /studio/documents/:documentId/import-update/dismiss
```

Resolve active owners with `companyRepository.listTeamMembers(workspaceId)` and filter `role === "owner" && status === "active"`. Copy only active, ready, Baase-controlled assets; record unavailable material provenance rather than copying unsafe binaries.

- [ ] **Verify and commit the functional backend block**

```bash
pnpm --filter @prymeira/baase-api test -- \
  operational-schema.test.ts \
  studio-sharing.store.test.ts \
  postgres-studio-sharing.store.test.ts \
  studio-sharing.service.test.ts \
  studio-sharing.routes.test.ts
pnpm --filter @prymeira/baase-api typecheck
git add apps/api/src
git commit -m "feat(studio): add owner sheet sharing and import"
```

Expected: all focused tests pass; no existing owner-private query broadens access.

### Task 2: Quiet sharing UI and shared-sheet discovery

**Files:** `StudioDocumentMenu.tsx`, `StudioSharePanel.tsx`, their tests, and the focused Studio web files in the file map.

- [ ] **Write failing UI tests for the complete owner flow**

Cover only these visible outcomes:

```text
The editor exposes Compartilhar and Exportar inside one “mais” menu.
The share panel selects named owners or Todos os donos.
Comments are general, plain text, and visible only with active access.
Tudo filters Minhas folhas / Compartilhadas comigo.
Importar para meu Estúdio creates and opens a private copy with provenance.
An imported copy shows source-updated and source-unavailable notices honestly.
Ver alterações opens a read-only comparison; importing the update creates another independent sheet, while dismissing records that source version.
```

- [ ] **Implement menu, panel, filters, and provenance without editor redesign**

Add `accessScope: "owned" | "shared"`, author projection, and import provenance to web/API mapping. Keep shared sheets read-only in `StudioEditor`; mount comments/import actions in `StudioSharePanel`. Reuse existing loading, alert, and Quiet Ops tokens. Do not add a sidebar item or inline comment markers.

- [ ] **Verify and commit the UI block**

```bash
pnpm --filter @prymeira/baase-web test -- \
  StudioDocumentMenu.test.tsx \
  StudioSharePanel.test.tsx \
  StudioLibrary.test.tsx \
  StudioPage.test.tsx \
  studio-api.test.ts
pnpm --filter @prymeira/baase-web typecheck
git add apps/web/src/studio
git commit -m "feat(studio): add quiet owner sharing flows"
```

Expected: an owner can share, comment, discover, and import without any primary editor button or new navigation destination.

### Task 3: Editorial publication engine and internal PDFs

**Files:** publication backend files/templates; migration 34; `studio-asset-maintenance-runner.ts`; `app.ts`; `apps/api/Dockerfile`; `apps/api/package.json`; renderer/service/template tests.

- [ ] **Define normalized models and golden renderer tests**

```ts
export type PublicationRequest = {
  source: { kind: "studio_sheet" | "process_sop"; id: string };
  format: "pdf" | "complete_zip";
  audience: "internal" | "external";
  includeComments: boolean;
  includeVersionHistory: boolean;
  includeFullTranscripts: boolean;
  externalExpiresAt: string | null;
};

export interface PublicationRenderer {
  renderPdf(model: PublicationModel, signal?: AbortSignal): Promise<Buffer>;
}
```

Fixtures must render: short/long Studio sheet, multimedia sheet, short SOP, long SOP, long Portuguese title, missing logo, missing material, and multi-page continuation. Tests assert PDF signature, extractable title/body, embedded metadata, bounded page count, and no unresolved template tokens.

Load the existing workspace/company identity for primary branding, falling back to the workspace name and Baase green when no logo/accent exists. Do not add a branding-settings screen in this round.

- [ ] **Add migration 34, stores, worker lifecycle, and internal routes**

Create `studio_publication_exports` with pending/rendering/ready/failed/expired/revoked states, idempotency, renderer version, claim lease, object keys, options snapshot, expiry, failure, and audit fields. Add `studio_export_access_grants` for later external access. Reuse the portability worker's lease/storage/cleanup patterns without overloading portability tables.

Expose internal request/status/download routes:

```text
POST /publications
GET  /publications/:publicationId
GET  /publications/:publicationId/download
```

- [ ] **Implement the approved editorial renderer**

Use print HTML/CSS with embedded fonts, company branding, semantic cover/sections/media/steps, A4 `@page`, repeating headers/footers, and QR cards. Install `playwright-core`; add Alpine Chromium/font packages to `apps/api/Dockerfile`; inject the executable path through runtime config with a safe container default. Block arbitrary outbound requests in the renderer.

- [ ] **Render and visually inspect golden PDFs, then commit**

```bash
pnpm --filter @prymeira/baase-api test -- \
  publication-renderer.test.ts \
  publication.service.test.ts \
  publication.routes.test.ts \
  operational-schema.test.ts
pnpm --filter @prymeira/baase-api typecheck
pdftoppm -png tmp/pdfs/studio-sheet.pdf tmp/pdfs/studio-sheet
pdftoppm -png tmp/pdfs/process-sop.pdf tmp/pdfs/process-sop
git add apps/api pnpm-lock.yaml
git commit -m "feat(publications): add editorial PDF engine"
```

Expected: PDFs match the approved editorial direction and contain no clipping, overlap, broken glyphs, or repeated box-heavy layout.

### Task 4: External access, complete ZIP, and Studio export UI

**Files:** `publication.service.ts`, routes/store/tests, `StudioExportPanel.tsx`, `publication-api.ts`, Studio menu/page integration, E2E harness.

- [ ] **Test expiring access and package contents before implementation**

Cover 1/7/30-day and explicit-date expiry, hashed tokens, immediate revoke, snapshot-only access, audit, idempotent retry, missing material degradation, and deterministic ZIP entries:

```text
Folha.pdf
Midias/*
Anexos/*
Transcricoes/*
LEIA-ME.pdf
```

- [ ] **Implement external grants and complete-package generation**

Expose:

```text
POST   /publications/:publicationId/external-access
DELETE /publications/:publicationId/external-access
GET    /publication-access/:token
GET    /publication-access/:token/materials/:materialId
```

Hash tokens at rest, require expiry, audit access, and serve only objects named in the immutable export manifest. ZIP creation streams from object storage and records unavailable assets in both manifest and PDF.

- [ ] **Implement the compact export panel**

The panel contains format, destination, expiry, optional comments/history/transcript, request progress, retry, download, and revoke. Keep the default path to three decisions; do not add template/theme selection or animation work.

- [ ] **Verify the full Studio publication flow and commit**

```bash
pnpm --filter @prymeira/baase-api test -- publication.service.test.ts publication.routes.test.ts
pnpm --filter @prymeira/baase-web test -- StudioExportPanel.test.tsx StudioDocumentMenu.test.tsx
pnpm exec playwright test tests/e2e/owner-studio.spec.ts --project=chromium --grep "share|import|publication"
git add apps/api apps/web tests/e2e pnpm-lock.yaml
git commit -m "feat(studio): export sheets as protected publications"
```

Expected: PDF/ZIP work internally and externally; expiry/revoke never exposes source Studio data.

### Task 5: Process SOP cutover and one final release gate

**Files:** `apps/web/src/App.tsx`, `apps/web/src/publication-api.ts`, process/publication API tests, E2E tests, Docker/compose smoke tests, QA report.

- [ ] **Replace the process button with the publication API**

Remove `processPdfDefinition`, `downloadProcessPdf`, and the frontend PDFMake imports only after parity passes. `Baixar PDF` requests a `process_sop` publication and presents preparing, retry, and download states. Allow any process viewer to request internal PDF; owners and area-authorized managers can open the same compact publication panel to create or revoke external links.

- [ ] **Prove adaptive SOP output with the user's real fixture shape**

Use `Comunicar uso obrigatório do aplicativo de gestão operacional` as the deterministic content fixture. Verify cover, overview, steps 1–7, expected results, page continuation context, company-first branding, version metadata, and clean A4 rendering. Add a long-process fixture to prove adaptive table of contents/dividers.

- [ ] **Run one complete verification matrix**

```bash
pnpm typecheck
pnpm build
pnpm --filter @prymeira/baase-api test
pnpm --filter @prymeira/baase-web test
pnpm exec playwright test tests/e2e/owner-studio.spec.ts --project=chromium
git diff --check
```

Also build the production API image and execute one renderer smoke inside it. When deployed-environment credentials are available, run `pnpm exec playwright test --config=playwright.production.config.ts`; this opt-in smoke must not block local completion when credentials are absent. Render the final Studio and SOP PDFs to PNG, inspect every page, inspect ZIP entries, and record results in `docs/qa/2026-07-17-studio-sharing-editorial-exports.md`.

- [ ] **Remove rollback code after verification and commit**

```bash
git add apps tests docs pnpm-lock.yaml
git commit -m "feat(processes): publish premium editorial SOPs"
```

Expected: the approved flows are functional end to end, the old box-heavy SOP generator is gone, and no unapproved collaboration or visual extras were added.
