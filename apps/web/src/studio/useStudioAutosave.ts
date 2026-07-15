import { useCallback, useEffect, useRef, useState } from "react";
import { StudioApiError } from "./studio-api";
import type { StudioDocument } from "./studio.types";
import { studioBodyText } from "./studio-editor-content";
import {
  browserStudioStorage,
  shouldDiscardStudioDraftQuarantine,
  studioDraftQuarantineKey,
  studioDraftStorageKey
} from "./studio-draft-storage";

export { studioDraftQuarantineKey, studioDraftStorageKey } from "./studio-draft-storage";

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
  | { kind: "invalid"; warning: string; quarantined: boolean; storageUnavailable: boolean }
  | { kind: "unavailable" };

type QueuedDraft = {
  documentId: string;
  envelope: StoredDraftEnvelope;
};

type AutosaveView = {
  document: StudioDocument;
  adoptedSourceRevision: number | null;
  initialDraft: StudioDocumentDraft | null;
  state: AutosaveState;
  conflictDraft: StudioDocumentDraft | null;
  currentDraft: StudioDocumentDraft | null;
  recoveryWarning: string | null;
  recoveryQuarantined: boolean;
  storageUnavailable: boolean;
};

const STORED_DRAFT_VERSION = 1;
const QUARANTINE_VERSION = 1;
const QUARANTINE_TTL_MS = 24 * 60 * 60 * 1_000;
const blockNodeTypes = new Set([
  "paragraph", "heading", "blockquote", "bulletList", "orderedList", "codeBlock", "horizontalRule"
]);
const inlineNodeTypes = new Set(["text", "hardBreak"]);
const simpleMarkTypes = new Set(["bold", "italic", "strike", "code", "underline"]);

function serializeDraft(draft: StudioDocumentDraft) {
  return JSON.stringify(draft);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function validNullableString(value: unknown) {
  return value === null || typeof value === "string";
}

function validAttrs(value: unknown, allowed: Record<string, (attribute: unknown) => boolean>) {
  if (!isRecord(value) || !hasOnlyKeys(value, Object.keys(allowed))) return false;
  return Object.entries(value).every(([key, attribute]) => allowed[key]?.(attribute) === true);
}

function validMark(value: unknown) {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (simpleMarkTypes.has(value.type)) return hasOnlyKeys(value, ["type"]);
  if (value.type !== "link" || !hasOnlyKeys(value, ["type", "attrs"])) return false;
  return isRecord(value.attrs)
    && typeof value.attrs.href === "string"
    && value.attrs.href.length > 0
    && validAttrs(value.attrs, {
      href: (attribute) => typeof attribute === "string" && attribute.length > 0,
      target: validNullableString,
      rel: validNullableString,
      class: validNullableString,
      title: validNullableString
    });
}

function validMarks(value: unknown) {
  return value === undefined || (Array.isArray(value) && value.every(validMark));
}

function validChildren(value: unknown, allowedTypes: Set<string>) {
  return value === undefined || (Array.isArray(value) && value.every((child) => (
    isRecord(child) && typeof child.type === "string" && allowedTypes.has(child.type) && validTipTapNode(child)
  )));
}

function validTipTapNode(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "doc":
      return hasOnlyKeys(value, ["type", "content"]) && validChildren(value.content, blockNodeTypes);
    case "paragraph":
      return hasOnlyKeys(value, ["type", "content"]) && validChildren(value.content, inlineNodeTypes);
    case "heading":
      return hasOnlyKeys(value, ["type", "attrs", "content"])
        && (value.attrs === undefined || validAttrs(value.attrs, {
          level: (attribute) => Number.isInteger(attribute) && (attribute as number) >= 1 && (attribute as number) <= 6
        }))
        && validChildren(value.content, inlineNodeTypes);
    case "text":
      return hasOnlyKeys(value, ["type", "text", "marks"])
        && typeof value.text === "string"
        && value.text.length > 0
        && validMarks(value.marks);
    case "hardBreak":
    case "horizontalRule":
      return hasOnlyKeys(value, ["type"]);
    case "blockquote":
      return hasOnlyKeys(value, ["type", "content"])
        && Array.isArray(value.content)
        && value.content.length > 0
        && validChildren(value.content, blockNodeTypes);
    case "bulletList":
      return hasOnlyKeys(value, ["type", "content"])
        && Array.isArray(value.content)
        && value.content.length > 0
        && validChildren(value.content, new Set(["listItem"]));
    case "orderedList":
      return hasOnlyKeys(value, ["type", "attrs", "content"])
        && (value.attrs === undefined || validAttrs(value.attrs, {
          start: (attribute) => Number.isInteger(attribute) && (attribute as number) >= 1,
          type: validNullableString
        }))
        && Array.isArray(value.content)
        && value.content.length > 0
        && validChildren(value.content, new Set(["listItem"]));
    case "listItem": {
      if (!hasOnlyKeys(value, ["type", "content"]) || !Array.isArray(value.content)) return false;
      const [first, ...rest] = value.content;
      return isRecord(first) && first.type === "paragraph" && validTipTapNode(first)
        && rest.every((child) => isRecord(child)
          && typeof child.type === "string"
          && blockNodeTypes.has(child.type)
          && validTipTapNode(child));
    }
    case "codeBlock":
      return hasOnlyKeys(value, ["type", "attrs", "content"])
        && (value.attrs === undefined || validAttrs(value.attrs, { language: validNullableString }))
        && validChildren(value.content, new Set(["text"]));
    default:
      return false;
  }
}

function parseDraft(value: unknown): StudioDocumentDraft | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["title", "bodyJson", "bodyText"])
    || (value.title !== null && typeof value.title !== "string")
    || typeof value.bodyText !== "string"
    || !validTipTapNode(value.bodyJson)
    || value.bodyJson.type !== "doc") return null;
  try {
    if (studioBodyText(value.bodyJson) !== value.bodyText) return null;
  } catch {
    return null;
  }
  return { title: value.title, bodyJson: value.bodyJson, bodyText: value.bodyText };
}

function parseEnvelope(value: unknown): StoredDraftEnvelope | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["version", "baseRevision", "generation", "signature", "draft"])
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

function purgeQuarantine(storage: Storage, documentId: string) {
  const key = studioDraftQuarantineKey(documentId);
  const raw = storage.getItem(key);
  if (!raw) return;
  if (shouldDiscardStudioDraftQuarantine(raw)) storage.removeItem(key);
}

function quarantineInvalidDraft(storage: Storage, documentId: string, raw: string) {
  const quarantinedAt = Date.now();
  try {
    storage.setItem(studioDraftQuarantineKey(documentId), JSON.stringify({
      version: QUARANTINE_VERSION,
      quarantinedAt,
      expiresAt: quarantinedAt + QUARANTINE_TTL_MS,
      raw
    }));
    return true;
  } catch {
    return false;
  }
}

function removeInvalidActiveDraft(storage: Storage, documentId: string) {
  try {
    storage.removeItem(studioDraftStorageKey(documentId));
    return true;
  } catch {
    return false;
  }
}

function invalidStoredDraft(storage: Storage, documentId: string, raw: string): StoredDraftRead {
  const quarantined = quarantineInvalidDraft(storage, documentId, raw);
  const activeRemoved = removeInvalidActiveDraft(storage, documentId);
  return {
    kind: "invalid",
    quarantined,
    storageUnavailable: !quarantined || !activeRemoved,
    warning: quarantined
      ? "Um rascunho local inválido foi isolado por até 24 horas."
      : "Um rascunho local inválido foi encontrado, mas não foi possível isolar uma cópia neste dispositivo."
  };
}

function readStoredDraft(documentId: string): StoredDraftRead {
  let storage: Storage | null;
  let raw: string | null;
  try {
    storage = browserStudioStorage();
    if (!storage) return { kind: "none" };
    purgeQuarantine(storage, documentId);
    raw = storage.getItem(studioDraftStorageKey(documentId));
  } catch {
    return { kind: "unavailable" };
  }
  if (!raw) return { kind: "none" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalidStoredDraft(storage, documentId, raw);
  }
  const envelope = parseEnvelope(parsed);
  if (!envelope) {
    return invalidStoredDraft(storage, documentId, raw);
  }
  try {
    storage.removeItem(studioDraftQuarantineKey(documentId));
  } catch {
    // The valid active draft remains usable even if an old quarantine cannot be purged.
  }
  return { kind: "valid", envelope };
}

function makeEnvelope(draft: StudioDocumentDraft, baseRevision: number, generation: number): StoredDraftEnvelope {
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
    const storage = browserStudioStorage();
    if (!storage) return false;
    storage.setItem(studioDraftStorageKey(documentId), JSON.stringify(envelope));
    storage.removeItem(studioDraftQuarantineKey(documentId));
    return true;
  } catch {
    return false;
  }
}

function clearMatchingStoredDraft(documentId: string, item: Pick<StoredDraftEnvelope, "signature" | "generation">) {
  try {
    const storage = browserStudioStorage();
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
    const storage = browserStudioStorage();
    if (!storage) return false;
    storage.removeItem(studioDraftStorageKey(documentId));
    return true;
  } catch {
    return false;
  }
}

function clearQuarantinedDraft(documentId: string) {
  try {
    const storage = browserStudioStorage();
    if (!storage) return false;
    storage.removeItem(studioDraftQuarantineKey(documentId));
    return true;
  } catch {
    return false;
  }
}

function recoveryView(sourceDocument: StudioDocument, recovery: StoredDraftRead): AutosaveView {
  const envelope = recovery.kind === "valid" ? recovery.envelope : null;
  const conflict = envelope !== null && envelope.baseRevision !== sourceDocument.revision;
  return {
    document: sourceDocument,
    adoptedSourceRevision: null,
    initialDraft: envelope?.draft ?? null,
    state: conflict ? "conflict" : envelope ? "dirty" : "saved",
    conflictDraft: conflict ? envelope?.draft ?? null : null,
    currentDraft: envelope?.draft ?? null,
    recoveryWarning: recovery.kind === "invalid" ? recovery.warning : null,
    recoveryQuarantined: recovery.kind === "invalid" && recovery.quarantined,
    storageUnavailable: recovery.kind === "unavailable"
      || (recovery.kind === "invalid" && recovery.storageUnavailable)
  };
}

function recoveredQueue(documentId: string, revision: number, recovery: StoredDraftRead): QueuedDraft | null {
  if (recovery.kind !== "valid" || recovery.envelope.baseRevision !== revision) return null;
  return { documentId, envelope: recovery.envelope };
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
  const [view, setView] = useState<AutosaveView>(() => recoveryView(sourceDocument, initialRecovery));
  const viewRef = useRef(view);
  const documentIdRef = useRef(sourceDocument.id);
  const revisionRef = useRef(sourceDocument.revision);
  const initialEnvelope = initialRecovery.kind === "valid" ? initialRecovery.envelope : null;
  const generationRef = useRef(initialEnvelope?.generation ?? 0);
  const saveRef = useRef(save);
  const queuedRef = useRef<QueuedDraft | null>(recoveredQueue(sourceDocument.id, sourceDocument.revision, initialRecovery));
  const retryRef = useRef<QueuedDraft | null>(queuedRef.current);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const initializedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const runNextRef = useRef<() => Promise<void>>(async () => undefined);

  saveRef.current = save;
  viewRef.current = view;

  const markStorageUnavailable = useCallback(() => {
    setView((current) => ({ ...current, storageUnavailable: true }));
  }, []);

  const markStorageAvailable = useCallback(() => {
    setView((current) => ({ ...current, storageUnavailable: false }));
  }, []);

  const runNext = useCallback(async () => {
    if (!mountedRef.current || savingRef.current || !queuedRef.current) return;
    const item = queuedRef.current;
    if (item.documentId !== documentIdRef.current) return;
    queuedRef.current = null;
    retryRef.current = item;
    savingRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setView((current) => ({ ...current, state: "saving" }));

    try {
      const savedDocument = await saveRef.current(
        item.envelope.draft,
        item.envelope.baseRevision,
        controller.signal
      );
      if (!mountedRef.current || controller.signal.aborted || item.documentId !== documentIdRef.current) return;
      revisionRef.current = savedDocument.revision;
      retryRef.current = null;
      const pending = queuedRef.current as QueuedDraft | null;
      let storageSucceeded: boolean;
      if (pending?.documentId === item.documentId) {
        const rebased = {
          ...pending,
          envelope: { ...pending.envelope, baseRevision: savedDocument.revision }
        };
        queuedRef.current = rebased;
        retryRef.current = rebased;
        storageSucceeded = writeStoredDraft(item.documentId, rebased.envelope);
      } else {
        storageSucceeded = clearMatchingStoredDraft(item.documentId, item.envelope);
      }
      if (storageSucceeded) markStorageAvailable();
      else markStorageUnavailable();
      setView((current) => ({
        ...current,
        document: savedDocument,
        adoptedSourceRevision: null,
        conflictDraft: null,
        currentDraft: queuedRef.current ? current.currentDraft : null,
        state: queuedRef.current ? "dirty" : "saved"
      }));
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || item.documentId !== documentIdRef.current) return;
      const freshest = queuedRef.current?.documentId === item.documentId ? queuedRef.current : item;
      queuedRef.current = null;
      retryRef.current = freshest;
      setView((current) => ({
        ...current,
        currentDraft: freshest.envelope.draft,
        conflictDraft: error instanceof StudioApiError && error.status === 409 ? freshest.envelope.draft : null,
        state: error instanceof StudioApiError && error.status === 409
          ? "conflict"
          : error instanceof TypeError ? "offline" : "error"
      }));
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        savingRef.current = false;
        if (mountedRef.current && queuedRef.current?.documentId === documentIdRef.current) await runNextRef.current();
      }
    }
  }, [markStorageAvailable, markStorageUnavailable]);
  runNextRef.current = runNext;

  const scheduleQueued = useCallback(() => {
    if (!queuedRef.current || queuedRef.current.documentId !== documentIdRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runNextRef.current();
    }, debounceMs);
  }, [debounceMs]);

  const queueSave = useCallback((draft: StudioDocumentDraft) => {
    const preserveConflict = viewRef.current.state === "conflict";
    generationRef.current += 1;
    const envelope = makeEnvelope(draft, revisionRef.current, generationRef.current);
    const queued = { documentId: documentIdRef.current, envelope };
    queuedRef.current = queued;
    retryRef.current = queued;
    const stored = writeStoredDraft(documentIdRef.current, envelope);
    if (stored) markStorageAvailable();
    else markStorageUnavailable();
    setView((current) => ({
      ...current,
      adoptedSourceRevision: null,
      currentDraft: draft,
      conflictDraft: preserveConflict ? draft : null,
      state: preserveConflict ? "conflict" : savingRef.current ? "saving" : "dirty"
    }));
    if (!savingRef.current && !preserveConflict) scheduleQueued();
  }, [markStorageAvailable, markStorageUnavailable, scheduleQueued]);

  const retry = useCallback(async () => {
    if (savingRef.current || !retryRef.current || retryRef.current.documentId !== documentIdRef.current) return;
    queuedRef.current = retryRef.current;
    setView((current) => ({ ...current, conflictDraft: null }));
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
    const cleared = !discardLocalDraft || clearStoredDraft(documentIdRef.current);
    if (cleared) markStorageAvailable();
    else markStorageUnavailable();
    setView((current) => ({
      ...current,
      document: serverDocument,
      adoptedSourceRevision: null,
      currentDraft: null,
      conflictDraft: null,
      state: "saved"
    }));
  }, [markStorageAvailable, markStorageUnavailable]);

  const markConflict = useCallback((draft: StudioDocumentDraft) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    generationRef.current += 1;
    const envelope = makeEnvelope(draft, revisionRef.current, generationRef.current);
    const queued = { documentId: documentIdRef.current, envelope };
    queuedRef.current = null;
    retryRef.current = queued;
    if (writeStoredDraft(documentIdRef.current, envelope)) markStorageAvailable();
    else markStorageUnavailable();
    setView((current) => ({
      ...current,
      adoptedSourceRevision: null,
      currentDraft: draft,
      conflictDraft: draft,
      state: "conflict"
    }));
  }, [markStorageAvailable, markStorageUnavailable]);

  const discardRecoveryWarning = useCallback(() => {
    if (!clearQuarantinedDraft(documentIdRef.current)) {
      markStorageUnavailable();
      return;
    }
    setView((current) => ({ ...current, recoveryWarning: null, recoveryQuarantined: false }));
  }, [markStorageUnavailable]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      scheduleQueued();
      return;
    }
    if (sourceDocument.id === documentIdRef.current) {
      if (sourceDocument.revision <= revisionRef.current) return;
      const current = viewRef.current;
      const localDraft = current.currentDraft
        ?? current.conflictDraft
        ?? queuedRef.current?.envelope.draft
        ?? retryRef.current?.envelope.draft
        ?? null;
      const hasLocalWork = localDraft !== null
        || savingRef.current
        || queuedRef.current !== null
        || retryRef.current !== null
        || !["idle", "saved"].includes(current.state);

      if (hasLocalWork) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        controllerRef.current?.abort();
        controllerRef.current = null;
        savingRef.current = false;
        queuedRef.current = null;
        setView((latest) => ({
          ...latest,
          adoptedSourceRevision: null,
          currentDraft: localDraft,
          conflictDraft: localDraft,
          state: "conflict"
        }));
        return;
      }

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      controllerRef.current?.abort();
      controllerRef.current = null;
      queuedRef.current = null;
      retryRef.current = null;
      revisionRef.current = sourceDocument.revision;
      generationRef.current += 1;
      const storageSucceeded = clearStoredDraft(sourceDocument.id);
      setView((latest) => ({
        ...latest,
        document: sourceDocument,
        adoptedSourceRevision: sourceDocument.revision,
        initialDraft: null,
        state: "saved",
        conflictDraft: null,
        currentDraft: null,
        storageUnavailable: !storageSucceeded
      }));
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    controllerRef.current?.abort();
    controllerRef.current = null;
    savingRef.current = false;

    const recovery = readStoredDraft(sourceDocument.id);
    const nextQueue = recoveredQueue(sourceDocument.id, sourceDocument.revision, recovery);
    documentIdRef.current = sourceDocument.id;
    revisionRef.current = sourceDocument.revision;
    generationRef.current = recovery.kind === "valid" ? recovery.envelope.generation : 0;
    queuedRef.current = nextQueue;
    retryRef.current = nextQueue;
    setView(recoveryView(sourceDocument, recovery));
    scheduleQueued();
  }, [scheduleQueued, sourceDocument.id, sourceDocument.revision]);

  return {
    ...view,
    queueSave,
    retry,
    resolveConflict,
    markConflict,
    discardRecoveryWarning
  };
}
