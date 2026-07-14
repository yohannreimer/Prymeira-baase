import { useCallback, useEffect, useRef, useState } from "react";
import { StudioApiError } from "./studio-api";
import type { StudioDocument } from "./studio.types";

export type AutosaveState = "idle" | "dirty" | "saving" | "saved" | "offline" | "conflict" | "error" | "storageUnavailable";

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

type StoredDraftEnvelope = {
  version: 1;
  baseRevision: number;
  generation: number;
  signature: string;
  draft: StudioDocumentDraft;
};

type StoredDraftRead =
  | { kind: "none" }
  | { kind: "valid"; envelope: StoredDraftEnvelope }
  | { kind: "invalid"; warning: string }
  | { kind: "unavailable"; warning: string };

type QueuedDraft = StoredDraftEnvelope;

const STORED_DRAFT_VERSION = 1;

export function studioDraftStorageKey(documentId: string) {
  return `baase:studio:draft:${documentId}`;
}

function serializeDraft(draft: StudioDocumentDraft) {
  return JSON.stringify(draft);
}

function browserStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTipTapNode(value: unknown, root = false): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (root && value.type !== "doc") return false;
  if ("text" in value && typeof value.text !== "string") return false;
  if ("content" in value && (!Array.isArray(value.content) || !value.content.every((node) => isTipTapNode(node)))) {
    return false;
  }
  return true;
}

function parseDraft(value: unknown): StudioDocumentDraft | null {
  if (!isRecord(value)
    || (value.title !== null && typeof value.title !== "string")
    || typeof value.bodyText !== "string"
    || !isTipTapNode(value.bodyJson, true)) return null;
  return { title: value.title, bodyJson: value.bodyJson, bodyText: value.bodyText };
}

function parseEnvelope(value: unknown): StoredDraftEnvelope | null {
  if (!isRecord(value)
    || value.version !== STORED_DRAFT_VERSION
    || !Number.isInteger(value.baseRevision)
    || (value.baseRevision as number) < 1
    || !Number.isInteger(value.generation)
    || (value.generation as number) < 0
    || typeof value.signature !== "string") return null;
  const draft = parseDraft(value.draft);
  if (!draft || value.signature !== serializeDraft(draft)) return null;
  return {
    version: STORED_DRAFT_VERSION,
    baseRevision: value.baseRevision as number,
    generation: value.generation as number,
    signature: value.signature,
    draft
  };
}

function discardInvalidDraft(storage: Storage, documentId: string, raw: string) {
  const key = studioDraftStorageKey(documentId);
  try {
    storage.setItem(`${key}:invalid:${Date.now()}`, raw);
  } catch {
    // Quarantine is best effort; the invalid active value must still be discarded.
  }
  try {
    storage.removeItem(key);
  } catch {
    // The warning remains visible even if the browser blocks cleanup.
  }
}

function readStoredDraft(documentId: string): StoredDraftRead {
  let storage: Storage | null;
  let raw: string | null;
  try {
    storage = browserStorage();
    raw = storage?.getItem(studioDraftStorageKey(documentId)) ?? null;
  } catch {
    return { kind: "unavailable", warning: "O armazenamento local está indisponível neste navegador." };
  }
  if (!raw || !storage) return { kind: "none" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    discardInvalidDraft(storage, documentId, raw);
    return { kind: "invalid", warning: "Um rascunho local inválido foi descartado com segurança." };
  }
  const envelope = parseEnvelope(parsed);
  if (!envelope) {
    discardInvalidDraft(storage, documentId, raw);
    return { kind: "invalid", warning: "Um rascunho local inválido foi descartado com segurança." };
  }
  return { kind: "valid", envelope };
}

function makeEnvelope(
  draft: StudioDocumentDraft,
  baseRevision: number,
  generation: number
): StoredDraftEnvelope {
  return {
    version: STORED_DRAFT_VERSION,
    baseRevision,
    generation,
    signature: serializeDraft(draft),
    draft
  };
}

function writeStoredDraft(documentId: string, envelope: StoredDraftEnvelope) {
  try {
    const storage = browserStorage();
    if (!storage) return false;
    storage.setItem(studioDraftStorageKey(documentId), JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

function clearMatchingStoredDraft(documentId: string, item: Pick<StoredDraftEnvelope, "signature" | "generation">) {
  try {
    const storage = browserStorage();
    if (!storage) return false;
    const raw = storage.getItem(studioDraftStorageKey(documentId));
    if (!raw) return true;
    const envelope = parseEnvelope(JSON.parse(raw));
    if (envelope?.signature === item.signature && envelope.generation === item.generation) {
      storage.removeItem(studioDraftStorageKey(documentId));
    }
    return true;
  } catch {
    return false;
  }
}

function clearStoredDraft(documentId: string) {
  try {
    const storage = browserStorage();
    if (!storage) return false;
    storage.removeItem(studioDraftStorageKey(documentId));
    return true;
  } catch {
    return false;
  }
}

function recoveryDraft(recovery: StoredDraftRead) {
  return recovery.kind === "valid" ? recovery.envelope.draft : null;
}

function recoveryWarning(recovery: StoredDraftRead) {
  return recovery.kind === "invalid" || recovery.kind === "unavailable" ? recovery.warning : null;
}

export function useStudioAutosave(
  sourceDocument: StudioDocument,
  save: SaveStudioDocument,
  options: { debounceMs?: number } = {}
) {
  const debounceMs = options.debounceMs ?? 700;
  const initialRecoveryRef = useRef<StoredDraftRead | null>(null);
  if (!initialRecoveryRef.current) initialRecoveryRef.current = readStoredDraft(sourceDocument.id);
  const initialRecovery = initialRecoveryRef.current;
  const recovered = initialRecovery.kind === "valid" ? initialRecovery.envelope : null;
  const recoveredConflicts = recovered !== null && recovered.baseRevision !== sourceDocument.revision;
  const initiallyUnavailable = initialRecovery.kind === "unavailable";

  const [document, setDocument] = useState(sourceDocument);
  const [initialDraft, setInitialDraft] = useState<StudioDocumentDraft | null>(() => recoveryDraft(initialRecovery));
  const [state, setState] = useState<AutosaveState>(() => (
    initiallyUnavailable ? "storageUnavailable" : recoveredConflicts ? "conflict" : recovered ? "dirty" : "saved"
  ));
  const [conflictDraft, setConflictDraft] = useState<StudioDocumentDraft | null>(() => (
    recoveredConflicts ? recovered?.draft ?? null : null
  ));
  const [warning, setRecoveryWarning] = useState<string | null>(() => recoveryWarning(initialRecovery));
  const [storageUnavailable, setStorageUnavailable] = useState(initiallyUnavailable);
  const [currentDraft, setCurrentDraft] = useState<StudioDocumentDraft | null>(() => recovered?.draft ?? null);
  const documentIdRef = useRef(sourceDocument.id);
  const revisionRef = useRef(sourceDocument.revision);
  const generationRef = useRef(recovered?.generation ?? 0);
  const storageUnavailableRef = useRef(initiallyUnavailable);
  const saveRef = useRef(save);
  const queuedRef = useRef<QueuedDraft | null>(null);
  const retryRef = useRef<QueuedDraft | null>(recovered && !recoveredConflicts ? recovered : null);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const runNextRef = useRef<() => Promise<void>>(async () => undefined);

  saveRef.current = save;

  const markStorageUnavailable = useCallback(() => {
    storageUnavailableRef.current = true;
    setStorageUnavailable(true);
    setState("storageUnavailable");
  }, []);

  const markStorageAvailable = useCallback(() => {
    storageUnavailableRef.current = false;
    setStorageUnavailable(false);
  }, []);

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
      retryRef.current = null;
      setConflictDraft(null);
      const pending = queuedRef.current as QueuedDraft | null;
      let storageSucceeded: boolean;
      if (pending) {
        const rebased: QueuedDraft = { ...pending, baseRevision: savedDocument.revision };
        queuedRef.current = rebased;
        retryRef.current = rebased;
        storageSucceeded = writeStoredDraft(documentIdRef.current, rebased);
      } else {
        storageSucceeded = clearMatchingStoredDraft(documentIdRef.current, item);
      }
      if (storageSucceeded) markStorageAvailable();
      else markStorageUnavailable();
      if (!queuedRef.current) setCurrentDraft(null);
      if (!storageUnavailableRef.current) setState(queuedRef.current ? "dirty" : "saved");
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted) return;
      const freshest = queuedRef.current ?? item;
      queuedRef.current = null;
      retryRef.current = freshest;
      setCurrentDraft(freshest.draft);
      if (error instanceof StudioApiError && error.status === 409) {
        setConflictDraft(freshest.draft);
        setState("conflict");
      } else if (storageUnavailableRef.current) {
        setState("storageUnavailable");
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
  }, [markStorageAvailable, markStorageUnavailable]);
  runNextRef.current = runNext;

  const queueSave = useCallback((draft: StudioDocumentDraft) => {
    generationRef.current += 1;
    const queued = makeEnvelope(draft, revisionRef.current, generationRef.current);
    queuedRef.current = queued;
    retryRef.current = queued;
    setCurrentDraft(draft);
    const stored = writeStoredDraft(documentIdRef.current, queued);
    if (!stored) markStorageUnavailable();
    else {
      markStorageAvailable();
      setState(savingRef.current ? "saving" : "dirty");
    }
    setConflictDraft(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!savingRef.current) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void runNextRef.current();
      }, debounceMs);
    }
  }, [debounceMs, markStorageAvailable, markStorageUnavailable]);

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
    generationRef.current += 1;
    setDocument(serverDocument);
    setCurrentDraft(null);
    setConflictDraft(null);
    let cleared = true;
    if (discardLocalDraft) cleared = clearStoredDraft(documentIdRef.current);
    if (!cleared) markStorageUnavailable();
    else {
      markStorageAvailable();
      setState("saved");
    }
  }, [markStorageAvailable, markStorageUnavailable]);

  const markConflict = useCallback((draft: StudioDocumentDraft) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    generationRef.current += 1;
    const envelope = makeEnvelope(draft, revisionRef.current, generationRef.current);
    queuedRef.current = null;
    retryRef.current = envelope;
    setCurrentDraft(draft);
    if (!writeStoredDraft(documentIdRef.current, envelope)) markStorageUnavailable();
    else markStorageAvailable();
    setConflictDraft(draft);
    setState("conflict");
  }, [markStorageAvailable, markStorageUnavailable]);

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
    const nextRecovery = readStoredDraft(sourceDocument.id);
    initialRecoveryRef.current = nextRecovery;
    const nextEnvelope = nextRecovery.kind === "valid" ? nextRecovery.envelope : null;
    const nextConflict = nextEnvelope !== null && nextEnvelope.baseRevision !== sourceDocument.revision;
    const unavailable = nextRecovery.kind === "unavailable";
    storageUnavailableRef.current = unavailable;
    setStorageUnavailable(unavailable);
    generationRef.current = nextEnvelope?.generation ?? 0;
    queuedRef.current = null;
    retryRef.current = nextEnvelope && !nextConflict ? nextEnvelope : null;
    setDocument(sourceDocument);
    setInitialDraft(nextEnvelope?.draft ?? null);
    setCurrentDraft(nextEnvelope?.draft ?? null);
    setConflictDraft(nextConflict ? nextEnvelope?.draft ?? null : null);
    setRecoveryWarning(recoveryWarning(nextRecovery));
    setState(unavailable ? "storageUnavailable" : nextConflict ? "conflict" : nextEnvelope ? "dirty" : "saved");
    if (nextEnvelope && !nextConflict) {
      queuedRef.current = nextEnvelope;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void runNextRef.current();
      }, debounceMs);
    }
  }, [debounceMs, sourceDocument, sourceDocument.id]);

  useEffect(() => {
    if (!recovered || recoveredConflicts) return;
    queuedRef.current = recovered;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runNextRef.current();
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Recovery is intentionally evaluated once for this document identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceDocument.id]);

  return {
    state,
    document,
    initialDraft,
    conflictDraft,
    currentDraft,
    recoveryWarning: warning,
    storageUnavailable,
    queueSave,
    retry,
    resolveConflict,
    markConflict
  };
}
