# Studio Editor and Premium Publications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve rich Studio writing in exported PDFs, restore a structured premium SOP layout, and let the Studio editor use the full available width whenever Copilot is closed.

**Architecture:** Add a shared SOP parser to `@prymeira/baase-shared`, then keep the two publication templates independent: Studio uses a safe TipTap JSON renderer while SOP uses the parsed operational structure. Lift Copilot visibility to `StudioEditorSession` so CSS can switch between one- and two-column layouts without changing document state.

**Tech Stack:** TypeScript, React 19, TipTap JSON, shared pnpm workspace package, server-side HTML/CSS, Playwright Chromium PDF rendering, Vitest, Testing Library.

---

## File map

- `packages/shared/src/process-sop.ts`: format and parse the canonical textual SOP representation.
- `packages/shared/src/process-sop.test.ts`: parser/formatter contract and legacy input coverage.
- `apps/api/src/modules/publications/templates/tiptap-html.ts`: allowlisted TipTap JSON-to-HTML renderer.
- `apps/api/src/modules/publications/templates/editorial.css.ts`: shared page primitives and print rules.
- `apps/api/src/modules/publications/templates/studio-sheet.ts`: “Caderno do dono” template.
- `apps/api/src/modules/publications/templates/process-sop.ts`: structured operational template.
- `apps/api/src/modules/publications/templates/publication-templates.test.ts`: semantic HTML coverage for both templates.
- `apps/web/src/studio/StudioEditor.tsx`: owns Copilot open state and exposes it to the layout.
- `apps/web/src/studio/StudioCopilot.tsx`: controlled visibility callback while retaining its existing local behavior.
- `apps/web/src/studio/studio.css`: adaptive canvas, multiline title, utility placement and responsive behavior.
- `apps/web/src/studio/StudioEditor.test.tsx`: editor layout state coverage.
- `apps/web/src/studio/StudioCopilot.test.tsx`: visibility callback coverage.

### Task 1: Canonical shared SOP parser

**Files:**
- Modify: `packages/shared/src/process-sop.ts`
- Create: `packages/shared/src/process-sop.test.ts`

- [ ] **Step 1: Write failing parser tests**

Add tests that call `parseProcessSopBody()` with objective, trigger, operational rule and three numbered steps. Assert step titles, instructions, expected results and attention points, including a legacy body without labels.

```ts
const parsed = parseProcessSopBody(`Objetivo: Padronizar vendas
Gatilho: Novo prospect
Regra operacional: Registrar tudo

1. Abrir registro
Instrução: Cadastre o prospect.
Resultado esperado: Registro criado.
Pontos de atenção:
- Não deixar no WhatsApp.

2. Definir retorno
Instrução: Registre data e responsável.`);

expect(parsed.steps.map((step) => step.title)).toEqual(["Abrir registro", "Definir retorno"]);
expect(parsed.steps[0]?.attentionPoints).toEqual(["Não deixar no WhatsApp."]);
```

- [ ] **Step 2: Confirm the tests fail**

Run: `pnpm --filter @prymeira/baase-shared test -- process-sop.test.ts`  
Expected: FAIL because `parseProcessSopBody` is not exported.

- [ ] **Step 3: Implement the parser**

Add `ParsedProcessSopBody` and `parseProcessSopBody(body)` beside the formatter. Normalize CRLF and accidental inline numbered steps, read the canonical labels case-insensitively, accumulate attention bullets, and use non-empty unlabelled lines as legacy step titles. Numbering must remain derived from array order, never copied into titles.

- [ ] **Step 4: Replace the private frontend parser**

Import `parseProcessSopBody` from `@prymeira/baase-shared` in `apps/web/src/App.tsx`, delete the duplicate `readLabeledValue`, `normalizeProcessBodyLines`, and `parseProcessBody` implementation, and adapt the two property names (`operationalRule` to the existing `rule` presentation if necessary).

- [ ] **Step 5: Run shared and web tests**

Run: `pnpm --filter @prymeira/baase-shared test -- process-sop.test.ts && pnpm --filter @prymeira/baase-web test -- App.test.tsx`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/process-sop.ts packages/shared/src/process-sop.test.ts apps/web/src/App.tsx
git commit -m "refactor: share SOP structure parser"
```

### Task 2: Rich Studio and structured SOP publication templates

**Files:**
- Create: `apps/api/src/modules/publications/templates/tiptap-html.ts`
- Create: `apps/api/src/modules/publications/templates/publication-templates.test.ts`
- Modify: `apps/api/src/modules/publications/templates/editorial.css.ts`
- Modify: `apps/api/src/modules/publications/templates/studio-sheet.ts`
- Modify: `apps/api/src/modules/publications/templates/process-sop.ts`

- [ ] **Step 1: Write failing semantic template tests**

Build a Studio document containing two paragraphs, an empty paragraph, a bullet list, bold, italic and link marks. Assert the HTML contains separate paragraphs, an empty spacer, `<ul>`, `<strong>`, `<em>` and a safe `<a>`. Build a process with two steps and assert `.sop-step-number` contains `1` and `2`, plus objective, result and attention blocks.

- [ ] **Step 2: Confirm the tests fail**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/publications/templates/publication-templates.test.ts`  
Expected: FAIL because rich JSON and structured SOP markup are not rendered.

- [ ] **Step 3: Implement the safe TipTap renderer**

Render only `doc`, `paragraph`, `heading` levels 2–3, `bulletList`, `orderedList`, `listItem`, `hardBreak`, and `text`. Render only `bold`, `italic`, and `link` marks. Escape all text and reject unsafe link protocols; unknown nodes contribute escaped textual descendants rather than HTML.

- [ ] **Step 4: Build the “Caderno do dono” template**

Use `bodyJson` when it is a valid TipTap document; otherwise call the legacy text renderer. Add compact metadata, restrained serif title, comfortable text measure, page numbering, and a secondary materials appendix. Keep content order identical to the editor.

- [ ] **Step 5: Build the structured SOP template**

Call `parseProcessSopBody(process.currentVersion.body)`. Render objective, trigger and rule as distinct summary cells; render steps from `parsed.steps.map((step, index) => ...)`, with green expected-result blocks and amber attention blocks. Use full borders/backgrounds rather than decorative side stripes.

- [ ] **Step 6: Add print CSS and pagination rules**

Add named template root classes, `break-inside: avoid` for the immediate step header/content group, stable footer page counters, balanced margins, and no fixed-height content regions. Keep materials and long steps splittable when necessary.

- [ ] **Step 7: Run API tests and typecheck**

Run: `pnpm --filter @prymeira/baase-api test -- src/modules/publications/templates/publication-templates.test.ts src/modules/publications/publication.service.test.ts && pnpm --filter @prymeira/baase-api typecheck`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/publications/templates
git commit -m "feat: render premium Studio and SOP publications"
```

### Task 3: Adaptive Studio writing canvas

**Files:**
- Modify: `apps/web/src/studio/StudioEditor.tsx`
- Modify: `apps/web/src/studio/StudioCopilot.tsx`
- Modify: `apps/web/src/studio/studio.css`
- Modify: `apps/web/src/studio/StudioEditor.test.tsx`
- Modify: `apps/web/src/studio/StudioCopilot.test.tsx`

- [ ] **Step 1: Write failing layout-state tests**

Assert `.studio-writing-layout` starts with `data-copilot-open="false"`, becomes `true` after “Abrir Copiloto”, and returns to `false` after “Recolher Copiloto”. Assert the title control uses the multiline title class and remains labelled.

- [ ] **Step 2: Confirm the tests fail**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioEditor.test.tsx src/studio/StudioCopilot.test.tsx`  
Expected: FAIL because the parent does not know Copilot visibility.

- [ ] **Step 3: Lift Copilot visibility to the writing layout**

Add `onOpenChange?(open: boolean): void` to `StudioCopilot`. Call it whenever opening, recollecting or closing the compact backdrop. In `StudioEditorSession`, store `copilotOpen` and set `data-copilot-open={copilotOpen}` on `.studio-writing-layout`.

- [ ] **Step 4: Make the title multiline without changing autosave semantics**

Replace the single-line title input with an autosizing textarea that keeps the same value, label, read-only state and `queueCurrent` handler. Size it from `scrollHeight` on value/layout changes and cap only at a sensible multi-line height.

- [ ] **Step 5: Implement the adaptive CSS**

Closed state: one grid column, editor and related context spanning the available width, menu and Copilot trigger aligned in the top utility area, editor outer width around `min(100%, 1120px)`, and prose measure around `76ch`. Open state: editor plus resizable Copilot column. Under 1200 px: keep the existing fixed/overlay Copilot behavior and never reserve a second column. Make header, toolbar, assets, related thoughts and dividers use the same outer width.

- [ ] **Step 6: Run focused web tests and accessibility coverage**

Run: `pnpm --filter @prymeira/baase-web test -- src/studio/StudioEditor.test.tsx src/studio/StudioCopilot.test.tsx src/studio/studio-accessibility.test.tsx && pnpm --filter @prymeira/baase-web typecheck`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/studio/StudioEditor.tsx apps/web/src/studio/StudioCopilot.tsx apps/web/src/studio/studio.css apps/web/src/studio/StudioEditor.test.tsx apps/web/src/studio/StudioCopilot.test.tsx
git commit -m "fix: expand Studio canvas when Copilot is closed"
```

### Task 4: End-to-end visual verification

**Files:**
- Modify only files from Tasks 1–3 if verification exposes defects.

- [ ] **Step 1: Run the complete verification set**

Run: `pnpm typecheck && pnpm test && pnpm build`  
Expected: all commands exit 0.

- [ ] **Step 2: Generate representative PDFs**

Use the publication renderer with the approved sample Studio sheet and the “Registrar e acompanhar oportunidade comercial” process. Save temporary PDFs below `tmp/pdfs/final-review/`; do not add them to Git.

- [ ] **Step 3: Render every PDF page to PNG**

Run: `pdftoppm -png -r 150 tmp/pdfs/final-review/studio-sheet.pdf tmp/pdfs/final-review/studio-sheet && pdftoppm -png -r 150 tmp/pdfs/final-review/process-sop.pdf tmp/pdfs/final-review/process-sop`  
Expected: one PNG per PDF page with no rendering errors.

- [ ] **Step 4: Inspect visual acceptance criteria**

Confirm preserved blank lines and lists, correct SOP numbering, readable semantic blocks, no orphaned step headings, no clipped title, no excessive dead space, and consistent footers/page numbers. Correct only concrete failures, then repeat Steps 1–3.

- [ ] **Step 5: Verify the live editor**

At desktop width, confirm the closed Copilot leaves no reserved right column; open it and confirm a stable two-column layout. At widths below 1200 px, confirm the Copilot overlays/recollects without reducing the writing canvas.

- [ ] **Step 6: Commit verification fixes if any**

```bash
git add packages/shared apps/api/src/modules/publications apps/web/src/studio
git commit -m "test: verify premium publication layouts"
```

Do not create an empty commit when verification requires no changes.

## Self-review

- Spec coverage: rich Studio fidelity, legacy fallback, adaptive editor, multiline title, structured SOP semantics, numbering, print pagination, responsive Copilot and visual QA are each assigned to a task.
- Placeholder scan: no deferred implementation markers remain.
- Type consistency: `parseProcessSopBody`, `onOpenChange`, `bodyJson`, `bodyText`, and the existing publication inputs retain one name across tasks.
