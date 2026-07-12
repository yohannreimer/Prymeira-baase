# Team invitations through Prymeira Account

## Goal

Make Team use the production invitation flow: an owner invites a person by email through Prymeira Account, and the person becomes a Baase member when they authenticate with that email.

## Product decisions

- Email invitation is the only invitation entry point in account mode.
- Workspace links, invite codes, preview, and local acceptance are legacy demo flows and are not displayed in account mode.
- The team screen lists pending email invitations with their status and a revoke action.
- Primary area is the organizational home of the person and determines which role templates can be selected.
- Access reach is the content boundary, not a second independent permission system:
  - Assigned only: only content explicitly assigned to the person.
  - Primary area: content from the selected primary area.
  - Specific areas: content from selected areas; the primary area is always included.
  - Entire company: all workspace content.
- The specific-area picker is visible only when that reach is selected. It uses full-width, stable selectable rows.
- Existing API values remain `assigned_only`, `area`, and `workspace`. The UI maps primary-area access to `area` with only the primary area selected.

## Data flow

1. Owner fills name, email, role, primary area, role template, and access reach.
2. The web app posts the existing invite payload to Baase.
3. In account mode, Baase forwards the email to the Account Hub and stores the operational invite metadata.
4. Account Hub handles sign-in or account creation for that email.
5. On the first authenticated Baase request, the operational membership service accepts the matching pending invite and applies its role, area, role template, and access scope.

## Error handling

- The form requires an email, a primary area for non-owners, and a role template only when one exists for that area.
- Specific-area reach requires at least one selected area.
- API errors remain visible through the existing action error surface.
- A pending invite can be revoked from the team screen; accepted members are managed through the existing person editor.

## Out of scope

- A manual invite-code acceptance UI.
- A separate email delivery implementation in Baase; that responsibility remains with Prymeira Account.
- Changing the persisted membership or invitation contract.
