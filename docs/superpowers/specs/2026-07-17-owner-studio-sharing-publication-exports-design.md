# Owner Studio Sharing and Editorial Publication Exports

**Date:** 2026-07-17  
**Status:** Approved in product-design dialogue; awaiting written-spec review  
**Scope:** Owner-to-owner Studio sharing, Studio publication exports, and premium process SOP exports

## 1. Purpose

The Owner Studio is private by default, but an owner needs a deliberate way to share one useful piece of thinking with other owners without turning the Studio into a general collaboration suite. The same content also needs to leave the product as a professional publication: either a presentation-ready PDF or a complete preservation package. Process SOP exports must use the same premium editorial system instead of the current box-heavy PDF template.

This design treats these needs as one publication capability with three independently deliverable modules:

1. Share a Studio sheet with owners, allow general comments, and import an independent copy.
2. Export a Studio sheet as an editorial PDF or a complete ZIP package.
3. Replace the current process PDF with an adaptive editorial SOP renderer.

The modules share access policy, object storage, export-job infrastructure, branding, rendering primitives, and audit conventions. They must remain separable so a failure in rendering cannot affect sharing or document editing.

## 2. Product language and principles

The user-facing name for a Studio document is **Folha**. Internal API and database names may continue to use `document` where changing them would create unnecessary migration risk.

The capability follows these principles:

- Private by default.
- Share intentionally; never infer recipients.
- Let recipients discuss, not silently rewrite, the author's source.
- Import creates ownership; sharing does not.
- Preserve human authorship and clearly label AI-generated content.
- Never synchronize or overwrite an imported copy automatically.
- Make exported media useful without weakening access control.
- Use the customer's company as the primary PDF brand; use “Gerado com Prymeira Baase” only as a quiet footer mark.
- Prefer an adaptive editorial composition over rigid page templates or repeated visual cards.

## 3. Module A: owner-to-owner sharing

### 3.1 Entry point

The editor remains visually quiet. The existing “more” menu becomes the home for external actions:

- Compartilhar
- Exportar
- Mover
- Arquivar
- Excluir

`Compartilhar` opens a compact side panel. Sharing and export do not receive permanent primary buttons in the editor header.

### 3.2 Recipients and permissions

The author can:

- Select one or more owners nominally.
- Enable `Todos os donos`.
- Combine nominal recipients with `Todos os donos` without duplicate access.
- Revoke an individual share or disable the all-owner share.

`Todos os donos` is dynamic. Any person who later becomes an active owner in the same workspace receives access while the rule remains enabled. Nominal sharing is the way to freeze a specific recipient set.

The only initial shared permission is **read and comment**. Recipients cannot edit text, title, materials, classification, structures, versions, or sharing settings on the source sheet. Managers and employees cannot discover the sheet, its comments, or its metadata.

### 3.3 Discovery without a heavier sidebar

The existing `Tudo` section receives two quiet filters:

- Minhas folhas
- Compartilhadas comigo

Shared sheets show the author's avatar/name and a `Compartilhada` label. Studio Home may show a small `Compartilhadas recentemente` block only when there is new activity. No new permanent sidebar destination is added.

### 3.4 Comments

Comments are a general conversation about the whole sheet, displayed in the sharing side panel. Inline text anchors are out of scope.

A comment contains:

- Author identity.
- Plain-text body.
- Created and edited timestamps.
- Optional owner mentions.
- Deletion metadata when the author removes it.

The sheet author and active recipients can read and add comments. A commenter may edit or delete their own comment. The sheet author may hide a comment; the audit record retains the original author and moderation event, and the UI never presents the author as having removed it themselves. HTML execution, file attachments, reactions, threads, and inline annotations are out of scope for the initial release.

### 3.5 Importing a shared sheet

A recipient can choose `Importar para meu Estúdio`. Importing:

- Creates a new private sheet owned by the recipient.
- Copies the current title, body, classification, and eligible materials.
- Does not copy comments or sharing rules.
- Preserves source author, source sheet ID, source version, and import timestamp as provenance.
- Uses idempotency so repeated confirmation cannot create duplicate copies.

An eligible material is active, scan-ready, readable by the importing owner through the source share, and stored in Baase-controlled object storage. Quarantined, failed, deleted, or external-link-only materials are represented in provenance but are not copied as owned binary files.

After import, the copy and source evolve independently. No source change can overwrite the copy. If the source advances beyond the imported version, the copy shows a quiet notice:

> A folha original foi atualizada por {autor} em {data}.

Actions:

- `Ver alterações` opens a read-only comparison between the imported source version and the latest accessible source version.
- `Importar versão atualizada como nova Folha` creates another independent copy.
- `Ignorar esta atualização` records the latest dismissed source version.

Selective merge and automatic replacement are out of scope.

If source access is revoked or the source is deleted, the imported copy remains. It shows `A fonte original não está mais compartilhada` and no longer reveals future source content or revisions.

### 3.6 Suggested persistence boundaries

Use explicit, owner-scoped records rather than changing source ownership:

- `studio_document_shares`: source document, audience type (`owner` or `all_owners`), optional recipient profile, permission (`read_comment`), author, active/revoked timestamps.
- `studio_document_comments`: document, author profile, plain-text body, edit/delete timestamps.
- `studio_document_imports`: imported document, source document, source owner snapshot, imported source version, last dismissed source version, provenance timestamps, and unavailable-source state.

All source reads use one access-policy service. Repository queries must not fetch broadly and filter in the browser.

## 4. Module B: Studio publication exports

### 4.1 Formats

The export panel offers two primary formats:

1. **PDF para apresentar** — a professional editorial representation of the current sheet.
2. **Pacote completo para preservar** — a ZIP containing the editorial PDF and the original eligible materials.

Every export is an immutable snapshot. Later sheet edits do not mutate an existing export.

### 4.2 Export configuration

The panel provides a visual preview and asks only what changes the result:

- Format: PDF or complete package.
- Destination: internal or external.
- Optional content: comments, version history, and full transcription.
- External expiration: 1 day, 7 days (default), 30 days, or an explicit future date.

The current sheet content, title, author, date, type, company brand, images, material index, and clearly identified AI content are included by default. Comments and version history are excluded by default.

### 4.3 PDF composition

The PDF uses the approved **Editorial executivo** direction:

- Company-branded cover.
- Strong serif display hierarchy paired with a highly legible sans-serif body.
- Generous margins and controlled white space.
- Current body rendered as semantic sections instead of generic boxes.
- High-resolution images embedded in the document.
- Audio and video represented as editorial media cards with title, duration, a transcript excerpt, and QR/link access.
- Attached files presented as a final materials index.
- AI output visibly separated and labeled as generated content.
- Automatic table of contents only for long documents.
- Footer containing company name, confidentiality, snapshot date, page number, and a subtle Baase mark.
- Visible expiration date when external media links are present.

The PDF must remain meaningful after a media link expires: its transcript excerpt, filename, duration, and provenance remain readable.

### 4.4 Internal and external media access

Internal QR/link access requires an authenticated user with current permission to the source or exported snapshot.

External export creates a revocable, expiring access grant. The grant exposes only the media included in that export snapshot; it does not expose Studio navigation, comments, other sheets, or future versions. Tokens are unguessable, stored as hashes, audited, and invalidated immediately on revocation or expiry.

### 4.5 Complete package layout

The ZIP uses sanitized, deterministic filenames:

- `Folha.pdf`
- `Midias/` — original eligible audio, video, and images.
- `Anexos/` — original attached files.
- `Transcricoes/` — full transcriptions when selected and available.
- `LEIA-ME.pdf` — authorship, provenance, snapshot date, package index, and access notes.

Missing or quarantined material does not fail the entire export. The manifest records it as unavailable and the PDF displays a restrained unavailable-material state.

### 4.6 Export lifecycle

Publication export states are:

- `pending`
- `rendering`
- `ready`
- `failed`
- `expired`
- `revoked`

Generation is asynchronous and retryable. A failure cannot mutate the sheet or a previously ready export. Requests use idempotency keys. Storage cleanup removes expired/revoked export objects according to retention policy without deleting source materials.

The existing Studio portability export queue provides proven patterns for claims, leases, expiry, object storage, cleanup, and friendly filenames. Publication exports should reuse those primitives through shared infrastructure but remain a separate domain/table because portability exports have different content, authorization, and retention semantics.

Suggested records:

- `studio_publication_exports`: snapshot owner/source, format, audience, options, status, object keys, renderer version, claim lease, expiry/revocation/failure metadata.
- `studio_export_access_grants`: export, hashed external token, expiry, revocation, last-access metadata.

## 5. Module C: premium process SOP exports

### 5.1 Adaptive structure

The renderer composes the document according to content length. A short SOP may use two to four pages; a long SOP adds a table of contents, chapter dividers, and appendices. It must not create empty pages merely to satisfy a fixed template.

The approved composition is:

1. **Cover:** company brand, process title, area, status, version, document code, date, and concise summary.
2. **Visão geral:** objective, trigger, operational rule, responsible role, and final process result.
3. **Execução:** numbered steps with editorial numerals, concise body, expected result, attention points, and evidence/material references.
4. **Materials appendix:** images, documents, audio/video cards, and controlled QR links when applicable.
5. **Document control:** publication state, responsible roles, current version, and compact change history.

Page continuation always retains process/chapter context. Expected-result treatment is a quiet confirmation, not a full-width repeated green card. Step numbers are typographic markers, not square UI controls.

### 5.2 Permissions

Anyone allowed to view the process may download its internal PDF. Only an owner or a manager authorized for the process area may create an external export with temporary material links. Restricted materials remain protected independently from PDF possession.

### 5.3 Migration from the current renderer

The current frontend PDFMake generator is replaced, not restyled in parallel. Existing `Baixar PDF` behavior calls the publication-export API and shows preparation/readiness states. The old renderer remains only behind a temporary rollback flag during rollout and is removed after parity and production verification.

## 6. Rendering architecture

### 6.1 Chosen approach

Use a server-side publication renderer based on print HTML/CSS and a controlled headless Chromium runtime. This was selected over:

- Continued client-side PDFMake: lightweight but difficult to centralize, audit, package, and evolve into a premium editorial system.
- An external PDF vendor: capable but introduces cost, vendor dependence, and unnecessary exposure of private content.

The renderer is accessed through an interface so job orchestration and access policy do not depend on Chromium details. Initial execution may run in the existing maintenance worker, but the renderer boundary must permit a dedicated worker later without changing product APIs.

### 6.2 Template system

Create one versioned editorial design system shared by sheet and SOP templates:

- Company-brand inputs: name, logo, approved accent, optional legal footer.
- Typography tokens and embedded print fonts.
- A4 page geometry, margins, baseline spacing, header/footer rules.
- Cover, section opener, body section, quote, callout, media card, QR card, step, expected result, attention note, material index, document control, and unavailable-material primitives.
- Template and renderer version recorded on each export.

Templates receive normalized publication models rather than raw database rows. This isolates rendering from Studio and process repository changes.

## 7. Security and failure behavior

- Studio remains private unless an active share authorizes access.
- Every share, comment, import, export, external access, revocation, and download is workspace-scoped and audited.
- Managers and employees cannot enumerate owner-shared sheets.
- Plain-text comment validation prevents executable markup.
- Import and export requests are idempotent.
- Revoking source access never deletes an imported copy.
- Source unavailability never leaks new revision metadata.
- External export grants are mandatory-expiry, hash-stored, revocable, and snapshot-limited.
- Rendering occurs without arbitrary outbound network access; required assets are supplied through controlled storage reads.
- PDF/ZIP failures never modify source data.
- Missing media degrades locally in the document rather than aborting unrelated pages.
- Cleanup is retryable and reports partial object-removal failures without claiming successful deletion.

## 8. Acceptance and verification

### 8.1 Sharing matrix

- Nominal owner share, multiple recipients, and duplicate-recipient prevention.
- Dynamic `all_owners`, including an owner added after sharing.
- Same-workspace enforcement and cross-workspace isolation.
- Manager/employee non-discovery.
- Revocation, comment authorization, comment edit/delete ownership, and moderation.
- Import idempotency, independent editing, provenance display, source update notice, comparison, dismissal, and unavailable source.
- Imported copy surviving share revocation and source deletion.

### 8.2 Export lifecycle

- Internal and external PDF exports.
- One-day, seven-day, 30-day, and explicit-date expiration.
- External token hashing, access, expiry, revocation, and audit.
- Export idempotency, worker leasing, retry, failure, cleanup, and object-storage recovery.
- ZIP manifest and deterministic safe filenames.
- Missing/quarantined materials represented honestly.

### 8.3 Visual and document verification

Maintain deterministic fixtures and render each meaningful template to PNG for review:

- Short, long, and multimedia Studio sheets.
- Sheet with AI content and optional comments/history.
- Short SOP and multi-page SOP.
- Long titles, long step bodies, many steps, image-heavy materials, missing media, and accented Portuguese text.
- Company logo present/missing and light/dark accent variants.

Automated checks include:

- No clipped or overlapping content.
- Stable page numbers, chapter continuity, and table of contents.
- Sharp images, readable QR codes, embedded fonts, and correct Portuguese glyphs.
- Extractable human-readable text and basic PDF accessibility metadata.
- Correct media/package manifest and no unrequested private content.
- Desktop and narrow export-panel behavior.

The final release gate includes browser acceptance, generated-PDF visual inspection, ZIP inspection, typecheck, build, migration tests, access-control tests, and production-container verification of the Chromium renderer.

## 9. Delivery sequence

1. **Sharing foundation:** ACL, discovery filters, comments, import lineage, update notices, and access tests.
2. **Publication infrastructure:** normalized publication models, render interface, export jobs, object storage, internal PDF, and editorial templates.
3. **External and package exports:** access grants, expiration/revocation, QR media, ZIP packaging, and audit.
4. **SOP migration:** adaptive SOP template, existing button integration, rollback flag, parity tests, and old renderer removal.

Each phase must be independently deployable and leave existing private Studio behavior intact.

## 10. Explicit non-goals

- Real-time collaborative editing.
- Inline comments anchored to text selections.
- Sharing with managers or employees.
- Public, non-expiring Studio links.
- Automatic synchronization or merge of imported copies.
- Selective paragraph merge from a newer source.
- Full document-management approval workflows.
- Multiple visual template themes in the first release.
- Editing exported PDFs after generation.
