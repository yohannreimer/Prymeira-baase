# Baase Template Library Phase 12 Design

## Goal

Turn the model library into a real operational catalog. The owner should be able to filter templates by segment, area, and type, use a template to create real process/routine/training content, or adapt a template with AI using the company's context.

## Scope

Phase 12 covers:

- Curated templates for processes, routines, and trainings.
- Template metadata by segment, area, type, category, tags, icon, and recommended prompt.
- `GET /templates` with filters for segment, area, and kind.
- `POST /templates/:id/use` to create real content through the existing process, routine, and training services.
- Web API client helpers for loading and using templates.
- The model library screen using API templates instead of hardcoded frontend templates.
- “Adaptar” opening `Criar com IA` with the template context preserved for the draft request.

Out of scope:

- User-created custom template marketplace.
- Paid template packs.
- Persistent template editing.
- Template analytics.

## Backend Design

Templates live in a focused catalog module:

- `template.types.ts` defines the curated template contract.
- `template-library.ts` contains curated templates and filter helpers.
- `template.routes.ts` exposes list/use endpoints and calls existing services to create content.

Using a template creates reviewable content:

- Process templates create draft processes.
- Routine templates create active routines with checklist templates.
- Training templates create draft trainings with lesson material and quiz.

This avoids duplicating process/routine/training creation logic and keeps permissions consistent with the company base.

## Frontend Design

The web bundle includes templates for owner/manager roles. The template page renders:

- Segment filter.
- Area filter.
- Type filter.
- Cards from the API catalog.

`Usar` calls the template use endpoint and appends the returned content to the current local workspace state. `Adaptar` sends the owner to `Criar com IA` with a prefilled prompt and a template context object, so generation uses the same harness as Phase 11.

## Error Handling

- Unknown template IDs return `404`.
- Employees cannot use templates.
- Empty filters return the full curated catalog.
- If a template use call fails, the existing app action state shows the API error status.

## Testing

- API route tests cover filtering and using all supported content kinds.
- Web API tests cover loading templates and using a template.
- UI tests cover filter rendering, using a backend template, and adapting a backend template with context.
- Full `pnpm test`, `pnpm typecheck`, and `pnpm build` must pass.
