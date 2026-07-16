import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioApiError } from "./studio-api";
import type { StudioDocument, StudioDocumentVersion } from "./studio.types";
import { studioDraftStorageKey, useStudioAutosave, type StudioDocumentDraft } from "./useStudioAutosave";

const document = makeDocument();
const firstDraft = draft("Primeira versão");
const secondDraft = draft("Segunda versão");

describe("useStudioAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installLocalStorage();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("collapses rapid changes into one PATCH after 700 ms", async () => {
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));
    const { result } = renderHook(() => useStudioAutosave(document, save));

    act(() => {
      result.current.queueSave(firstDraft);
      result.current.queueSave(secondDraft);
    });
    expect(result.current.state).toBe("dirty");
    expect(readEnvelope().draft).toEqual(secondDraft);
    expect(readEnvelope()).toMatchObject({ version: 1, baseRevision: 4 });

    await act(async () => vi.advanceTimersByTimeAsync(699));
    expect(save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(secondDraft, 4, expect.any(AbortSignal));
    expect(result.current.document.revision).toBe(5);
    expect(result.current.state).toBe("saved");
    expect(window.localStorage.getItem(studioDraftStorageKey(document.id))).toBeNull();
  });

  it("creates one significant-pause checkpoint 30 seconds after a meaningful save", async () => {
    const meaningfulDraft = draft("Uma mudança suficientemente longa para preservar");
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));
    const checkpoint = vi.fn(async () => undefined);
    const { result } = renderHook(() => useStudioAutosave(document, save, { checkpoint }));

    act(() => result.current.queueSave(meaningfulDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    await act(async () => vi.advanceTimersByTimeAsync(29_999));
    expect(checkpoint).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(checkpoint).toHaveBeenCalledWith(5, "significant_pause", expect.any(AbortSignal));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(checkpoint).toHaveBeenCalledTimes(1);
  });

  it("cancels a stale checkpoint candidate when a newer edit is queued", async () => {
    const firstMeaningfulDraft = draft("Uma primeira mudança longa e significativa");
    const newerMeaningfulDraft = draft("Uma segunda mudança ainda mais longa e atualizada");
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));
    const checkpoint = vi.fn(async () => undefined);
    const { result } = renderHook(() => useStudioAutosave(document, save, { checkpoint }));

    act(() => result.current.queueSave(firstMeaningfulDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    act(() => result.current.queueSave(newerMeaningfulDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    await act(async () => vi.advanceTimersByTimeAsync(29_999));
    expect(checkpoint).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(checkpoint).toHaveBeenCalledWith(6, "significant_pause", expect.any(AbortSignal));
  });

  it("does not checkpoint an older save while a newer draft is still saving", async () => {
    const first = deferred<StudioDocument>();
    const second = deferred<StudioDocument>();
    const firstMeaningfulDraft = draft("Uma primeira mudança longa e significativa");
    const newerMeaningfulDraft = draft("Uma segunda mudança longa e significativa");
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const checkpoint = vi.fn(async () => undefined);
    const { result } = renderHook(() => useStudioAutosave(document, save, { checkpoint }));

    act(() => result.current.queueSave(firstMeaningfulDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    act(() => result.current.queueSave(newerMeaningfulDraft));
    await act(async () => first.resolve(saved(firstMeaningfulDraft, 5)));
    expect(save).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(checkpoint).not.toHaveBeenCalled();

    await act(async () => second.resolve(saved(newerMeaningfulDraft, 6)));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(checkpoint).toHaveBeenCalledWith(6, "significant_pause", expect.any(AbortSignal));
  });

  it("keeps a completed save exit-eligible while the next draft is still saving", async () => {
    const first = deferred<StudioDocument>();
    const second = deferred<StudioDocument>();
    const firstMeaningfulDraft = draft("Uma primeira mudança longa já persistida");
    const newerMeaningfulDraft = draft("Uma segunda mudança longa ainda sendo persistida");
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const checkpoint = vi.fn(async (_revision: number, _reason: string, _signal?: AbortSignal) => undefined);
    const { result } = renderHook(() => useStudioAutosave(document, save, { checkpoint }));

    act(() => result.current.queueSave(firstMeaningfulDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    act(() => result.current.queueSave(newerMeaningfulDraft));
    await act(async () => first.resolve(saved(firstMeaningfulDraft, 5)));
    expect(save).toHaveBeenCalledTimes(2);

    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    expect(checkpoint).toHaveBeenCalledWith(5, "document_exit", undefined);

    await act(async () => second.resolve(saved(newerMeaningfulDraft, 6)));
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    expect(checkpoint.mock.calls.map(([revision]) => revision)).toEqual([5, 6]);
  });

  it("atomically saves and checkpoints a pending PATCH on pagehide", async () => {
    const pendingSave = deferred<StudioDocument>();
    const pendingExit = deferred<{ document: StudioDocument; version: StudioDocumentVersion }>();
    let saveSignal: AbortSignal | undefined;
    const save = vi.fn((_draft: StudioDocumentDraft, _revision: number, signal?: AbortSignal) => {
      saveSignal = signal;
      return pendingSave.promise;
    });
    const checkpoint = vi.fn(async () => undefined);
    const saveExitCheckpoint = vi.fn(() => pendingExit.promise);
    const { result } = renderHook(() => useStudioAutosave(document, save, { checkpoint, saveExitCheckpoint }));
    const meaningfulDraft = draft("Uma mudança pendente preservada atomicamente");

    act(() => result.current.queueSave(meaningfulDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));

    expect(saveSignal?.aborted).toBe(true);
    expect(saveExitCheckpoint).toHaveBeenCalledWith(meaningfulDraft, 4);
    expect(checkpoint).not.toHaveBeenCalled();
    await act(async () => pendingExit.resolve(exitCheckpointResult(meaningfulDraft, 5)));
    expect(result.current.document.revision).toBe(5);
    expect(result.current.state).toBe("saved");
  });

  it("ignores a late atomic exit result after switching documents", async () => {
    const pendingSave = deferred<StudioDocument>();
    const pendingExit = deferred<{ document: StudioDocument; version: StudioDocumentVersion }>();
    const save = vi.fn(() => pendingSave.promise);
    const saveExitCheckpoint = vi.fn(() => pendingExit.promise);
    const otherDocument = makeDocument({ id: "document_2", revision: 8, title: "Outro", bodyText: "Outro" });
    const { result, rerender } = renderHook(
      ({ source }) => useStudioAutosave(source, save, { saveExitCheckpoint }),
      { initialProps: { source: document } }
    );
    const meaningfulDraft = draft("Mudança do documento anterior");

    act(() => result.current.queueSave(meaningfulDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    rerender({ source: otherDocument });
    await act(async () => pendingExit.resolve(exitCheckpointResult(meaningfulDraft, 5)));

    expect(result.current.document.id).toBe(otherDocument.id);
    expect(result.current.document.revision).toBe(8);
  });

  it("creates a document-exit checkpoint for the last meaningful completed save", async () => {
    const meaningfulDraft = draft("Uma mudança suficientemente longa antes de sair");
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));
    const checkpoint = vi.fn(async () => undefined);
    const { result, unmount } = renderHook(() => useStudioAutosave(document, save, { checkpoint }));

    act(() => result.current.queueSave(meaningfulDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    unmount();

    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(checkpoint).toHaveBeenCalledWith(5, "document_exit", undefined);
  });

  it("checkpoints a short saved text correction on pagehide without treating it as a significant pause", async () => {
    const shortCorrection = draft("Original!");
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));
    const checkpoint = vi.fn(async () => undefined);
    const { result } = renderHook(() => useStudioAutosave(document, save, { checkpoint }));

    act(() => result.current.queueSave(shortCorrection));
    await act(async () => vi.advanceTimersByTimeAsync(30_700));
    expect(checkpoint).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    expect(checkpoint).toHaveBeenCalledWith(5, "document_exit", undefined);
  });

  it("checkpoints a formatting-only body JSON save on unmount", async () => {
    const formattedDraft: StudioDocumentDraft = {
      title: document.title,
      bodyText: document.bodyText,
      bodyJson: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "Original", marks: [{ type: "bold" }] }]
        }]
      }
    };
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));
    const checkpoint = vi.fn(async () => undefined);
    const { result, unmount } = renderHook(() => useStudioAutosave(document, save, { checkpoint }));

    act(() => result.current.queueSave(formattedDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    unmount();

    expect(checkpoint).toHaveBeenCalledWith(5, "document_exit", undefined);
  });

  it("checkpoints a title-only save on pagehide", async () => {
    const titleOnlyDraft: StudioDocumentDraft = {
      title: "Plano anual revisado",
      bodyText: document.bodyText,
      bodyJson: document.bodyJson
    };
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));
    const checkpoint = vi.fn(async () => undefined);
    const { result } = renderHook(() => useStudioAutosave(document, save, { checkpoint }));

    act(() => result.current.queueSave(titleOnlyDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));

    expect(checkpoint).toHaveBeenCalledWith(5, "document_exit", undefined);
  });

  it("does not duplicate an in-flight pagehide checkpoint during unmount", async () => {
    const pendingCheckpoint = deferred<void>();
    const meaningfulDraft = draft("Uma mudança suficientemente longa antes de navegar");
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));
    const checkpoint = vi.fn(() => pendingCheckpoint.promise);
    const { result, unmount } = renderHook(() => useStudioAutosave(document, save, { checkpoint }));

    act(() => result.current.queueSave(meaningfulDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    unmount();

    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(checkpoint).toHaveBeenCalledWith(5, "document_exit", undefined);
    await act(async () => pendingCheckpoint.resolve());
  });

  it("checkpoints a newer saved revision while an older pagehide checkpoint is still in flight", async () => {
    const firstCheckpoint = deferred<void>();
    const secondCheckpoint = deferred<void>();
    const firstMeaningfulDraft = draft("Uma primeira mudança longa antes de navegar");
    const newerMeaningfulDraft = draft("Uma segunda mudança longa salva após voltar pelo BFCache");
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));
    const checkpoint = vi.fn()
      .mockImplementationOnce(() => firstCheckpoint.promise)
      .mockImplementationOnce(() => secondCheckpoint.promise);
    const { result } = renderHook(() => useStudioAutosave(document, save, { checkpoint }));

    act(() => result.current.queueSave(firstMeaningfulDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    act(() => result.current.queueSave(newerMeaningfulDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));

    expect(checkpoint).toHaveBeenCalledTimes(2);
    expect(checkpoint.mock.calls.map(([revision]) => revision)).toEqual([5, 6]);
    await act(async () => secondCheckpoint.resolve());
    await act(async () => firstCheckpoint.reject(new TypeError("older navigation failed late")));
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    expect(checkpoint).toHaveBeenCalledTimes(2);
  });

  it("retries an unchanged exit candidate after its pagehide checkpoint fails", async () => {
    const meaningfulDraft = draft("Uma mudança suficientemente longa antes de uma falha");
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));
    const checkpoint = vi.fn()
      .mockRejectedValueOnce(new TypeError("navigation interrupted"))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useStudioAutosave(document, save, { checkpoint }));

    act(() => result.current.queueSave(meaningfulDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    await act(async () => Promise.resolve());
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));

    expect(checkpoint).toHaveBeenCalledTimes(2);
    expect(checkpoint.mock.calls.map(([revision]) => revision)).toEqual([5, 5]);
  });

  it("never blocks draft saves behind an in-flight checkpoint", async () => {
    const pendingCheckpoint = deferred<void>();
    const firstMeaningfulDraft = draft("Uma primeira mudança longa e significativa");
    const newerMeaningfulDraft = draft("Uma segunda mudança longa e significativa");
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));
    let checkpointSignal: AbortSignal | undefined;
    const checkpoint = vi.fn((_revision: number, _reason: string, signal?: AbortSignal) => {
      checkpointSignal = signal;
      return pendingCheckpoint.promise;
    });
    const { result } = renderHook(() => useStudioAutosave(document, save, { checkpoint }));

    act(() => result.current.queueSave(firstMeaningfulDraft));
    await act(async () => vi.advanceTimersByTimeAsync(30_700));
    expect(checkpoint).toHaveBeenCalledTimes(1);

    act(() => result.current.queueSave(newerMeaningfulDraft));
    expect(checkpointSignal?.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(700));

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(newerMeaningfulDraft, 5, expect.any(AbortSignal));
  });

  it("adopts a newer clean revision of the same document before the next PATCH", async () => {
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));
    const newerDocument = makeDocument({
      revision: 5,
      title: "Plano reorganizado pela IA",
      bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Nova direção" }] }] },
      bodyText: "Nova direção"
    });
    const { result, rerender } = renderHook(
      ({ source }) => useStudioAutosave(source, save),
      { initialProps: { source: document } }
    );

    rerender({ source: newerDocument });

    expect(result.current.document).toEqual(newerDocument);
    expect(result.current.state).toBe("saved");
    act(() => result.current.queueSave(secondDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(save).toHaveBeenCalledWith(secondDraft, 5, expect.any(AbortSignal));
  });

  it("turns a pending local draft into an explicit conflict when the same document advances", async () => {
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));
    const newerDocument = makeDocument({ revision: 5, title: "Servidor mais novo" });
    const { result, rerender } = renderHook(
      ({ source }) => useStudioAutosave(source, save),
      { initialProps: { source: document } }
    );
    act(() => result.current.queueSave(firstDraft));

    rerender({ source: newerDocument });

    expect(result.current.state).toBe("conflict");
    expect(result.current.currentDraft).toEqual(firstDraft);
    expect(result.current.conflictDraft).toEqual(firstDraft);
    expect(readEnvelope().draft).toEqual(firstDraft);
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(save).not.toHaveBeenCalled();
  });

  it("aborts an in-flight save and keeps its draft when the same document advances", async () => {
    const pending = deferred<StudioDocument>();
    let observedSignal: AbortSignal | undefined;
    const save = vi.fn((_next: StudioDocumentDraft, _revision: number, signal?: AbortSignal) => {
      observedSignal = signal;
      return pending.promise;
    });
    const newerDocument = makeDocument({ revision: 5, title: "Servidor mais novo" });
    const { result, rerender } = renderHook(
      ({ source }) => useStudioAutosave(source, save),
      { initialProps: { source: document } }
    );
    act(() => result.current.queueSave(firstDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));

    rerender({ source: newerDocument });

    expect(observedSignal?.aborted).toBe(true);
    expect(result.current.state).toBe("conflict");
    expect(result.current.conflictDraft).toEqual(firstDraft);
    await act(async () => pending.resolve(saved(firstDraft, 5)));
    expect(result.current.state).toBe("conflict");
    expect(result.current.document.revision).toBe(4);
  });

  it("does not let an aborted save release a newer in-flight save", async () => {
    const first = deferred<StudioDocument>();
    const second = deferred<StudioDocument>();
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementation(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));
    const newerDocument = makeDocument({ revision: 5, title: "Servidor mais novo" });
    const { result, rerender } = renderHook(
      ({ source }) => useStudioAutosave(source, save),
      { initialProps: { source: document } }
    );
    act(() => result.current.queueSave(firstDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    rerender({ source: newerDocument });
    act(() => result.current.resolveConflict(newerDocument, true));
    act(() => result.current.queueSave(secondDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(save).toHaveBeenCalledTimes(2);

    await act(async () => first.resolve(saved(firstDraft, 5)));
    act(() => result.current.queueSave(firstDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));

    expect(save).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve(saved(secondDraft, 6)));
    expect(save).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenLastCalledWith(firstDraft, 6, expect.any(AbortSignal));
  });

  it("serializes an edit made during an in-flight save into a second PATCH", async () => {
    const first = deferred<StudioDocument>();
    const second = deferred<StudioDocument>();
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result } = renderHook(() => useStudioAutosave(document, save));

    act(() => result.current.queueSave(firstDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(save).toHaveBeenCalledWith(firstDraft, 4, expect.any(AbortSignal));

    act(() => result.current.queueSave(secondDraft));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(saved(firstDraft, 5)));

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(secondDraft, 5, expect.any(AbortSignal));
    expect(readEnvelope()).toMatchObject({ version: 1, baseRevision: 5, draft: secondDraft });

    await act(async () => second.resolve(saved(secondDraft, 6)));
    expect(result.current.document.revision).toBe(6);
    expect(result.current.document.bodyText).toBe(secondDraft.bodyText);
    expect(window.localStorage.getItem(studioDraftStorageKey(document.id))).toBeNull();
  });

  it("enters conflict state on 409 and never retries by overwriting", async () => {
    const save = vi.fn(async () => {
      throw new StudioApiError(409, "STUDIO_DOCUMENT_CHANGED", "O documento mudou.");
    });
    const { result } = renderHook(() => useStudioAutosave(document, save));

    act(() => result.current.queueSave(firstDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));

    expect(result.current.state).toBe("conflict");
    expect(result.current.conflictDraft).toEqual(firstDraft);
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(save).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(studioDraftStorageKey(document.id))).not.toBeNull();
  });

  it("keeps a local draft on network failure and retries it explicitly", async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(saved(firstDraft, 5));
    const { result } = renderHook(() => useStudioAutosave(document, save));

    act(() => result.current.queueSave(firstDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));

    expect(result.current.state).toBe("offline");
    expect(window.localStorage.getItem(studioDraftStorageKey(document.id))).not.toBeNull();

    await act(async () => result.current.retry());
    expect(save).toHaveBeenLastCalledWith(firstDraft, 4, expect.any(AbortSignal));
    expect(result.current.state).toBe("saved");
    expect(window.localStorage.getItem(studioDraftStorageKey(document.id))).toBeNull();
  });

  it("only clears storage when the matching draft succeeds", async () => {
    const first = deferred<StudioDocument>();
    const second = deferred<StudioDocument>();
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result } = renderHook(() => useStudioAutosave(document, save));

    act(() => result.current.queueSave(firstDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    act(() => result.current.queueSave(secondDraft));
    await act(async () => first.resolve(saved(firstDraft, 5)));

    expect(readEnvelope()).toMatchObject({ version: 1, baseRevision: 5, draft: secondDraft });
    await act(async () => second.resolve(saved(secondDraft, 6)));
    expect(window.localStorage.getItem(studioDraftStorageKey(document.id))).toBeNull();
  });

  it("cancels pending and in-flight work when unmounted", async () => {
    const pending = deferred<StudioDocument>();
    let observedSignal: AbortSignal | undefined;
    const save = vi.fn((_draft: StudioDocumentDraft, _revision: number, signal?: AbortSignal) => {
      observedSignal = signal;
      return pending.promise;
    });
    const { result, unmount } = renderHook(() => useStudioAutosave(document, save));

    act(() => result.current.queueSave(firstDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    unmount();

    expect(observedSignal?.aborted).toBe(true);
    await act(async () => pending.resolve(saved(firstDraft, 5)));
  });

  it("recovers and safely requeues a persisted draft after reload", async () => {
    storeEnvelope(secondDraft, 4);
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));

    const { result } = renderHook(() => useStudioAutosave(document, save));

    expect(result.current.initialDraft).toEqual(secondDraft);
    expect(result.current.state).toBe("dirty");
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(save).toHaveBeenCalledWith(secondDraft, 4, expect.any(AbortSignal));
    expect(result.current.state).toBe("saved");
  });

  it("opens a recovered draft in conflict without PATCH when its base revision is stale", async () => {
    storeEnvelope(secondDraft, 3);
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));

    const { result } = renderHook(() => useStudioAutosave(document, save));

    expect(result.current.initialDraft).toEqual(secondDraft);
    expect(result.current.conflictDraft).toEqual(secondDraft);
    expect(result.current.state).toBe("conflict");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(save).not.toHaveBeenCalled();
  });

  it("quarantines an invalid TipTap draft with a warning and never PATCHes it", async () => {
    const invalid = { ...secondDraft, bodyJson: { type: "paragraph", content: "not-an-array" } };
    window.localStorage.setItem(studioDraftStorageKey(document.id), JSON.stringify({
      version: 1,
      baseRevision: 4,
      generation: 1,
      signature: JSON.stringify(invalid),
      draft: invalid
    }));
    const save = vi.fn();

    const { result } = renderHook(() => useStudioAutosave(document, save));

    expect(result.current.initialDraft).toBeNull();
    expect(result.current.recoveryWarning).toMatch(/rascunho local.*inválido/i);
    expect(window.localStorage.getItem(studioDraftStorageKey(document.id))).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(save).not.toHaveBeenCalled();
  });

  it("reports unavailable storage when reading localStorage is blocked", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new DOMException("blocked", "SecurityError"); }
    });

    const { result } = renderHook(() => useStudioAutosave(document, vi.fn()));

    expect(result.current.state).toBe("saved");
    expect(result.current.storageUnavailable).toBe(true);
  });

  it("keeps the dirty draft in memory and reports quota failures truthfully", () => {
    const storage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: storage.clear,
        getItem: storage.getItem,
        removeItem: storage.removeItem,
        setItem: () => { throw new DOMException("full", "QuotaExceededError"); }
      }
    });
    const { result } = renderHook(() => useStudioAutosave(document, vi.fn()));

    act(() => result.current.queueSave(secondDraft));

    expect(result.current.state).toBe("dirty");
    expect(result.current.currentDraft).toEqual(secondDraft);
  });

  it("returns to normal dirty persistence when browser storage becomes available again", () => {
    const readable = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => readable.clear(),
        getItem: (key: string) => readable.get(key) ?? null,
        removeItem: (key: string) => readable.delete(key),
        setItem: () => { throw new DOMException("full", "QuotaExceededError"); }
      }
    });
    const { result } = renderHook(() => useStudioAutosave(document, vi.fn()));
    act(() => result.current.queueSave(firstDraft));
    expect(result.current.state).toBe("dirty");

    installLocalStorage();
    act(() => result.current.queueSave(secondDraft));

    expect(result.current.state).toBe("dirty");
    expect(result.current.storageUnavailable).toBe(false);
    expect(readEnvelope().draft).toEqual(secondDraft);
  });

  it("keeps storage availability orthogonal when quota failure is followed by PATCH 409", async () => {
    const storage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: storage.clear,
        getItem: storage.getItem,
        removeItem: storage.removeItem,
        setItem: () => { throw new DOMException("full", "QuotaExceededError"); }
      }
    });
    const save = vi.fn(async () => {
      throw new StudioApiError(409, "STUDIO_DOCUMENT_CHANGED", "O documento mudou.");
    });
    const { result } = renderHook(() => useStudioAutosave(document, save));

    act(() => result.current.queueSave(secondDraft));
    await act(async () => vi.advanceTimersByTimeAsync(700));

    expect(result.current.state).toBe("conflict");
    expect(result.current.storageUnavailable).toBe(true);
    expect(result.current.conflictDraft).toEqual(secondDraft);
  });

  it.each([
    ["unknown node", { type: "doc", content: [{ type: "secretWidget", attrs: { token: "private" } }] }, ""],
    ["unknown mark", {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Texto", marks: [{ type: "secretMark" }] }] }]
    }, "Texto"],
    ["unknown attribute", {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 2, secret: true }, content: [{ type: "text", text: "Título" }] }]
    }, "Título"],
    ["body text mismatch", {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Texto real" }] }]
    }, "Texto adulterado"]
  ])("quarantines %s and never PATCHes it", async (_label, bodyJson, bodyText) => {
    const invalid = { title: "Inválido", bodyJson, bodyText } as StudioDocumentDraft;
    storeEnvelope(invalid, 4);
    const save = vi.fn();

    const { result } = renderHook(() => useStudioAutosave(document, save));

    expect(result.current.initialDraft).toBeNull();
    expect(result.current.recoveryWarning).toMatch(/rascunho local.*inválido/i);
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(save).not.toHaveBeenCalled();
  });

  it("accepts the configured StarterKit and Link structures when the text snapshot matches", () => {
    const richDraft: StudioDocumentDraft = {
      title: "Plano rico",
      bodyJson: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Direção", marks: [{ type: "bold" }] }]
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Linha" },
              { type: "hardBreak" },
              {
                type: "text",
                text: "seguinte",
                marks: [{
                  type: "link",
                  attrs: { href: "https://example.com", target: null, rel: "noopener noreferrer", class: null, title: null }
                }]
              }
            ]
          },
          {
            type: "bulletList",
            content: [{
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Item" }] }]
            }]
          }
        ]
      },
      bodyText: "Direção\nLinha\nseguinte\nItem"
    };
    storeEnvelope(richDraft, 4);

    const { result } = renderHook(() => useStudioAutosave(document, vi.fn()));

    expect(result.current.initialDraft).toEqual(richDraft);
    expect(result.current.recoveryWarning).toBeNull();
  });

  it("keeps only one time-bounded quarantine and purges it on the next valid draft", () => {
    const quarantineKey = `baase:studio:draft:${document.id}:quarantine`;
    const firstInvalid = { title: null, bodyJson: { type: "unknown" }, bodyText: "primeiro" } as StudioDocumentDraft;
    storeEnvelope(firstInvalid, 4);
    const first = renderHook(() => useStudioAutosave(document, vi.fn()));
    const quarantined = JSON.parse(window.localStorage.getItem(quarantineKey)!);
    expect(quarantined).toMatchObject({ version: 1, raw: expect.any(String) });
    expect(quarantined.expiresAt).toBeGreaterThan(Date.now());
    expect([...localStorageKeys()].filter((key) => key.startsWith(quarantineKey))).toEqual([quarantineKey]);
    first.unmount();

    storeEnvelope(secondDraft, 4);
    renderHook(() => useStudioAutosave(document, vi.fn()));
    expect(window.localStorage.getItem(quarantineKey)).toBeNull();
  });

  it("purges an expired invalid-draft quarantine on the next read", () => {
    const quarantineKey = `baase:studio:draft:${document.id}:quarantine`;
    window.localStorage.setItem(quarantineKey, JSON.stringify({
      version: 1,
      quarantinedAt: Date.now() - 100_000,
      expiresAt: Date.now() - 1,
      raw: "sensitive"
    }));

    renderHook(() => useStudioAutosave(document, vi.fn()));

    expect(window.localStorage.getItem(quarantineKey)).toBeNull();
  });

  it("recovers the draft belonging to a newly selected document without replaying the previous one", async () => {
    storeEnvelope(firstDraft, 4);
    const otherDocument = makeDocument({ id: "document_2", revision: 7, title: "Outro plano" });
    const otherDraft = draft("Rascunho do outro documento");
    window.localStorage.setItem(studioDraftStorageKey(otherDocument.id), JSON.stringify({
      version: 1,
      baseRevision: 7,
      generation: 2,
      signature: JSON.stringify(otherDraft),
      draft: otherDraft
    }));
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));
    const { result, rerender } = renderHook(
      ({ source }) => useStudioAutosave(source, save),
      { initialProps: { source: document } }
    );

    rerender({ source: otherDocument });
    expect(result.current.initialDraft).toEqual(otherDraft);
    await act(async () => vi.advanceTimersByTimeAsync(700));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(otherDraft, 7, expect.any(AbortSignal));
  });
});

function readEnvelope() {
  return JSON.parse(window.localStorage.getItem(studioDraftStorageKey(document.id))!) as {
    version: number;
    baseRevision: number;
    generation: number;
    signature: string;
    draft: StudioDocumentDraft;
  };
}

function storeEnvelope(value: StudioDocumentDraft, baseRevision: number) {
  window.localStorage.setItem(studioDraftStorageKey(document.id), JSON.stringify({
    version: 1,
    baseRevision,
    generation: 1,
    signature: JSON.stringify(value),
    draft: value
  }));
}

function draft(bodyText: string): StudioDocumentDraft {
  return {
    title: "Plano anual",
    bodyJson: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }]
    },
    bodyText
  };
}

function makeDocument(overrides: Partial<StudioDocument> = {}): StudioDocument {
  return {
    id: "document_1", workspaceId: "workspace_a", ownerProfileId: "profile_owner", captureKey: null,
    title: "Plano anual", bodyJson: { type: "doc" }, bodyText: "Original", revision: 4,
    captureMode: "text", inboxState: "reviewed", isFocused: false, status: "active",
    createdAt: "2026-07-10T10:00:00.000Z", updatedAt: "2026-07-13T10:00:00.000Z", archivedAt: null,
    ...overrides
  };
}

function saved(next: StudioDocumentDraft, revision: number) {
  return makeDocument({ title: next.title, bodyJson: next.bodyJson, bodyText: next.bodyText, revision });
}

function exitCheckpointResult(next: StudioDocumentDraft, revision: number) {
  const nextDocument = saved(next, revision);
  return {
    document: nextDocument,
    version: {
      id: `version_${revision}`, workspaceId: nextDocument.workspaceId, ownerProfileId: nextDocument.ownerProfileId,
      documentId: nextDocument.id, versionNumber: revision, bodyJson: next.bodyJson, bodyText: next.bodyText,
      origin: "user" as const, actorProfileId: nextDocument.ownerProfileId, aiRunId: null,
      createdAt: "2026-07-15T10:00:00.000Z", title: next.title,
      checkpointReason: "document_exit" as const, sourceRevision: revision, isLegacy: false
    }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, String(value)),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; }
    }
  });
}

function localStorageKeys() {
  return Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)!);
}
