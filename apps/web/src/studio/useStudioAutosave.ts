import { useCallback, useEffect, useRef, useState } from "react";
import { StudioApiError } from "./studio-api";
import type { StudioCheckpointReason, StudioDocument, StudioDocumentVersion } from "./studio.types";
import { createCheckpointPolicy, type StudioCheckpointSnapshot } from "./studio-checkpoint-policy";
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

export type CheckpointStudioDocument = (
  expectedRevision: number,
  reason: Extract<StudioCheckpointReason, "significant_pause" | "document_exit">,
  signal?: AbortSignal
) => Promise<unknown>;

export type CheckpointStudioDocumentExit = (
  knownRevision: number
) => Promise<{ document: StudioDocument; version: StudioDocumentVersion }>;

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

type RetryDisposition = "automatic" | "conflict" | null;

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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
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

function draftMatchesDocument(draft: StudioDocumentDraft, document: StudioDocument) {
  return draft.title === document.title
    && draft.bodyText === document.bodyText
    && canonicalJson(draft.bodyJson) === canonicalJson(document.bodyJson);
}

function recoveryView(sourceDocument: StudioDocument, recovery: StoredDraftRead): AutosaveView {
  const envelope = recovery.kind === "valid" ? recovery.envelope : null;
  const alreadySaved = envelope !== null && envelope.baseRevision < sourceDocument.revision
    && draftMatchesDocument(envelope.draft, sourceDocument);
  const conflict = envelope !== null && envelope.baseRevision !== sourceDocument.revision && !alreadySaved;
  return {
    document: sourceDocument,
    adoptedSourceRevision: null,
    initialDraft: envelope?.draft ?? null,
    state: conflict ? "conflict" : envelope && !alreadySaved ? "dirty" : "saved",
    conflictDraft: conflict ? envelope?.draft ?? null : null,
    currentDraft: alreadySaved ? null : envelope?.draft ?? null,
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

function checkpointSnapshot(document: StudioDocument): StudioCheckpointSnapshot {
  return {
    revision: document.revision,
    title: document.title,
    bodyJson: document.bodyJson,
    bodyText: document.bodyText
  };
}

function newestQueuedDraft(...items: Array<QueuedDraft | null>) {
  return items.reduce<QueuedDraft | null>((newest, item) => (
    item && (!newest || item.envelope.generation > newest.envelope.generation) ? item : newest
  ), null);
}

export function useStudioAutosave(
  sourceDocument: StudioDocument,
  save: SaveStudioDocument,
  options: {
    debounceMs?: number;
    checkpoint?: CheckpointStudioDocument;
    exitCheckpoint?: CheckpointStudioDocumentExit;
  } = {}
) {
  const debounceMs = options.debounceMs ?? 700;
  const checkpointRef = useRef(options.checkpoint);
  const exitCheckpointRef = useRef(options.exitCheckpoint);
  const checkpointPolicyRef = useRef<ReturnType<typeof createCheckpointPolicy> | null>(null);
  if (!checkpointPolicyRef.current) {
    checkpointPolicyRef.current = createCheckpointPolicy({ pauseMs: 30_000, minimumChangedCharacters: 20 });
    checkpointPolicyRef.current.recordSaved(checkpointSnapshot(sourceDocument), Date.now());
    checkpointPolicyRef.current.recordCheckpoint(Date.now());
  }
  const initialRecoveryRef = useRef<StoredDraftRead | null>(null);
  if (!initialRecoveryRef.current) initialRecoveryRef.current = readStoredDraft(sourceDocument.id);
  const initialRecovery = initialRecoveryRef.current;
  const [view, setView] = useState<AutosaveView>(() => recoveryView(sourceDocument, initialRecovery));
  const viewRef = useRef(view);
  const retryDispositionRef = useRef<RetryDisposition>(view.state === "conflict" ? "conflict" : null);
  const documentIdRef = useRef(sourceDocument.id);
  const revisionRef = useRef(sourceDocument.revision);
  const initialEnvelope = initialRecovery.kind === "valid" ? initialRecovery.envelope : null;
  const initialOutboxDurableRevision = initialEnvelope
    && initialEnvelope.baseRevision < sourceDocument.revision
    && draftMatchesDocument(initialEnvelope.draft, sourceDocument)
    ? sourceDocument.revision
    : null;
  const generationRef = useRef(initialEnvelope?.generation ?? 0);
  const saveRef = useRef(save);
  const queuedRef = useRef<QueuedDraft | null>(recoveredQueue(sourceDocument.id, sourceDocument.revision, initialRecovery));
  const retryRef = useRef<QueuedDraft | null>(queuedRef.current);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const initializedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const activeSaveRef = useRef<QueuedDraft | null>(null);
  const exitOutboxRef = useRef<QueuedDraft | null>(initialEnvelope ? {
    documentId: sourceDocument.id,
    envelope: initialEnvelope
  } : null);
  const exitOutboxDurableRevisionRef = useRef<number | null>(initialOutboxDurableRevision);
  const checkpointTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkpointControllerRef = useRef<AbortController | null>(null);
  const checkpointInFlightRef = useRef<StudioCheckpointSnapshot | null>(null);
  const checkpointedRevisionRef = useRef(sourceDocument.revision);
  const exitCheckpointsInFlightRef = useRef(new Map<number, StudioCheckpointSnapshot>());
  const exitCheckpointRetryRef = useRef<StudioCheckpointSnapshot | null>(null);
  const exitSaveInFlightRef = useRef<{
    documentId: string;
    generation: number;
    knownRevision: number;
  } | null>(null);
  const runNextRef = useRef<() => Promise<void>>(async () => undefined);

  saveRef.current = save;
  checkpointRef.current = options.checkpoint;
  exitCheckpointRef.current = options.exitCheckpoint;
  viewRef.current = view;

  const cancelCheckpointWork = useCallback(() => {
    if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
    checkpointTimerRef.current = null;
    checkpointControllerRef.current?.abort();
    checkpointControllerRef.current = null;
    checkpointInFlightRef.current = null;
  }, []);

  const runCheckpoint = useCallback((candidate: StudioCheckpointSnapshot, reason: "significant_pause" | "document_exit") => {
    const checkpoint = checkpointRef.current;
    if (!checkpoint) return;
    const checkpointDocumentId = documentIdRef.current;

    if (reason === "document_exit") {
      if (candidate.revision <= checkpointedRevisionRef.current) return;
      const inFlightRevisions = [...exitCheckpointsInFlightRef.current.keys()];
      if (inFlightRevisions.some((revision) => revision >= candidate.revision)) return;
      exitCheckpointsInFlightRef.current.set(candidate.revision, candidate);
      void checkpoint(candidate.revision, reason, undefined).then(() => {
        if (documentIdRef.current !== checkpointDocumentId) return;
        checkpointedRevisionRef.current = Math.max(checkpointedRevisionRef.current, candidate.revision);
        checkpointPolicyRef.current?.recordCheckpoint(Date.now(), candidate);
        if ((exitCheckpointRetryRef.current?.revision ?? -1) <= candidate.revision) {
          exitCheckpointRetryRef.current = null;
        }
      }).catch(() => {
        if (documentIdRef.current !== checkpointDocumentId) return;
        if (candidate.revision > checkpointedRevisionRef.current
          && (exitCheckpointRetryRef.current?.revision ?? -1) <= candidate.revision) {
          exitCheckpointRetryRef.current = candidate;
        }
      }).finally(() => {
        if (documentIdRef.current !== checkpointDocumentId) return;
        if (exitCheckpointsInFlightRef.current.get(candidate.revision) === candidate) {
          exitCheckpointsInFlightRef.current.delete(candidate.revision);
        }
      });
      return;
    }

    const controller = new AbortController();
    checkpointControllerRef.current = controller;
    checkpointInFlightRef.current = candidate;
    void checkpoint(candidate.revision, reason, controller.signal).then(() => {
      if (!controller.signal.aborted && documentIdRef.current === checkpointDocumentId) {
        checkpointedRevisionRef.current = Math.max(checkpointedRevisionRef.current, candidate.revision);
        checkpointPolicyRef.current?.recordCheckpoint(Date.now(), candidate);
      }
    }).catch(() => undefined).finally(() => {
      if (documentIdRef.current === checkpointDocumentId && checkpointControllerRef.current === controller) {
        checkpointControllerRef.current = null;
        checkpointInFlightRef.current = null;
      }
    });
  }, []);

  const recordCompletedSave = useCallback((savedDocument: StudioDocument, scheduleSignificantPause: boolean) => {
    cancelCheckpointWork();
    const policy = checkpointPolicyRef.current;
    if (!checkpointRef.current || !policy) return;
    policy.recordSaved(checkpointSnapshot(savedDocument), Date.now());
    if (!scheduleSignificantPause || !policy.significantPausePending()) return;
    checkpointTimerRef.current = setTimeout(() => {
      checkpointTimerRef.current = null;
      const candidate = policy.consumeAt(Date.now());
      if (candidate) runCheckpoint(candidate, "significant_pause");
    }, 30_000);
  }, [cancelCheckpointWork, runCheckpoint]);

  const requestExitCheckpoint = useCallback((knownRevision: number, item: QueuedDraft | null, clearOutbox: boolean) => {
    const exitCheckpoint = exitCheckpointRef.current;
    const documentId = documentIdRef.current;
    if (!exitCheckpoint) return false;
    if (!item && knownRevision <= checkpointedRevisionRef.current) return true;
    const generation = item?.envelope.generation ?? -1;
    const existing = exitSaveInFlightRef.current;
    if (existing?.documentId === documentId && existing.generation >= generation
      && existing.knownRevision >= knownRevision) return true;
    const operation = { documentId, generation, knownRevision };
    exitSaveInFlightRef.current = operation;
    void exitCheckpoint(knownRevision).then(({ document, version }) => {
      if (documentIdRef.current !== operation.documentId || exitSaveInFlightRef.current !== operation) return;
      const shouldAdoptDocument = document.revision > viewRef.current.document.revision;
      if (document.revision > revisionRef.current) revisionRef.current = document.revision;
      checkpointedRevisionRef.current = Math.max(checkpointedRevisionRef.current, document.revision);
      const snapshot = checkpointSnapshot(document);
      checkpointPolicyRef.current?.recordSaved(snapshot, Date.now());
      checkpointPolicyRef.current?.recordCheckpoint(Date.now(), snapshot);
      let outboxMismatch = false;
      if (clearOutbox && item && exitOutboxRef.current?.documentId === operation.documentId
        && exitOutboxRef.current.envelope.generation === operation.generation
        && document.revision >= knownRevision) {
        if (draftMatchesDocument(item.envelope.draft, document)) {
          const cleared = clearMatchingStoredDraft(operation.documentId, item.envelope);
          if (cleared) {
            exitOutboxRef.current = null;
            exitOutboxDurableRevisionRef.current = null;
          } else if (mountedRef.current) {
            setView((current) => ({ ...current, storageUnavailable: true }));
          }
        } else {
          outboxMismatch = true;
          retryDispositionRef.current = "conflict";
        }
      }

      if (outboxMismatch && item && mountedRef.current) {
        setView((current) => ({
          ...current,
          document,
          currentDraft: item.envelope.draft,
          conflictDraft: item.envelope.draft,
          state: "conflict"
        }));
      } else if (shouldAdoptDocument) {
        const newerLocal = newestQueuedDraft(
          queuedRef.current,
          activeSaveRef.current,
          retryRef.current
        );
        const localToRebase = newerLocal?.documentId === operation.documentId
          && newerLocal.envelope.generation > operation.generation ? newerLocal : null;
        let rebased: QueuedDraft | null = null;
        let restartSave = false;
        let storageSucceeded = true;
        if (localToRebase) {
          restartSave = activeSaveRef.current?.documentId === operation.documentId
            && activeSaveRef.current.envelope.generation > operation.generation;
          if (restartSave) {
            controllerRef.current?.abort();
            controllerRef.current = null;
            activeSaveRef.current = null;
            savingRef.current = false;
          }
          rebased = {
            ...localToRebase,
            envelope: { ...localToRebase.envelope, baseRevision: document.revision }
          };
          queuedRef.current = rebased;
          retryRef.current = rebased;
          storageSucceeded = writeStoredDraft(operation.documentId, rebased.envelope);
        }
        if (mountedRef.current) {
          setView((current) => ({
            ...current,
            document,
            adoptedSourceRevision: null,
            currentDraft: rebased?.envelope.draft ?? current.currentDraft,
            conflictDraft: current.state === "conflict" ? current.conflictDraft : null,
            state: current.state === "conflict" ? "conflict" : rebased ? "dirty" : current.state,
            storageUnavailable: storageSucceeded ? current.storageUnavailable : true
          }));
        }
        if (rebased && retryDispositionRef.current !== "conflict") void runNextRef.current();
      }
      void version;
    }).catch(() => undefined).finally(() => {
      if (exitSaveInFlightRef.current !== operation) return;
      exitSaveInFlightRef.current = null;
    });
    return true;
  }, []);

  const checkpointOnExit = useCallback(() => {
    const pending = queuedRef.current ?? activeSaveRef.current ?? retryRef.current;
    if (pending?.documentId === documentIdRef.current) {
      if (exitOutboxRef.current?.envelope.generation !== pending.envelope.generation) {
        exitOutboxDurableRevisionRef.current = null;
      }
      exitOutboxRef.current = pending;
    }
    const item = pending ?? exitOutboxRef.current;
    cancelCheckpointWork();
    const durableRevision = item === exitOutboxRef.current ? exitOutboxDurableRevisionRef.current : null;
    if (requestExitCheckpoint(durableRevision ?? revisionRef.current, item ?? null, durableRevision !== null)) return;
    const candidate = checkpointPolicyRef.current?.pendingForExit() ?? null;
    if (candidate) runCheckpoint(candidate, "document_exit");
  }, [cancelCheckpointWork, requestExitCheckpoint, runCheckpoint]);

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
    activeSaveRef.current = item;
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
      retryDispositionRef.current = null;
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
        const awaitingExitCheckpoint = exitOutboxRef.current?.documentId === item.documentId
          && exitOutboxRef.current.envelope.generation === item.envelope.generation;
        storageSucceeded = awaitingExitCheckpoint
          ? true
          : clearMatchingStoredDraft(item.documentId, item.envelope);
        if (awaitingExitCheckpoint) {
          exitOutboxDurableRevisionRef.current = savedDocument.revision;
          requestExitCheckpoint(savedDocument.revision, item, true);
        }
      }
      recordCompletedSave(savedDocument, pending?.documentId !== item.documentId);
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
      const isConflict = error instanceof StudioApiError && error.status === 409;
      retryDispositionRef.current = isConflict ? "conflict" : "automatic";
      queuedRef.current = null;
      retryRef.current = freshest;
      setView((current) => ({
        ...current,
        currentDraft: freshest.envelope.draft,
        conflictDraft: isConflict ? freshest.envelope.draft : null,
        state: isConflict
          ? "conflict"
          : error instanceof TypeError ? "offline" : "error"
      }));
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        savingRef.current = false;
        activeSaveRef.current = null;
        if (mountedRef.current && queuedRef.current?.documentId === documentIdRef.current) await runNextRef.current();
      }
    }
  }, [markStorageAvailable, markStorageUnavailable, recordCompletedSave, requestExitCheckpoint]);
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
    cancelCheckpointWork();
    checkpointPolicyRef.current?.cancelPending();
    const preserveConflict = viewRef.current.state === "conflict";
    if (!preserveConflict) retryDispositionRef.current = null;
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
  }, [cancelCheckpointWork, markStorageAvailable, markStorageUnavailable, scheduleQueued]);

  const retry = useCallback(async () => {
    if (savingRef.current || !retryRef.current || retryRef.current.documentId !== documentIdRef.current) return;
    retryDispositionRef.current = null;
    queuedRef.current = retryRef.current;
    setView((current) => ({ ...current, conflictDraft: null }));
    await runNextRef.current();
  }, []);

  const resolveConflict = useCallback((serverDocument: StudioDocument, discardLocalDraft: boolean) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    controllerRef.current?.abort();
    controllerRef.current = null;
    activeSaveRef.current = null;
    queuedRef.current = null;
    retryRef.current = null;
    exitOutboxRef.current = null;
    exitOutboxDurableRevisionRef.current = null;
    exitSaveInFlightRef.current = null;
    retryDispositionRef.current = null;
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
    retryDispositionRef.current = "conflict";
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
    const handlePageHide = () => checkpointOnExit();
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      checkpointOnExit();
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      controllerRef.current?.abort();
    };
  }, [checkpointOnExit]);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      if (initialEnvelope && initialEnvelope.baseRevision < sourceDocument.revision
        && draftMatchesDocument(initialEnvelope.draft, sourceDocument)) {
        requestExitCheckpoint(sourceDocument.revision, {
          documentId: sourceDocument.id,
          envelope: initialEnvelope
        }, true);
      }
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
        retryDispositionRef.current = "conflict";
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
      retryDispositionRef.current = null;
      revisionRef.current = sourceDocument.revision;
      checkpointedRevisionRef.current = sourceDocument.revision;
      exitCheckpointsInFlightRef.current.clear();
      exitCheckpointRetryRef.current = null;
      exitSaveInFlightRef.current = null;
      exitOutboxRef.current = null;
      exitOutboxDurableRevisionRef.current = null;
      cancelCheckpointWork();
      checkpointPolicyRef.current = createCheckpointPolicy({ pauseMs: 30_000, minimumChangedCharacters: 20 });
      checkpointPolicyRef.current.recordSaved(checkpointSnapshot(sourceDocument), Date.now());
      checkpointPolicyRef.current.recordCheckpoint(Date.now());
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
    checkpointedRevisionRef.current = sourceDocument.revision;
    exitCheckpointsInFlightRef.current.clear();
    exitCheckpointRetryRef.current = null;
    exitSaveInFlightRef.current = null;
    cancelCheckpointWork();
    checkpointPolicyRef.current = createCheckpointPolicy({ pauseMs: 30_000, minimumChangedCharacters: 20 });
    checkpointPolicyRef.current.recordSaved(checkpointSnapshot(sourceDocument), Date.now());
    checkpointPolicyRef.current.recordCheckpoint(Date.now());
    generationRef.current = recovery.kind === "valid" ? recovery.envelope.generation : 0;
    queuedRef.current = nextQueue;
    retryRef.current = nextQueue;
    retryDispositionRef.current = recoveryView(sourceDocument, recovery).state === "conflict" ? "conflict" : null;
    exitOutboxRef.current = recovery.kind === "valid" ? {
      documentId: sourceDocument.id,
      envelope: recovery.envelope
    } : null;
    exitOutboxDurableRevisionRef.current = recovery.kind === "valid"
      && recovery.envelope.baseRevision < sourceDocument.revision
      && draftMatchesDocument(recovery.envelope.draft, sourceDocument)
      ? sourceDocument.revision
      : null;
    setView(recoveryView(sourceDocument, recovery));
    if (recovery.kind === "valid" && recovery.envelope.baseRevision < sourceDocument.revision
      && draftMatchesDocument(recovery.envelope.draft, sourceDocument)) {
      requestExitCheckpoint(sourceDocument.revision, exitOutboxRef.current, true);
    }
    scheduleQueued();
  }, [cancelCheckpointWork, initialEnvelope, requestExitCheckpoint, scheduleQueued, sourceDocument.bodyText, sourceDocument.id, sourceDocument.revision]);

  return {
    ...view,
    queueSave,
    retry,
    resolveConflict,
    markConflict,
    discardRecoveryWarning
  };
}
