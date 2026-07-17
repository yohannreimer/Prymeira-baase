# Owner Studio — Continuous Rituals QA

## Acceptance coverage

- Daily / `record_only`: three answers complete without automatic preparation or synthesis; completion offers an intentional `Aprofundar com IA`; answers remain in dated history.
- Weekly / `light_summary`: original answers remain visible and the AI summary appears in a separate section without action-like suggestions.
- Monthly / `guided_reflection`: the AI reflection is separate, limited to three visible thinking points, and has no fake pending status.
- Support-mode changes apply only to future sessions; historical sessions retain their snapshotted mode.
- Human answer saves use `answer_revision`; background AI work uses the internal session revision and cannot manufacture an answer conflict.
- A genuinely stale answer revision continues to preserve the local draft and asks the owner which answer version to keep.

## Automated checks

- Shared structure contract and Studio API schemas.
- Migration 32 and in-memory/Postgres repository behavior.
- Ritual service races, record-only zero-AI completion, and intentional post-completion analysis.
- Ritual builder, detail, history, completion, offline draft, retry, and stale-answer UI behavior.
- Playwright acceptance for daily, weekly, and monthly support modes.

## Manual visual checklist

- Desktop: detail hierarchy, answer/AI separation, timeline readability, calm completion state.
- Narrow viewport: support-mode controls stack; completion sections and answer text wrap without horizontal overflow.
- Copy: no `Pendente` badge, no generic `Conflito entre abas`, and no claim that AI content changed the owner's original answers.
