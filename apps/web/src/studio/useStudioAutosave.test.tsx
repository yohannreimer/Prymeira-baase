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
    const quarantineKey = `baase:studio:draft-quarantine:${document.id}`;
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
    const quarantineKey = `baase:studio:draft-quarantine:${document.id}`;
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
