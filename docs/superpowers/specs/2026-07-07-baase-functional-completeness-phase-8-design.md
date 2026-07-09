# Baase Functional Completeness Phase 8 Design

## Goal

Turn the current internal React shell into a more testable product surface by wiring visible controls that are currently passive: topbar actions, map area creation, invite link copy, template actions, create-with-AI modes, side-list selection, and process-change communication.

## Scope

This phase focuses on the web product layer and reuses the API modules that already exist. It does not add Clerk authentication, production storage, deployment automation, or the final normalized company-map backend. Those remain later phases.

## User Experience

- Every primary button visible in the main internal pages should either perform a useful action, open the correct modal, navigate to the right flow, or show a clear in-app notice.
- Side-list cards in Processos, Rotinas, Treinamentos, and Comunicados should select their detail item instead of being inert.
- The owner should be able to create an area from Mapa da Empresa, copy the current invite link, use/adapt templates, choose what kind of content AI should create, and create a draft comunicado from a process change.
- The UI should preserve the existing calm, minimal visual language.

## Architecture

- Keep the single-file React shell for this phase to avoid a risky refactor while product behavior is still moving quickly.
- Add small view-state primitives in `App.tsx`: notices, selected item IDs/indices, create-with-AI mode, template actions, and area modal state.
- Reuse existing API helpers where possible: `createArea`, `createProcessDraft`, `createRoutine`, `createTrainingDraft`, `createAnnouncementDraft`, and publish/assign helpers.
- Add targeted tests in `App.test.tsx` before implementation to lock the expected flows.

## Data Flow

- `CompanyMap` opens a new area modal. Saving calls `/api/areas`, stores the created area in local view state, and shows it in the map immediately.
- `TeamPage` copies a deterministic invite link/code and shows a notice so the user gets feedback even when clipboard access is unavailable.
- `TemplatesPage` exposes typed templates. `Usar` creates the corresponding draft/active content through existing APIs. `Adaptar` opens Criar com IA with a prefilled prompt.
- `CreateWithAiPage` owns only text input and mode selection. The parent performs the correct API action based on the selected mode.
- `ProcessesPage` can create a process-change announcement draft from the selected process and route the user to Comunicados.

## Error Handling

- Existing `runAction` continues to centralize busy/error state.
- New actions display concise notices for successful local actions such as clipboard copy or mode changes.
- API failures should keep the current `apiStatus="error"` behavior and avoid closing the user’s current context prematurely.

## Testing

Add web tests for:

- Search and notification buttons opening useful panels.
- Creating an area from Mapa da Empresa.
- Copying the invite link.
- Selecting a side-list process card.
- Using and adapting templates.
- Creating non-process AI content from Criar com IA.
- Creating a comunicado draft from “Comunicar mudança”.

## Self Review

- No placeholders remain in this spec.
- Scope intentionally excludes auth/deploy/storage.
- The design keeps the existing app style and API patterns.
