export type StudioCheckpointSnapshot = {
  revision: number;
  title?: string | null;
  bodyJson?: Record<string, unknown>;
  bodyText: string;
};

type StudioCheckpointPolicyOptions = {
  pauseMs: number;
  minimumChangedCharacters: number;
};

function normalizeBodyText(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => [key, stableValue(item)]));
}

function documentSignature(snapshot: StudioCheckpointSnapshot) {
  return JSON.stringify({
    title: snapshot.title ?? null,
    bodyJson: stableValue(snapshot.bodyJson ?? null),
    bodyText: snapshot.bodyText
  });
}

function changedCharacterCount(previous: string, next: string) {
  const left = Array.from(normalizeBodyText(previous));
  const right = Array.from(normalizeBodyText(next));
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < left.length - prefix
    && suffix < right.length - prefix
    && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) suffix += 1;

  return (left.length - prefix - suffix) + (right.length - prefix - suffix);
}

export function createCheckpointPolicy(options: StudioCheckpointPolicyOptions) {
  let checkpoint: StudioCheckpointSnapshot | null = null;
  let latestSaved: StudioCheckpointSnapshot | null = null;
  let significantPause: { snapshot: StudioCheckpointSnapshot; savedAt: number } | null = null;

  const isMeaningful = (snapshot: StudioCheckpointSnapshot) => changedCharacterCount(
    checkpoint?.bodyText ?? "",
    snapshot.bodyText
  ) >= options.minimumChangedCharacters;
  const pendingExit = () => latestSaved
    && (!checkpoint || documentSignature(latestSaved) !== documentSignature(checkpoint))
    ? { ...latestSaved }
    : null;

  return {
    recordSaved(snapshot: StudioCheckpointSnapshot, savedAt: number) {
      latestSaved = { ...snapshot };
      significantPause = isMeaningful(snapshot) ? { snapshot: { ...snapshot }, savedAt } : null;
    },

    dueAt(now: number) {
      return significantPause !== null && now - significantPause.savedAt >= options.pauseMs;
    },

    pendingAt(now: number) {
      return significantPause !== null && now - significantPause.savedAt >= options.pauseMs
        ? { ...significantPause.snapshot }
        : null;
    },

    pendingForExit() {
      return pendingExit();
    },

    significantPausePending() {
      return significantPause !== null;
    },

    consumeAt(now: number) {
      const snapshot = significantPause !== null && now - significantPause.savedAt >= options.pauseMs
        ? { ...significantPause.snapshot }
        : null;
      if (snapshot) significantPause = null;
      return snapshot;
    },

    consumeForExit() {
      return pendingExit();
    },

    cancelPending() {
      significantPause = null;
    },

    recordCheckpoint(_checkpointedAt: number, completedSnapshot?: StudioCheckpointSnapshot) {
      const snapshot = completedSnapshot ?? significantPause?.snapshot ?? latestSaved;
      if (snapshot && (!checkpoint || snapshot.revision >= checkpoint.revision)) checkpoint = { ...snapshot };
      if (!significantPause || (snapshot && significantPause.snapshot.revision <= snapshot.revision)) {
        significantPause = null;
      }
    }
  };
}
