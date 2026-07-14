import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioApiError } from "./studio-api";
import type { StudioDocument } from "./studio.types";
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
    expect(JSON.parse(window.localStorage.getItem(studioDraftStorageKey(document.id))!)).toMatchObject(secondDraft);

    await act(async () => vi.advanceTimersByTimeAsync(699));
    expect(save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(secondDraft, 4, expect.any(AbortSignal));
    expect(result.current.document.revision).toBe(5);
    expect(result.current.state).toBe("saved");
    expect(window.localStorage.getItem(studioDraftStorageKey(document.id))).toBeNull();
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
    expect(window.localStorage.getItem(studioDraftStorageKey(document.id))).not.toBeNull();

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

    expect(JSON.parse(window.localStorage.getItem(studioDraftStorageKey(document.id))!)).toMatchObject(secondDraft);
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
    window.localStorage.setItem(studioDraftStorageKey(document.id), JSON.stringify(secondDraft));
    const save = vi.fn(async (next: StudioDocumentDraft, revision: number) => saved(next, revision + 1));

    const { result } = renderHook(() => useStudioAutosave(document, save));

    expect(result.current.initialDraft).toEqual(secondDraft);
    expect(result.current.state).toBe("dirty");
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(save).toHaveBeenCalledWith(secondDraft, 4, expect.any(AbortSignal));
    expect(result.current.state).toBe("saved");
  });
});

function draft(bodyText: string): StudioDocumentDraft {
  return { title: "Plano anual", bodyJson: { type: "doc", content: [{ type: "paragraph" }] }, bodyText };
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
      setItem: (key: string, value: string) => values.set(key, String(value))
    }
  });
}
