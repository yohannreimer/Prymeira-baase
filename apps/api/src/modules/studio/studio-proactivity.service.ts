import { randomUUID } from "node:crypto";
import type { StudioOwnerScope } from "./studio.types";

export const STUDIO_PROACTIVITY_SIGNAL_TYPES = [
  "ritual_reminder",
  "stale_goal",
  "recurring_theme",
  "decision_review",
  "operational_change",
  "focused_content"
] as const;

export type StudioProactivitySignalType = typeof STUDIO_PROACTIVITY_SIGNAL_TYPES[number];

export type StudioProactivityToggles = {
  ritualReminder: boolean;
  staleGoal: boolean;
  recurringTheme: boolean;
  decisionReview: boolean;
  operationalChange: boolean;
  focusedContent: boolean;
};

export const STUDIO_PROACTIVITY_DEFAULT_SETTINGS: StudioProactivityToggles & { staleGoalAfterDays: number } = {
  ritualReminder: false,
  staleGoal: false,
  recurringTheme: false,
  decisionReview: false,
  operationalChange: false,
  focusedContent: false,
  staleGoalAfterDays: 30
};

export type StudioProactivitySettings = StudioOwnerScope & StudioProactivityToggles & {
  staleGoalAfterDays: number;
  updatedAt: string;
};

export type StudioProactiveSignal = StudioOwnerScope & {
  id: string;
  type: StudioProactivitySignalType;
  sourceId: string;
  sourceScheduledFor: string;
  title: string;
  reason: string;
  status: "active" | "dismissed";
  nextReminderAt: string;
  createdAt: string;
  updatedAt: string;
  dismissedAt: string | null;
};

export type StudioDueRitual = StudioOwnerScope & {
  ritualId: string;
  title: string;
  scheduledFor: string;
};

export type StudioDueRitualClaim = StudioDueRitual & {
  claimToken: string;
  attemptCount: number;
};

export type StudioProactivityStore = {
  readSettings(scope: StudioOwnerScope): Promise<StudioProactivitySettings | null>;
  saveSettings(settings: StudioProactivitySettings): Promise<StudioProactivitySettings>;
  claimDueRituals(input: {
    now: string;
    limit: number;
    claimToken: string;
    claimLeaseExpiresAt: string;
  }): Promise<StudioDueRitualClaim[]>;
  completeRitualPreparation(input: {
    claim: StudioDueRitualClaim;
    title: string;
    reason: string;
    now: string;
  }): Promise<StudioProactiveSignal>;
  failRitualPreparation(input: {
    claim: StudioDueRitualClaim;
    nextAttemptAt: string;
    errorCode: string;
    now: string;
  }): Promise<void>;
  listSignals(scope: StudioOwnerScope, input: { now: string; limit: number }): Promise<StudioProactiveSignal[]>;
  findSignal(scope: StudioOwnerScope, signalId: string): Promise<StudioProactiveSignal | null>;
  updateSignal(signal: StudioProactiveSignal): Promise<StudioProactiveSignal>;
  readPortabilityRows?(scope: StudioOwnerScope): Promise<{
    settings: StudioProactivitySettings | null;
    signals: StudioProactiveSignal[];
  }>;
  deleteOwnerData?(scope: StudioOwnerScope): Promise<void>;
};

type RitualSessionStarter = {
  startSession(scope: StudioOwnerScope, ritualId: string): Promise<{ status: string }>;
};

export function createStudioProactivityService(options: {
  store: StudioProactivityStore;
  ritualService: RitualSessionStarter;
  now?: () => Date;
}) {
  const clock = options.now ?? (() => new Date());

  return {
    async readSettings(scope: StudioOwnerScope): Promise<StudioProactivitySettings> {
      return await options.store.readSettings(scope) ?? defaultSettings(scope, timestamp(clock));
    },

    async updateSettings(
      scope: StudioOwnerScope,
      input: Partial<StudioProactivityToggles & { staleGoalAfterDays: number }>
    ): Promise<StudioProactivitySettings> {
      const current = await options.store.readSettings(scope) ?? defaultSettings(scope, timestamp(clock));
      const staleGoalAfterDays = input.staleGoalAfterDays ?? current.staleGoalAfterDays;
      if (!Number.isInteger(staleGoalAfterDays) || staleGoalAfterDays < 1 || staleGoalAfterDays > 3_650) {
        throw new Error("STUDIO_PROACTIVITY_STALE_GOAL_DAYS_INVALID");
      }
      return options.store.saveSettings({
        ...current,
        ...definedToggles(input),
        staleGoalAfterDays,
        updatedAt: timestamp(clock)
      });
    },

    async runDuePreparations(at: Date, limit: number) {
      const validNow = validDate(at);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("STUDIO_PROACTIVITY_LIMIT_INVALID");
      }
      const nowIso = validNow.toISOString();
      const claims = await options.store.claimDueRituals({
        now: nowIso,
        limit,
        claimToken: randomUUID(),
        claimLeaseExpiresAt: new Date(validNow.getTime() + 2 * 60_000).toISOString()
      });
      let prepared = 0;
      let failed = 0;
      for (const claim of claims) {
        try {
          const session = await options.ritualService.startSession(scopeOf(claim), claim.ritualId);
          if (!["ready", "in_progress", "completed"].includes(session.status)) {
            throw new Error("STUDIO_RITUAL_PREPARATION_NOT_READY");
          }
          const signal = await options.store.completeRitualPreparation({
            claim,
            title: `${claim.title} pronta para você`,
            reason: "Este sinal apareceu porque você habilitou lembretes de ritual e chegou o horário configurado.",
            now: nowIso
          });
          if (signal.status === "active") prepared += 1;
        } catch (error) {
          failed += 1;
          await options.store.failRitualPreparation({
            claim,
            nextAttemptAt: new Date(validNow.getTime() + retryDelayMs(claim.attemptCount)).toISOString(),
            errorCode: errorCode(error),
            now: nowIso
          });
        }
      }
      return { claimed: claims.length, prepared, failed };
    },

    listSignals(scope: StudioOwnerScope, limit: number, at: Date = clock()) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("STUDIO_PROACTIVITY_LIMIT_INVALID");
      }
      return options.store.listSignals(scope, { now: validDate(at).toISOString(), limit });
    },

    async snoozeSignal(scope: StudioOwnerScope, signalId: string, until: string) {
      const signal = await requireSignal(options.store, scope, signalId);
      const nextReminderAt = validIso(until, "STUDIO_PROACTIVE_SIGNAL_SNOOZE_INVALID");
      if (Date.parse(nextReminderAt) <= validDate(clock()).getTime()) {
        throw new Error("STUDIO_PROACTIVE_SIGNAL_SNOOZE_INVALID");
      }
      return options.store.updateSignal({
        ...signal,
        status: "active",
        nextReminderAt,
        updatedAt: timestamp(clock),
        dismissedAt: null
      });
    },

    async dismissSignal(scope: StudioOwnerScope, signalId: string) {
      const signal = await requireSignal(options.store, scope, signalId);
      const at = timestamp(clock);
      return options.store.updateSignal({
        ...signal,
        status: "dismissed",
        updatedAt: at,
        dismissedAt: at
      });
    }
  };
}

type InMemoryDueRitual = StudioDueRitual & {
  claimToken: string | null;
  claimLeaseExpiresAt: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
};

export function createInMemoryStudioProactivityStore(options: {
  now?: () => string;
  dueRituals?: StudioDueRitual[];
} = {}): StudioProactivityStore & { getDueRituals(): StudioDueRitual[] } {
  const clock = options.now ?? (() => new Date().toISOString());
  const settings = new Map<string, StudioProactivitySettings>();
  const signals: StudioProactiveSignal[] = [];
  const dueRituals: InMemoryDueRitual[] = (options.dueRituals ?? []).map((ritual) => ({
    ...structuredClone(ritual),
    claimToken: null,
    claimLeaseExpiresAt: null,
    attemptCount: 0,
    nextAttemptAt: null,
    lastErrorCode: null
  }));

  return {
    async readSettings(scope) {
      const value = settings.get(scopeKey(scope));
      return value ? structuredClone(value) : null;
    },

    async saveSettings(input) {
      const value = structuredClone(input);
      settings.set(scopeKey(input), value);
      const at = clock();
      for (const signal of signals) {
        if (sameScope(signal, input) && signal.status === "active" && !signalEnabled(value, signal.type)) {
          signal.status = "dismissed";
          signal.dismissedAt = at;
          signal.updatedAt = at;
        }
      }
      return structuredClone(value);
    },

    async claimDueRituals(input) {
      const claimed: StudioDueRitualClaim[] = [];
      const claimedOwners = new Set<string>();
      const ordered = [...dueRituals].sort((left, right) => (
        left.scheduledFor.localeCompare(right.scheduledFor)
        || scopeKey(left).localeCompare(scopeKey(right))
        || left.ritualId.localeCompare(right.ritualId)
      ));
      for (const ritual of ordered) {
        if (claimed.length >= input.limit) break;
        const ownerSettings = settings.get(scopeKey(ritual));
        if (!ownerSettings?.ritualReminder) continue;
        if (claimedOwners.has(scopeKey(ritual))) continue;
        if (Date.parse(ritual.scheduledFor) > Date.parse(input.now)) continue;
        if (ritual.nextAttemptAt && Date.parse(ritual.nextAttemptAt) > Date.parse(input.now)) continue;
        if (ritual.claimLeaseExpiresAt && Date.parse(ritual.claimLeaseExpiresAt) > Date.parse(input.now)) continue;
        if (signals.some((signal) => sameRitualSignal(signal, ritual))) continue;
        ritual.claimToken = input.claimToken;
        ritual.claimLeaseExpiresAt = input.claimLeaseExpiresAt;
        ritual.attemptCount += 1;
        claimed.push({
          workspaceId: ritual.workspaceId,
          ownerProfileId: ritual.ownerProfileId,
          ritualId: ritual.ritualId,
          title: ritual.title,
          scheduledFor: ritual.scheduledFor,
          claimToken: input.claimToken,
          attemptCount: ritual.attemptCount
        });
        claimedOwners.add(scopeKey(ritual));
      }
      return structuredClone(claimed);
    },

    async completeRitualPreparation(input) {
      const ritual = requireClaimedDueRitual(dueRituals, input.claim);
      const existing = signals.find((signal) => sameRitualSignal(signal, input.claim));
      if (existing) return structuredClone(existing);
      const enabled = settings.get(scopeKey(input.claim))?.ritualReminder === true;
      const signal: StudioProactiveSignal = {
        workspaceId: input.claim.workspaceId,
        ownerProfileId: input.claim.ownerProfileId,
        id: `signal_${randomUUID()}`,
        type: "ritual_reminder",
        sourceId: input.claim.ritualId,
        sourceScheduledFor: input.claim.scheduledFor,
        title: input.title,
        reason: input.reason,
        status: enabled ? "active" : "dismissed",
        nextReminderAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
        dismissedAt: enabled ? null : input.now
      };
      signals.push(signal);
      ritual.claimToken = null;
      ritual.claimLeaseExpiresAt = null;
      ritual.nextAttemptAt = null;
      ritual.lastErrorCode = null;
      return structuredClone(signal);
    },

    async failRitualPreparation(input) {
      const ritual = requireClaimedDueRitual(dueRituals, input.claim);
      ritual.claimToken = null;
      ritual.claimLeaseExpiresAt = null;
      ritual.nextAttemptAt = input.nextAttemptAt;
      ritual.lastErrorCode = input.errorCode;
    },

    async listSignals(scope, input) {
      const ownerSettings = settings.get(scopeKey(scope));
      return signals
        .filter((signal) => sameScope(signal, scope))
        .filter((signal) => Boolean(ownerSettings) && signalEnabled(ownerSettings!, signal.type))
        .filter((signal) => signal.status === "active" && Date.parse(signal.nextReminderAt) <= Date.parse(input.now))
        .sort((left, right) => left.nextReminderAt.localeCompare(right.nextReminderAt) || left.id.localeCompare(right.id))
        .slice(0, input.limit)
        .map((signal) => structuredClone(signal));
    },

    async findSignal(scope, signalId) {
      const ownerSettings = settings.get(scopeKey(scope));
      const signal = signals.find((candidate) => candidate.id === signalId && sameScope(candidate, scope)
        && candidate.status === "active" && Boolean(ownerSettings) && signalEnabled(ownerSettings!, candidate.type));
      return signal ? structuredClone(signal) : null;
    },

    async updateSignal(input) {
      const index = signals.findIndex((candidate) => candidate.id === input.id && sameScope(candidate, input));
      if (index < 0) throw new Error("STUDIO_PROACTIVE_SIGNAL_NOT_FOUND");
      signals[index] = structuredClone(input);
      return structuredClone(input);
    },

    async readPortabilityRows(scope) {
      const ownerSettings = settings.get(scopeKey(scope));
      return {
        settings: ownerSettings ? structuredClone(ownerSettings) : null,
        signals: signals.filter((signal) => sameScope(signal, scope)).map((signal) => structuredClone(signal))
      };
    },

    async deleteOwnerData(scope) {
      settings.delete(scopeKey(scope));
      for (let index = signals.length - 1; index >= 0; index -= 1) {
        if (sameScope(signals[index]!, scope)) signals.splice(index, 1);
      }
      for (let index = dueRituals.length - 1; index >= 0; index -= 1) {
        if (sameScope(dueRituals[index]!, scope)) dueRituals.splice(index, 1);
      }
    },

    getDueRituals() {
      return dueRituals.map(({ claimToken: _claimToken, claimLeaseExpiresAt: _lease, attemptCount: _attempts,
        nextAttemptAt: _nextAttempt, lastErrorCode: _error, ...ritual }) => structuredClone(ritual));
    }
  };
}

function defaultSettings(scope: StudioOwnerScope, updatedAt: string): StudioProactivitySettings {
  return { ...scope, ...STUDIO_PROACTIVITY_DEFAULT_SETTINGS, updatedAt };
}

function definedToggles(input: Partial<StudioProactivityToggles>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value === "boolean"));
}

function timestamp(now: () => Date) {
  return validDate(now()).toISOString();
}

function validDate(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("STUDIO_PROACTIVITY_TIME_INVALID");
  return value;
}

function validIso(value: string, code: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(code);
  return new Date(value).toISOString();
}

function retryDelayMs(attemptCount: number) {
  return Math.min(6 * 60 * 60_000, 5 * 60_000 * (2 ** Math.max(0, attemptCount - 1)));
}

function errorCode(error: unknown) {
  return error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
    ? error.message.slice(0, 120)
    : "STUDIO_RITUAL_PREPARATION_FAILED";
}

function scopeOf(value: StudioOwnerScope): StudioOwnerScope {
  return { workspaceId: value.workspaceId, ownerProfileId: value.ownerProfileId };
}

function scopeKey(value: StudioOwnerScope) {
  return `${value.workspaceId}\u0000${value.ownerProfileId}`;
}

function signalEnabled(settings: StudioProactivitySettings, type: StudioProactivitySignalType) {
  switch (type) {
    case "ritual_reminder": return settings.ritualReminder;
    case "stale_goal": return settings.staleGoal;
    case "recurring_theme": return settings.recurringTheme;
    case "decision_review": return settings.decisionReview;
    case "operational_change": return settings.operationalChange;
    case "focused_content": return settings.focusedContent;
  }
}

function sameScope(left: StudioOwnerScope, right: StudioOwnerScope) {
  return left.workspaceId === right.workspaceId && left.ownerProfileId === right.ownerProfileId;
}

function sameRitualSignal(
  signal: StudioProactiveSignal,
  ritual: Pick<StudioDueRitual, "workspaceId" | "ownerProfileId" | "ritualId" | "scheduledFor">
) {
  return sameScope(signal, ritual)
    && signal.type === "ritual_reminder"
    && signal.sourceId === ritual.ritualId
    && signal.sourceScheduledFor === ritual.scheduledFor;
}

function requireClaimedDueRitual(dueRituals: InMemoryDueRitual[], claim: StudioDueRitualClaim) {
  const ritual = dueRituals.find((candidate) => sameScope(candidate, claim)
    && candidate.ritualId === claim.ritualId
    && candidate.scheduledFor === claim.scheduledFor
    && candidate.claimToken === claim.claimToken);
  if (!ritual) throw new Error("STUDIO_PROACTIVITY_CLAIM_LOST");
  return ritual;
}

async function requireSignal(store: StudioProactivityStore, scope: StudioOwnerScope, signalId: string) {
  const signal = await store.findSignal(scope, signalId);
  if (!signal) throw new Error("STUDIO_PROACTIVE_SIGNAL_NOT_FOUND");
  return signal;
}
