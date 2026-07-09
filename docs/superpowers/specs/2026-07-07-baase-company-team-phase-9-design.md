# Baase Company Team Phase 9 Design

## Goal

Make Mapa da Empresa and Equipe use real API data instead of static fallback as the primary experience. Owners and managers should be able to create areas, roles, people, invites, and accept an invite code into an operational profile.

## Scope

This phase focuses on the company/team domain. It keeps the current local header auth model and does not add Clerk validation, billing/account checks, production file storage, or a public landing/login flow.

## User Experience

- Mapa da Empresa loads areas, role templates, and people from the API.
- Each area card shows real roles and real people assigned to that area.
- The owner can create an area, role/cargo, person, and invite from the internal UI.
- The invite form uses existing areas and roles in selectors instead of raw IDs.
- Equipe shows real people and pending invites.
- A lightweight invite acceptance panel lets a user paste a code/link, preview the invite, and accept it into the workspace. This simulates the future Clerk-backed flow while staying testable locally.

## Backend

- Extend `CompanyRepository` with invite lookup/update by code.
- Add `GET /invites/:code` to preview a pending invite.
- Add `POST /invites/:code/accept` to create a `TeamMember` from the invite and mark the invite as accepted.
- Keep workspace isolation for internal list/create routes.
- Invite acceptance is intentionally local/pilot-friendly. Later Clerk integration will replace the simulated accepter identity.

## Frontend

- Extend `loadBaaseWorkspace` to include `areas`, `role_templates`, `people`, and `invites`.
- Add API helpers for `createRoleTemplate`, `createPerson`, `getInviteByCode`, and `acceptInvite`.
- Update Mapa and Equipe to render loaded company structure.
- Add forms for new role/cargo and new person.
- Add invite preview/accept flow on Equipe.

## Testing

- Backend route tests cover invite preview, invite acceptance, accepted invite reuse, and member creation.
- Web API tests cover the extended workspace bundle and new company helpers.
- Web UI tests cover real map rendering, creating a role/person with selects, and accepting an invite code.

## Self Review

- Scope is limited to company/team behavior.
- Auth remains explicitly local/header-based for this phase.
- No placeholders or production-only assumptions remain.
