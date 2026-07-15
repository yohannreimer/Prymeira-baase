# Studio Multimodal Document Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an open Owner Studio document accumulate audio, files, images, and captured links, and let the owner explicitly insert a ready transcript into the editable body at the last cursor selection.

**Architecture:** Extract the existing browser recording lifecycle into a reusable component, add a document-scoped material composer that reuses the private asset APIs, and keep active assets in `StudioPage`. Expose one typed insertion command from the TipTap editor so material cards can copy transcript text without learning editor internals or mutating the preserved asset.

**Tech Stack:** React 19, TypeScript 5.8, TipTap, Vite 7, Testing Library, Vitest, existing Fastify Studio asset API, existing Baase design tokens

---

## File Structure

- Create `apps/web/src/studio/StudioAudioRecorder.tsx`: own microphone/file-fallback lifecycle and emit one audio blob.
- Create `apps/web/src/studio/StudioAudioRecorder.test.tsx`: cover permission, recording terminal states, fallback, and cleanup.
- Modify `apps/web/src/studio/UniversalCaptureComposer.tsx`: consume the shared recorder and remove duplicated media lifecycle.
- Modify `apps/web/src/studio/UniversalCaptureComposer.test.tsx`: preserve home-capture integration and stable retry behavior.
- Create `apps/web/src/studio/StudioMaterialComposer.tsx`: attach audio, file, image, or captured link to an existing document with retry/discard.
- Create `apps/web/src/studio/StudioMaterialComposer.test.tsx`: cover all modalities, stable idempotency, concurrency, and accessible states.
- Modify `apps/web/src/studio/StudioEditor.tsx`: place the document material region between writing and context, expose the narrow transcript insertion handle, and clarify inline-link labeling.
- Modify `apps/web/src/studio/StudioEditor.test.tsx`: cover material-region reading order, selection insertion, end fallback, paragraphs, focus, and autosave.
- Modify `apps/web/src/studio/StudioAssetProcessingStatus.tsx`: expose the explicit transcript-copy action.
- Modify `apps/web/src/studio/StudioAssetProcessingStatus.test.tsx`: protect action visibility and repeated-click suppression.
- Modify `apps/web/src/studio/StudioPage.tsx`: compose editor/material controls/cards and merge newly attached assets safely.
- Modify `apps/web/src/studio/StudioPage.test.tsx`: prove several materials remain on one document and stale results cannot cross documents.
- Modify `apps/web/src/studio/studio.css`: add quiet-ops material bar, retry, responsive, focus, and coarse-pointer states.
- Modify `apps/web/src/studio/studio-accessibility.test.tsx`: enforce labels and interaction semantics.

### Task 1: Extract the shared audio recorder

**Files:**
- Create: `apps/web/src/studio/StudioAudioRecorder.tsx`
- Create: `apps/web/src/studio/StudioAudioRecorder.test.tsx`
- Modify: `apps/web/src/studio/UniversalCaptureComposer.tsx`
- Test: `apps/web/src/studio/UniversalCaptureComposer.test.tsx`

- [ ] **Step 1: Write failing shared-recorder tests**

Create tests around this public contract:

```tsx
export type StudioRecordedAudio = { blob: Blob; filename: string };

export type StudioAudioRecorderProps = {
  disabled?: boolean;
  variant?: "icon" | "label";
  inputTestId?: string;
  onCaptured(audio: StudioRecordedAudio): void;
  onStatus(message: string): void;
};
```

Cover:

```tsx
render(<StudioAudioRecorder variant="label" onCaptured={onCaptured} onStatus={onStatus} />);
await user.click(screen.getByRole("button", { name: "Gravar áudio" }));
expect(screen.getByRole("button", { name: "Parar gravação" })).toHaveAttribute("aria-pressed", "true");

await user.click(screen.getByRole("button", { name: "Parar gravação" }));
recorders[0]!.emit("dataavailable", new Blob(["audio"]));
recorders[0]!.emit("stop");
expect(onCaptured).toHaveBeenCalledWith(expect.objectContaining({
  blob: expect.any(Blob),
  filename: expect.stringMatching(/^registro-.+\.webm$/u)
}));
```

Also assert: unsupported MediaRecorder opens the hidden audio input; a selected
audio file is emitted unchanged; double stop does not reacquire; empty recording
reports an error; denied permission reports the fallback message; unmount stops
tracks; a late permission grant after unmount is released; recorder construction,
start, and error terminal races cannot leak or emit obsolete audio.

- [ ] **Step 2: Run the new test and observe the missing module**

Run:

```bash
pnpm --filter @prymeira/baase-web test -- src/studio/StudioAudioRecorder.test.tsx
```

Expected: FAIL because `StudioAudioRecorder.tsx` does not exist.

- [ ] **Step 3: Implement the recorder as a focused component**

Move `RecordingSession`, the acquisition guard, terminal guard, `releaseRecording`,
recording event wiring, and fallback audio input out of the universal composer.
The component renders one button and one hidden `accept="audio/*"` input. It owns
no document IDs, APIs, or idempotency keys.

The terminal success path must emit:

```ts
const type = recorder.mimeType || "audio/webm";
const blob = new Blob(session.chunks, { type });
const extension = type.includes("mp4") ? "m4a" : "webm";
onCaptured({
  blob,
  filename: `registro-${new Date().toISOString().replaceAll(":", "-")}.${extension}`
});
```

The button uses `aria-pressed`, switches accessible name between `Gravar áudio`
and `Parar gravação`, and renders visible text only for the `label` variant.

- [ ] **Step 4: Replace home recorder internals with the shared component**

Render:

```tsx
<StudioAudioRecorder
  variant="icon"
  inputTestId="studio-audio-input"
  disabled={saving || Boolean(retryAttachment)}
  onStatus={setMessage}
  onCaptured={({ blob, filename }) => void capture({
    mode: "audio",
    captureKey: globalThis.crypto.randomUUID(),
    bodyText: text.trim(),
    title: "Registro em áudio",
    file: blob,
    filename,
    idempotencyKey: globalThis.crypto.randomUUID()
  })}
/>
```

Remove the duplicated recorder refs/effects/input from
`UniversalCaptureComposer`, while retaining document/attachment retry logic.

- [ ] **Step 5: Run recorder and home composer tests**

Run:

```bash
pnpm --filter @prymeira/baase-web test -- \
  src/studio/StudioAudioRecorder.test.tsx \
  src/studio/UniversalCaptureComposer.test.tsx
```

Expected: PASS with the existing home capture, retry, detached upload, and
keyboard behavior unchanged.

- [ ] **Step 6: Commit the shared recorder**

```bash
git add apps/web/src/studio/StudioAudioRecorder.tsx \
  apps/web/src/studio/StudioAudioRecorder.test.tsx \
  apps/web/src/studio/UniversalCaptureComposer.tsx \
  apps/web/src/studio/UniversalCaptureComposer.test.tsx
git commit -m "refactor: share studio audio recording"
```

### Task 2: Attach materials to an existing document

**Files:**
- Create: `apps/web/src/studio/StudioMaterialComposer.tsx`
- Create: `apps/web/src/studio/StudioMaterialComposer.test.tsx`

- [ ] **Step 1: Write failing material-composer tests**

Define injectable API types and this component contract:

```tsx
type StudioMaterialComposerProps = {
  documentId: string;
  onAttached(asset: StudioAsset): void;
  attachFile?: typeof attachStudioFile;
  attachLink?: typeof attachStudioLink;
};
```

Assert that file and image inputs, the shared recorder, and captured-link form
all call the existing API with `documentId` and a UUID idempotency key, then call
`onAttached` with the returned asset. The visible actions must be exactly
`Gravar áudio`, `Adicionar arquivo`, `Adicionar imagem`, and `Capturar link`.

For retry, make the first `attachFile` reject and the second resolve:

```tsx
await user.upload(fileInput, file);
expect(await screen.findByRole("alert")).toHaveTextContent("não foi adicionado");
await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
expect(attachFile.mock.calls[1]?.[3]).toBe(attachFile.mock.calls[0]?.[3]);
expect(onAttached).toHaveBeenCalledTimes(1);
```

Assert `Descartar` clears only the pending failed material. Double activation
while busy sends one request. Typing outside the composer remains enabled. Link
mode validates public HTTP(S), restores focus on close, and uses `Capturar link`
rather than the editor's inline hyperlink wording.

- [ ] **Step 2: Run the test and observe the missing component**

Run:

```bash
pnpm --filter @prymeira/baase-web test -- src/studio/StudioMaterialComposer.test.tsx
```

Expected: FAIL because `StudioMaterialComposer.tsx` does not exist.

- [ ] **Step 3: Implement the single-operation composer**

Use a discriminated pending input:

```ts
type PendingMaterial =
  | { kind: "audio" | "file" | "image"; file: Blob; filename: string; idempotencyKey: string }
  | { kind: "link"; url: string; idempotencyKey: string };
```

`submitMaterial` sets a synchronous `busyRef` before awaiting, calls the matching
API without aborting server-owned upload work on unmount, and updates React state
only while mounted. A rejected operation retains the exact `PendingMaterial` for
retry. Success clears it and calls `onAttached`. `Discard` clears the failed input
and status only.

Render the material actions below a small `Adicionar material` label. File inputs
remain hidden, image input uses `accept="image/*"`, and the shared audio recorder
uses its `label` variant.

- [ ] **Step 4: Run material composer tests and typecheck**

Run:

```bash
pnpm --filter @prymeira/baase-web test -- src/studio/StudioMaterialComposer.test.tsx
pnpm --filter @prymeira/baase-web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the document material composer**

```bash
git add apps/web/src/studio/StudioMaterialComposer.tsx \
  apps/web/src/studio/StudioMaterialComposer.test.tsx
git commit -m "feat: add studio document materials"
```

### Task 3: Integrate material state into the open document

**Files:**
- Modify: `apps/web/src/studio/StudioPage.tsx`
- Test: `apps/web/src/studio/StudioPage.test.tsx`
- Modify: `apps/web/src/studio/StudioEditor.tsx`
- Test: `apps/web/src/studio/StudioEditor.test.tsx`

- [ ] **Step 1: Write failing open-document integration tests**

Open one document with an existing audio asset, then attach a file through the
new material bar. Assert both cards remain visible without reopening or issuing
a second asset-list request. Attach another image and assert three distinct
materials appear under the same document heading.

Add a race test: defer document A's asset list, move to document B, attach a B
asset, then resolve A. Assert no A asset appears under B and B's attached asset
remains visible.

Add a same-document race: start the initial list request, attach a new material,
then resolve the old list response. Assert the merge retains both the listed and
new asset, keyed by asset ID.

Render `StudioEditor` with a labeled material-region fixture and assert DOM
reading order is: editable document body, material region, related thoughts,
then Copilot. This protects the approved composition instead of allowing the
material controls to fall below the entire writing layout.

- [ ] **Step 2: Run the page test and observe the missing material bar**

Run:

```bash
pnpm --filter @prymeira/baase-web test -- src/studio/StudioPage.test.tsx
```

Expected: FAIL because open documents render cards but no material composer.

- [ ] **Step 3: Add stable asset merging and composer placement**

Create a pure helper in `StudioPage.tsx`:

```ts
function mergeAssets(current: StudioAsset[], incoming: StudioAsset[]): StudioAsset[] {
  const byId = new Map(current.map((asset) => [asset.id, asset]));
  for (const asset of incoming) byId.set(asset.id, asset);
  return [...byId.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
```

When list loading resolves, merge instead of replacing. When
`StudioMaterialComposer` reports an asset, update only if `selectedDocumentId`
still matches the asset document ID.

Add an optional composition slot to the editor:

```tsx
type StudioEditorProps = {
  // existing props
  materialRegion?: ReactNode;
};
```

Render `materialRegion` inside `<article className="studio-editor">`, immediately
after the editable body and document notices but before the article closes.
Keep `RelatedThoughts` and `StudioCopilot` after that article, as they are now.
This gives the exact order writing -> materials -> context/copilot without
moving asset loading, attachment APIs, or asset state into the editor.

In `StudioPage`, build `DocumentAssets` with the current document ID, composer,
and material cards, then pass it as `materialRegion` to `StudioEditor`. Remove
the old sibling `DocumentAssets` rendered after the whole editor layout.

- [ ] **Step 4: Run page, API-client, and asset tests**

Run:

```bash
pnpm --filter @prymeira/baase-web test -- \
  src/studio/StudioPage.test.tsx \
  src/studio/StudioEditor.test.tsx \
  src/studio/studio-api.test.ts \
  src/studio/StudioAssetProcessingStatus.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit open-document material state**

```bash
git add apps/web/src/studio/StudioPage.tsx \
  apps/web/src/studio/StudioPage.test.tsx \
  apps/web/src/studio/StudioEditor.tsx \
  apps/web/src/studio/StudioEditor.test.tsx
git commit -m "feat: keep studio document materials together"
```

### Task 4: Insert a ready transcript at the last editor selection

**Files:**
- Modify: `apps/web/src/studio/StudioEditor.tsx`
- Test: `apps/web/src/studio/StudioEditor.test.tsx`
- Modify: `apps/web/src/studio/StudioAssetProcessingStatus.tsx`
- Test: `apps/web/src/studio/StudioAssetProcessingStatus.test.tsx`
- Modify: `apps/web/src/studio/StudioPage.tsx`
- Test: `apps/web/src/studio/StudioPage.test.tsx`

- [ ] **Step 1: Write failing editor-handle tests**

Export:

```ts
export type StudioEditorHandle = {
  insertTextAtLastSelection(text: string): boolean;
};
```

Render the editor with a ref, place the selection between two paragraphs, call
the handle, and assert the transcript appears at that position and the normal
PATCH autosave includes it. Add a second test with no prior selection and assert
the transcript is appended at the end. Add multiline text and assert each line
becomes a paragraph rather than words being concatenated.

Assert empty/whitespace input returns `false`, no PATCH is queued, and a saved
selection that exceeds the current restored document falls back to the end.

- [ ] **Step 2: Run editor tests and observe the missing handle**

Run:

```bash
pnpm --filter @prymeira/baase-web test -- src/studio/StudioEditor.test.tsx
```

Expected: FAIL because `StudioEditor` does not forward an insertion handle.

- [ ] **Step 3: Implement the narrow TipTap insertion boundary**

Convert the exported editor and its keyed session to `forwardRef`. Keep a
`lastSelectionRef` updated from `onSelectionUpdate`. In `useImperativeHandle`,
trim and split transcript text into non-empty paragraph nodes:

```ts
const content = text.split(/\r?\n/u)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] }));
```

Validate saved `from`/`to` against `editor.state.doc.content.size`; otherwise use
the document end. Execute one focused TipTap chain with `setTextSelection` and
`insertContent`. Let the existing `onUpdate` queue autosave; do not call the API
from the handle.

Rename the inline-link button's accessible label to `Formatar hyperlink no
texto` and update its tests so captured links cannot be confused with formatting.

- [ ] **Step 4: Write failing transcript-action tests**

For a ready audio with non-empty `extractedText`, assert the card renders
`Adicionar transcrição ao documento`, calls `onInsertTranscript(text)` once,
announces `Transcrição adicionada ao documento`, and suppresses a double click
while the callback promise is pending. Assert no action for pending, failed,
non-audio, or empty transcript assets.

- [ ] **Step 5: Implement the material-card action**

Add:

```ts
onInsertTranscript?: (text: string) => boolean | Promise<boolean>;
```

Track a local insertion state (`idle | inserting | inserted | error`). Render
the action only for ready non-empty audio. A `false` result or rejection shows a
quiet retryable failure; `true` shows the polite confirmation. The player,
download, polling, and processor retry paths remain unchanged.

- [ ] **Step 6: Wire page cards to the editor ref**

Create `const editorRef = useRef<StudioEditorHandle>(null)` in `StudioPage`, pass
it to `StudioEditor`, and pass this callback to each material card:

```ts
const insertTranscript = (text: string) => (
  editorRef.current?.insertTextAtLastSelection(text) ?? false
);
```

Reset the ref naturally when the keyed editor document changes. Do not place
asset state inside `StudioEditor`.

- [ ] **Step 7: Run focused transcript integration tests**

Run:

```bash
pnpm --filter @prymeira/baase-web test -- \
  src/studio/StudioEditor.test.tsx \
  src/studio/StudioAssetProcessingStatus.test.tsx \
  src/studio/StudioPage.test.tsx
pnpm --filter @prymeira/baase-web typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit transcript insertion**

```bash
git add apps/web/src/studio/StudioEditor.tsx \
  apps/web/src/studio/StudioEditor.test.tsx \
  apps/web/src/studio/StudioAssetProcessingStatus.tsx \
  apps/web/src/studio/StudioAssetProcessingStatus.test.tsx \
  apps/web/src/studio/StudioPage.tsx \
  apps/web/src/studio/StudioPage.test.tsx
git commit -m "feat: insert studio audio transcripts"
```

### Task 5: Apply quiet-ops visual and accessibility polish

**Files:**
- Modify: `apps/web/src/studio/studio.css`
- Modify: `apps/web/src/studio/studio-accessibility.test.tsx`
- Test: `apps/web/src/studio/StudioMaterialComposer.test.tsx`

- [ ] **Step 1: Write failing style and accessibility assertions**

Assert the material region has a named group, visible action text, recording
`aria-pressed`, polite status, link-field focus restoration, and minimum 44px
coarse-pointer targets. Assert mobile layout wraps actions without horizontal
overflow and preserves the editor-before-materials reading order.

- [ ] **Step 2: Run accessibility tests and observe missing styles/semantics**

Run:

```bash
pnpm --filter @prymeira/baase-web test -- \
  src/studio/studio-accessibility.test.tsx \
  src/studio/StudioMaterialComposer.test.tsx
```

Expected: FAIL on the new material-bar contract.

- [ ] **Step 3: Implement the quiet material surface**

Use existing Studio tokens and classes with these visual rules:

```css
.studio-material-composer {
  border-top: 1px solid var(--line);
  padding: 18px 0;
}

.studio-material-composer__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.studio-material-composer__action {
  min-height: 40px;
  border: 1px solid var(--line);
  background: var(--panel);
}
```

Use only the existing Studio tokens (`--line`, `--line2`, `--panel`, `--panel2`,
`--accent`, `--accent-bg`, and `--accent-ink`) instead of adding a parallel
palette. Use a restrained recording accent, existing focus ring, subtle pending
copy, and no modal, card grid, glow, gradient, or celebratory animation. Add
coarse-pointer and `max-width: 720px` rules with 44px targets.

- [ ] **Step 4: Run accessibility tests and web typecheck**

Run:

```bash
pnpm --filter @prymeira/baase-web test -- \
  src/studio/studio-accessibility.test.tsx \
  src/studio/StudioMaterialComposer.test.tsx \
  src/studio/StudioPage.test.tsx
pnpm --filter @prymeira/baase-web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit UI polish**

```bash
git add apps/web/src/studio/studio.css \
  apps/web/src/studio/studio-accessibility.test.tsx \
  apps/web/src/studio/StudioMaterialComposer.test.tsx
git commit -m "style: polish studio document materials"
```

### Task 6: Full verification and browser walkthrough

**Files:**
- Verify all files changed in Tasks 1-5.

- [ ] **Step 1: Run focused Studio tests repeatedly**

Run:

```bash
pnpm --filter @prymeira/baase-web test -- \
  src/studio/StudioAudioRecorder.test.tsx \
  src/studio/UniversalCaptureComposer.test.tsx \
  src/studio/StudioMaterialComposer.test.tsx \
  src/studio/StudioEditor.test.tsx \
  src/studio/StudioAssetProcessingStatus.test.tsx \
  src/studio/StudioPage.test.tsx \
  src/studio/studio-accessibility.test.tsx

for run in 1 2 3 4 5; do
  pnpm --filter @prymeira/baase-web test -- \
    src/studio/StudioAudioRecorder.test.tsx \
    src/studio/StudioMaterialComposer.test.tsx \
    src/studio/StudioEditor.test.tsx
done
```

Expected: every run exits 0 without recorder race or autosave flake.

- [ ] **Step 2: Run complete checks**

Run:

```bash
pnpm --filter @prymeira/baase-web typecheck
pnpm --filter @prymeira/baase-api typecheck
pnpm --filter @prymeira/baase-web test
pnpm --filter @prymeira/baase-api test
pnpm --filter @prymeira/baase-web build
```

Expected: all commands exit 0. PostgreSQL integration tests may retain their
existing environment-conditioned skips; no new tests are skipped.

- [ ] **Step 3: Run a local browser walkthrough**

Use the browser-control skill against the local app. Verify at desktop and a
mobile viewport:

1. open an existing Studio document;
2. confirm writing remains primary and the material bar is visually secondary;
3. record/stop audio or use the tested audio-file fallback;
4. add a file, image, and captured link sequentially;
5. confirm every material remains under the same document;
6. confirm inline hyperlink formatting is distinct;
7. wait for or fixture a ready transcript;
8. place the editor cursor, add the transcript, and confirm its position;
9. reload and confirm autosaved body and materials persist;
10. navigate by keyboard and inspect browser console errors.

Capture screenshots for the open document and mobile material bar. Fix any
observable clipping, focus, duplicate request, or stale-state issue before
continuing.

- [ ] **Step 4: Inspect the final patch**

Run:

```bash
git diff --check
git status --short
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- \
  apps/web/src/studio/StudioAudioRecorder.tsx \
  apps/web/src/studio/StudioMaterialComposer.tsx \
  apps/web/src/studio/StudioEditor.tsx \
  apps/web/src/studio/StudioAssetProcessingStatus.tsx \
  apps/web/src/studio/StudioPage.tsx \
  apps/web/src/studio/studio.css
```

Expected: no whitespace errors, no unrelated changes, no transcript mutation of
the preserved asset, and no new backend/storage schema.

- [ ] **Step 5: Push the verified main branch**

```bash
git push origin main
```

Expected: push succeeds and the Docker image workflow publishes the verified
commit.
