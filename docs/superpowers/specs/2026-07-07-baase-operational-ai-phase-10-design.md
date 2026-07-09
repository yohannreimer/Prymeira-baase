# Baase Operational AI Phase 10 Design

## Goal

Make the Baase AI feel operational inside the product, not just decorative. Phase 10 connects the internal AI harness to the owner workflow and adds proactive suggestions based on concrete workspace signals.

## Scope

This phase implements:

- real `Criar com IA` draft generation through `/ai/drafts` for process, routine, training, and announcement;
- proactive AI suggestions from operational signals:
  - area without an active routine;
  - role/cargo without a published or assigned training;
  - process still in draft;
  - tasks awaiting approval or late;
- owner dashboard rendering those suggestions with action labels and destinations;
- API/web tests proving suggestions are generated from real data.

Out of scope:

- autonomous publishing;
- background cron delivery;
- comments summarization, because contextual comments are not yet a persisted module;
- provider eval dashboards.

## Product Rules

- AI creates suggestions or drafts only.
- Human review remains required before anything reaches employees.
- Proactive suggestions must cite the operational reason.
- Employees do not see owner-level proactive suggestions in V1.

## Backend

Add a small proactive signal scanner under the AI module. It reads existing repositories and returns structured suggestions. It is deterministic for now, which keeps it reliable in pilot testing and avoids calling a model every time the owner opens the dashboard.

`POST /ai/drafts` gains `type: "announcement"` with an announcement schema and prompt. `GET /ai/proactive-suggestions` returns owner/manager suggestions.

## Frontend

`loadBaaseWorkspace` includes proactive suggestions for owner/manager roles. The owner dashboard replaces static AI suggestions with API-backed suggestions, falling back to demo copy only when there is no API data.

`Criar com IA` calls `/api/ai/drafts`, maps the returned structured draft into the current CRUD endpoints, and still creates only draft/reviewable content.

## Testing

- API tests cover announcement draft generation and proactive suggestions from real repository state.
- Web API tests cover loading suggestions and calling `/ai/drafts`.
- App tests cover dashboard suggestions and real AI draft use from the UI.

## Self Review

- The phase is scoped to AI behavior already supported by the current app.
- It does not introduce chat or background automation.
- It keeps the central guardrail: AI suggests, human approves.
