# Studio Multimodal Document Materials Design

**Date:** 2026-07-15

## Problem

The Owner Studio is designed around one living, multimodal document. A capture
may begin as text, audio, a file, an image, or a link, and the owner should be
able to keep developing the same document with additional materials.

The current home composer can create a document with text and one initial
material. After the document opens, the owner can edit its body and inspect the
initial material, but cannot attach another recording, file, image, or captured
link. Audio transcription is displayed as read-only processing output and
cannot be deliberately copied into the editable document body.

This makes the first capture behave like a terminal input rather than the start
of a notebook. It also makes an inline hyperlink look deceptively similar to a
captured link asset even though only the latter is preserved and processed as a
source.

## Goals

- Let one Studio document accumulate multiple private materials over time.
- Add audio recording, file, image, and captured-link controls to an open
  document without making the writing surface heavy.
- Preserve every original asset and its extracted text.
- Let the owner explicitly copy a completed audio transcript into the editable
  document body at the last editor selection.
- Reuse the existing owner-scoped asset API, atomic upload behavior, processing
  queue, and autosave/version history.
- Keep writing available when a material upload or processing operation fails.

## Non-goals

- Embedding interactive asset nodes inside TipTap document JSON.
- Automatically inserting or rewriting the document body after transcription.
- Editing or overwriting the processor's original extracted text.
- Batch upload, drag-and-drop, asset reordering, or asset deletion in this
  increment.
- Changing asset visibility, owner isolation, storage limits, or AI permissions.

## Experience

### Initial capture

The Mesa tranquila universal composer keeps its current role. Text creates a
document immediately. Recording, file, image, or captured link creates the same
document and associates one initial material. Text entered before selecting a
material remains the initial document body, and the capture mode is `mixed`.

The resulting document opens immediately. A server-owned upload may continue
after navigation, and a lost response remains safely retryable through the
existing idempotency contract.

### Open document

The Caderno aberto keeps the following vertical order:

1. title, structures, save state, and version history;
2. formatting toolbar and rich-text body;
3. a quiet `Adicionar material` bar;
4. the document's chronological material cards;
5. related thoughts and the optional copilot surface.

The material bar exposes four explicit actions:

- `Gravar áudio` / `Parar gravação`;
- `Adicionar arquivo`;
- `Adicionar imagem`;
- `Capturar link`.

Only one local material operation runs at a time. The owner may continue typing
while an upload or link capture is running. Each completed attachment is added
to the document's material list without requiring the document to be reopened.

The rich-text toolbar keeps its inline-link action, described accessibly as
formatting a hyperlink. The material bar calls its separate action `Capturar
link`, making the persistence and processing difference explicit.

### Audio and transcript

An audio material card preserves and exposes the original private recording
through the existing signed download URL. Processing state remains visible and
retryable.

When transcription is ready and non-empty, the card shows `Adicionar
transcrição ao documento`. The transcript is not injected automatically.
Activating the action copies the extracted text into the editor:

- at the last valid editor selection when one exists;
- at the end of the document when the editor has never held a selection or the
  saved selection is no longer valid.

The insertion uses paragraph boundaries so it does not merge unexpectedly with
adjacent words. It focuses the editor, queues the normal autosave, and therefore
creates the same version history as owner-authored edits. The original audio and
processor transcript remain unchanged. Repeating the explicit action is allowed
because the owner may intentionally reuse a transcript; duplicate clicks while
one insertion is being handled are suppressed.

## Component Design

### Shared audio recorder

Extract browser microphone acquisition, `MediaRecorder` lifecycle, chunk
assembly, fallback file picker behavior, and cleanup into a focused reusable
audio recorder unit. Both the home universal composer and the open-document
material composer use this unit so permission, recording, stop, failure, and
unmount behavior stay identical.

The recorder returns a `Blob` and generated filename. It does not know about
documents, APIs, or asset state.

### StudioMaterialComposer

`StudioMaterialComposer` owns the open-document material controls and the
single pending operation. It receives the current document ID and reports an
attached `StudioAsset` to its parent.

It reuses `attachStudioFile` and `attachStudioLink`. Every new operation gets a
stable idempotency key that is reused for retry. A failed operation remains in
the composer with `Tentar novamente` and `Descartar`; retries do not create a
new asset intent.

### StudioPage material state

`StudioPage` remains the owner of the active document's material collection.
It appends or replaces a newly returned asset by ID, keeps the existing list
request for route restoration, and passes the collection to material cards.
Results from an obsolete document or aborted local request cannot update the
newly selected document.

### StudioEditor insertion boundary

`StudioEditor` exposes a narrow imperative operation through a typed ref:
`insertTextAtLastSelection(text)`. No asset API or processing state enters the
editor.

The editor records the last valid TipTap selection during selection updates.
The insertion validates the saved positions against the current document,
falls back to the end, inserts paragraph-safe text, focuses the editor, and uses
the existing `onUpdate`/autosave path. The editor is the only component allowed
to mutate rich document JSON.

### Material cards

`StudioAssetProcessingStatus` retains download, player, polling, retry, and
processing messages. For a ready audio asset with extracted text, it receives
an insertion callback and renders the transcript action. The card reports a
quiet confirmation after insertion and prevents concurrent activation.

## Data and Security

The current document-to-assets relation already supports multiple assets, and
the existing routes already authorize uploads, link capture, polling, retry,
download, and listing by full owner scope. No database migration or new storage
object type is required.

Every attachment remains owner-private, stored under its current owner-scoped
object key, and accessed through a short-lived signed URL. Captured links retain
the existing SSRF, redirect, size, and timeout protections. Telemetry records
modality and status only; it never records text, transcripts, URLs, or file
contents.

Copying a transcript into the body does not delete or mutate the asset. AI and
search may use the authoritative asset extraction and the owner-edited body;
the UI identifies the inserted body text as a copy, not as a replacement for
the source.

## Failure and Concurrency Behavior

- Microphone denial or unsupported recording falls back to selecting an audio
  file and explains the fallback without losing typed text.
- Local recording is stopped and media tracks are released on document change
  or unmount.
- Once an atomic upload is accepted by the server, client navigation does not
  attempt to cancel server-owned completion.
- Upload/link failure never changes document text or removes prior materials.
- Retry reuses the same document, material input, and idempotency key.
- Discard clears only the failed local attempt.
- Asset processing failure keeps the original available and retains the current
  processing retry action.
- Material list refresh failure keeps already known assets visible and offers a
  list retry.
- Transcript insertion is disabled until extraction is ready and non-empty.
- Selection positions are validated at insertion time so autosave updates or
  restored versions cannot produce an invalid editor transaction.

## Accessibility and Quiet Ops

All material actions have visible labels or accessible names, keyboard support,
focus restoration after link mode, and polite status announcements. Recording
uses both text/icon state and `aria-pressed`; color is never the only signal.

The material bar is visually secondary to writing. It uses existing Studio
spacing, borders, typography, tokens, and motion. It does not introduce a
sidebar, dashboard card grid, modal wizard, progress score, or attention-heavy
success animation.

## Testing

Frontend unit and integration tests cover:

- the shared recorder's permission, start, stop, empty recording, fallback,
  failure, and unmount cleanup;
- unchanged home capture behavior after recorder extraction;
- file, image, audio, and link attachment to an existing document;
- retry and discard with a stable idempotency key;
- immediate material-list update and protection against stale document results;
- several materials in one document;
- transcript action visibility only for ready non-empty audio;
- insertion at the last selection and fallback insertion at document end;
- paragraph-safe insertion, focus, autosave, and version-compatible update;
- repeated-click suppression and accessible announcements;
- distinction between inline hyperlink formatting and captured-link material.

Existing API asset route, storage, polling, and isolation suites remain part of
the regression run. Verification requires web and API typechecks, focused
Studio tests, complete web and API test suites, a production build, diff checks,
and a local browser walkthrough of recording, attachment, processing state, and
transcript insertion.
