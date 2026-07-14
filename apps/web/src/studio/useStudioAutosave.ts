import { useCallback, useEffect, useRef, useState } from "react";
import { StudioApiError } from "./studio-api";
import type { StudioDocument } from "./studio.types";

export type AutosaveState = "idle" | "dirty" | "saving" | "saved" | "offline" | "conflict" | "error";

export type StudioDocumentDraft = {
  title: string | null;
  bodyJson: Record<string, unknown>;
  bodyText: string;
};

export type SaveStudioDocument = (
  draft: StudioDocumentDraft,
  expectedRevision: number,
  signal?: AbortSignal
) => Promise<StudioDocument>;

type QueuedDraft = {
  draft: StudioDocumentDraft;
  serialized: string;
};

export function studioDraftStorageKey(documentId: string) {
  return `baase:studio:draft:${documentId}`;
}

function serializeDraft(draft: StudioDocumentDraft) {
  return JSON.stringify(draft);
}

function browserStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function readStoredDraft(documentId: string): StudioDocumentDraft | null {
  try {
    const value = browserStorage()?.getItem(studioDraftStorageKey(documentId));
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<StudioDocumentDraft>;
    if ((parsed.title !== null && typeof parsed.title !== "string")
      || typeof parsed.bodyText !== "string"
      || parsed.bodyJson === null
      || typeof parsed.bodyJson !== "object"
      || Array.isArray(parsed.bodyJson)) return null;
    return { title: parsed.title ?? null, bodyJson: parsed.bodyJson, bodyText: parsed.bodyText };
  } catch {
    return null;
  }
}

function writeStoredDraft(documentId: string, serialized: string) {
  try {
    browserStorage()?.setItem(studioDraftStorageKey(documentId), serialized);
  } catch {
    // The in-memory queue remains authoritative if browser storage is unavailable.
  }
}

function clearMatchingStoredDraft(documentId: string, serialized: string) {
  try {
    const storage = browserStorage();
    if (storage?.getItem(studioDraftStorageKey(documentId)) === serialized) {
      storage.removeItem(studioDraftStorageKey(documentId));
    }
  } catch {
    // Saving still succeeded; storage can be reconciled on the next explicit edit.
  }
}

function clearStoredDraft(documentId: string) {
  try {
    browserStorage()?.removeItem(studioDraftStorageKey(documentId));
  } catch {
    // There is nothing else to do when storage is unavailable.
  }
}

export function useStudioAutosave(
  sourceDocument: StudioDocument,
  save: SaveStudioDocument,
  options: { debounceMs?: number } = {}
) {
  const debounceMs = options.debounceMs ?? 700;
  const recoveredAtMount = useRef(readStoredDraft(sourceDocument.id));
  const [document, setDocument] = useState(sourceDocument);
  const [state, setState] = useState<AutosaveState>(recoveredAtMount.current ? "dirty" : "saved");
  const [conflictDraft, setConflictDraft] = useState<StudioDocumentDraft | null>(null);
  const documentIdRef = useRef(sourceDocument.id);
  const revisionRef = useRef(sourceDocument.revision);
  const saveRef = useRef(save);
  const queuedRef = useRef<QueuedDraft | null>(null);
  const retryRef = useRef<QueuedDraft | null>(recoveredAtMount.current
    ? { draft: recoveredAtMount.current, serialized: serializeDraft(recoveredAtMount.current) }
    : null);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const runNextRef = useRef<() => Promise<void>>(async () => undefined);

  saveRef.current = save;

  const runNext = useCallback(async () => {
    if (!mountedRef.current || savingRef.current || !queuedRef.current) return;
    const item = queuedRef.current;
    queuedRef.current = null;
    retryRef.current = item;
    savingRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState("saving");

    try {
      const savedDocument = await saveRef.current(item.draft, revisionRef.current, controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      revisionRef.current = savedDocument.revision;
      setDocument(savedDocument);
      clearMatchingStoredDraft(documentIdRef.current, item.serialized);
      retryRef.current = null;
      setConflictDraft(null);
      setState(queuedRef.current ? "dirty" : "saved");
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted) return;
      const freshest = queuedRef.current ?? item;
      queuedRef.current = null;
      retryRef.current = freshest;
      if (error instanceof StudioApiError && error.status === 409) {
        setConflictDraft(freshest.draft);
        setState("conflict");
      } else if (error instanceof TypeError) {
        setState("offline");
      } else {
        setState("error");
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      savingRef.current = false;
      if (mountedRef.current && queuedRef.current) await runNextRef.current();
    }
  }, []);
  runNextRef.current = runNext;

  const queueSave = useCallback((draft: StudioDocumentDraft) => {
    const serialized = serializeDraft(draft);
    const queued = { draft, serialized };
    queuedRef.current = queued;
    retryRef.current = queued;
    writeStoredDraft(documentIdRef.current, serialized);
    setConflictDraft(null);
    setState(savingRef.current ? "saving" : "dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!savingRef.current) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void runNextRef.current();
      }, debounceMs);
    }
  }, [debounceMs]);

  const retry = useCallback(async () => {
    if (savingRef.current || !retryRef.current) return;
    queuedRef.current = retryRef.current;
    setConflictDraft(null);
    await runNextRef.current();
  }, []);

  const resolveConflict = useCallback((serverDocument: StudioDocument, discardLocalDraft: boolean) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    controllerRef.current?.abort();
    controllerRef.current = null;
    queuedRef.current = null;
    retryRef.current = null;
    revisionRef.current = serverDocument.revision;
    setDocument(serverDocument);
    setConflictDraft(null);
    setState("saved");
    if (discardLocalDraft) clearStoredDraft(documentIdRef.current);
  }, []);

  const markConflict = useCallback((draft: StudioDocumentDraft) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const serialized = serializeDraft(draft);
    queuedRef.current = null;
    retryRef.current = { draft, serialized };
    writeStoredDraft(documentIdRef.current, serialized);
    setConflictDraft(draft);
    setState("conflict");
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (sourceDocument.id === documentIdRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    controllerRef.current?.abort();
    documentIdRef.current = sourceDocument.id;
    revisionRef.current = sourceDocument.revision;
    const recovered = readStoredDraft(sourceDocument.id);
    recoveredAtMount.current = recovered;
    queuedRef.current = null;
    retryRef.current = recovered ? { draft: recovered, serialized: serializeDraft(recovered) } : null;
    setDocument(sourceDocument);
    setConflictDraft(null);
    setState(recovered ? "dirty" : "saved");
  }, [sourceDocument]);

  useEffect(() => {
    const recovered = recoveredAtMount.current;
    if (recovered) queueSave(recovered);
  }, [queueSave, sourceDocument.id]);

  return {
    state,
    document,
    initialDraft: recoveredAtMount.current,
    conflictDraft,
    queueSave,
    retry,
    resolveConflict,
    markConflict
  };
}
