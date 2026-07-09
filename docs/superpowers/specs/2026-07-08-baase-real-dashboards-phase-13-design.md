# Baase Real Dashboards Phase 13 Design

## Goal

Turn the owner, manager, and employee panels into real operational dashboards driven by backend data instead of hardcoded counts.

## Scope

- Add a backend dashboard endpoint that aggregates execution, delays, pending approvals, pending trainings, and incomplete processes.
- Keep proactive AI suggestions powered by the same operational repositories.
- Load dashboard data in the web workspace bundle.
- Replace owner and manager metric cards with real values when API data exists.
- Keep employee experience focused on Today, with tasks, training, and communication pendencies remaining the primary surface.

## Backend Design

Create a `dashboard` module with a small service and route:

- `GET /dashboard?date=YYYY-MM-DD`
- Reads request context from the existing local auth headers.
- Uses existing repositories: company, processes, routines, trainings.
- Computes metrics from persisted entities:
  - `todayTotal`
  - `todayCompleted`
  - `executionRate`
  - `lateTasks`
  - `awaitingApproval`
  - `pendingTrainingAssignments`
  - `incompleteProcesses`
- Builds `areaMetrics` by routine area.
- Builds `attentionItems` from the same signals used by the product: late tasks, approval backlog, pending trainings, and draft processes.

## Web Design

Extend `loadBaaseWorkspace` to fetch `/api/dashboard?date=...` in parallel with the existing bundle. The dashboard is optional so old mocks and offline demo mode still render.

Owner dashboard uses real metrics and attention cards when available. Manager dashboard uses real metric cards while keeping the current approval workflow. Employee Today keeps the task-first mobile/web experience and can read summary numbers from dashboard later without changing the main flow.

## Testing

- Backend route tests verify real metric aggregation and role-safe access.
- Web API tests verify dashboard is loaded into the bundle.
- App tests verify owner dashboard renders backend metrics.
- Full `pnpm test`, `pnpm typecheck`, and `pnpm build` must pass.

