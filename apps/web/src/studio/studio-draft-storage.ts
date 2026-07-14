const STUDIO_DRAFT_PREFIX = "baase:studio:draft:";
const STUDIO_DRAFT_QUARANTINE_SUFFIX = ":quarantine";

export function studioDraftStorageKey(documentId: string) {
  return `${STUDIO_DRAFT_PREFIX}${documentId}`;
}

export function studioDraftQuarantineKey(documentId: string) {
  return `${studioDraftStorageKey(documentId)}${STUDIO_DRAFT_QUARANTINE_SUFFIX}`;
}

export function browserStudioStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function shouldDiscardStudioDraftQuarantine(raw: string, now = Date.now()) {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed.version !== 1
      || typeof parsed.expiresAt !== "number"
      || parsed.expiresAt <= now
      || typeof parsed.raw !== "string";
  } catch {
    return true;
  }
}

function isStudioDraftQuarantineKey(key: string) {
  return key.startsWith(STUDIO_DRAFT_PREFIX)
    && key.endsWith(STUDIO_DRAFT_QUARANTINE_SUFFIX)
    && key.length > STUDIO_DRAFT_PREFIX.length + STUDIO_DRAFT_QUARANTINE_SUFFIX.length;
}

export function sweepExpiredStudioDraftQuarantines(now = Date.now()) {
  let storage: Storage | null;
  const keys: string[] = [];
  try {
    storage = browserStudioStorage();
    if (!storage) return true;
    const length = storage.length;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (key && isStudioDraftQuarantineKey(key)) keys.push(key);
    }
  } catch {
    return false;
  }

  let succeeded = true;
  for (const key of keys) {
    try {
      const raw = storage.getItem(key);
      if (raw && shouldDiscardStudioDraftQuarantine(raw, now)) storage.removeItem(key);
    } catch {
      succeeded = false;
    }
  }
  return succeeded;
}
