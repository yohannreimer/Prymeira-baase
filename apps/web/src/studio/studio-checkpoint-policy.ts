export type StudioCheckpointSnapshot = {
  revision: number;
  bodyText: string;
};

type StudioCheckpointPolicyOptions = {
  pauseMs: number;
  minimumChangedCharacters: number;
};

function normalizeBodyText(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
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
  let pending: { snapshot: StudioCheckpointSnapshot; savedAt: number } | null = null;

  const isMeaningful = (snapshot: StudioCheckpointSnapshot) => changedCharacterCount(
    checkpoint?.bodyText ?? "",
    snapshot.bodyText
  ) >= options.minimumChangedCharacters;

  return {
    recordSaved(snapshot: StudioCheckpointSnapshot, savedAt: number) {
      latestSaved = { ...snapshot };
      pending = isMeaningful(snapshot) ? { snapshot: { ...snapshot }, savedAt } : null;
    },

    dueAt(now: number) {
      return pending !== null && now - pending.savedAt >= options.pauseMs;
    },

    pendingAt(now: number) {
      return pending !== null && now - pending.savedAt >= options.pauseMs
        ? { ...pending.snapshot }
        : null;
    },

    pendingForExit() {
      return pending ? { ...pending.snapshot } : null;
    },

    consumeAt(now: number) {
      const snapshot = pending !== null && now - pending.savedAt >= options.pauseMs
        ? { ...pending.snapshot }
        : null;
      if (snapshot) pending = null;
      return snapshot;
    },

    consumeForExit() {
      const snapshot = pending ? { ...pending.snapshot } : null;
      pending = null;
      return snapshot;
    },

    cancelPending() {
      pending = null;
    },

    recordCheckpoint(_checkpointedAt: number, completedSnapshot?: StudioCheckpointSnapshot) {
      const snapshot = completedSnapshot ?? pending?.snapshot ?? latestSaved;
      if (snapshot) checkpoint = { ...snapshot };
      pending = null;
    }
  };
}
