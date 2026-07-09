# Baase Strong Operational AI Phase 11 Design

## Goal

Make the main AI creation flow operationally real for audio, text, and document inputs. The owner should be able to record or attach material, generate a structured draft, review it in the existing product screens, edit it, and publish it through the existing CRUD flows.

## Scope

Phase 11 covers:

- Audio in `Criar com IA` transcribed through the existing transcription harness and appended to the AI request.
- Text and PDF/material attachments sent to `/ai/drafts`.
- Backend extraction of text attachments and PDF files before the structured AI run.
- Generated AI suggestions saved as normal draft content: process, routine, training, or announcement.
- Template adaptation using the same AI draft pipeline.

Out of scope for this phase:

- Persistent file storage for original audio/PDF files.
- Clerk production auth.
- Long-term AI eval dashboards.
- Multi-file document libraries.

## Backend Design

`POST /ai/drafts` accepts optional `attachments`. Each attachment includes `name`, `mime_type`, and `content_base64`. The route extracts textual content before calling the AI harness:

- `text/plain`, `text/markdown`, `.txt`, and `.md` decode directly as UTF-8.
- `application/pdf` and `.pdf` use `pdf-parse` to extract text.
- Empty extracted content is rejected with a validation error.
- The provider receives `{ text, attachments, context }`, so both mock and OpenAI providers have the same structured input contract.

## Frontend Design

`CreateWithAiPage` gains a real operational input state:

- `inputMode`: `text`, `audio`, `pdf`, or `mixed`.
- `attachments`: files converted to base64 and sent with the draft request.
- Audio button toggles recording, transcribes via `/api/ai/transcriptions`, and appends the transcript to the prompt.
- Material button opens a file picker for PDF/text material and displays the selected file before generation.

Generation continues to create actual draft records in existing screens. The owner can edit and publish through current process, routine, training, and announcement forms.

## Error Handling

- Unsupported microphone browsers show an inline status and keep the text path available.
- Empty audio transcripts do not generate drafts.
- Empty or unsupported files are rejected before generation.
- Backend extraction failures return validation-style errors instead of silently sending unusable content to the model.

## Testing

- API route test proves attachments are extracted and passed into the AI provider.
- API client test proves `generateAiDraft` serializes attachments and `input_mode`.
- UI tests prove material upload and audio transcription feed the draft flow.
- Full `pnpm test`, `pnpm typecheck`, and `pnpm build` must pass.
