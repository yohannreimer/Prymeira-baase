import type { OnboardingRepository, OnboardingSession } from "./onboarding.types";

function now() {
  return new Date().toISOString();
}

function nextTimestamp(previousTimestamp: string) {
  const timestamp = now();
  if (new Date(timestamp).getTime() > new Date(previousTimestamp).getTime()) return timestamp;

  return new Date(new Date(previousTimestamp).getTime() + 1).toISOString();
}

function cloneSession(session: OnboardingSession): OnboardingSession {
  return JSON.parse(JSON.stringify(session)) as OnboardingSession;
}

export function createInMemoryOnboardingRepository(): OnboardingRepository {
  const sessions: OnboardingSession[] = [];
  const sessionOrders = new Map<string, number>();
  let operationOrder = 0;

  return {
    async getCurrentSession(workspaceId) {
      const session = sessions
        .filter((item) => item.workspaceId === workspaceId)
        .sort((a, b) => {
          const timestampOrder = b.updatedAt.localeCompare(a.updatedAt);
          if (timestampOrder !== 0) return timestampOrder;

          return (sessionOrders.get(b.id) ?? 0) - (sessionOrders.get(a.id) ?? 0);
        })[0];

      return session ? cloneSession(session) : null;
    },

    async findSession(workspaceId, sessionId) {
      const session = sessions.find((item) => item.workspaceId === workspaceId && item.id === sessionId);
      return session ? cloneSession(session) : null;
    },

    async createSession(input) {
      const timestamp = now();
      const session: OnboardingSession = {
        ...input,
        id: `onboarding_session_${sessions.length + 1}`,
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      sessions.push(cloneSession(session));
      sessionOrders.set(session.id, ++operationOrder);
      return cloneSession(session);
    },

    async updateSession(session) {
      const index = sessions.findIndex((item) => item.workspaceId === session.workspaceId && item.id === session.id);
      if (index === -1) throw new Error("ONBOARDING_SESSION_NOT_FOUND");

      const persisted = sessions[index] as OnboardingSession;
      if (persisted.updatedAt !== session.updatedAt) throw new Error("ONBOARDING_SESSION_STALE");

      const updated = {
        ...session,
        updatedAt: nextTimestamp(persisted.updatedAt)
      };
      sessions[index] = cloneSession(updated);
      sessionOrders.set(updated.id, ++operationOrder);
      return cloneSession(updated);
    },

    async claimCompletion(workspaceId, sessionId) {
      const index = sessions.findIndex((item) => item.workspaceId === workspaceId && item.id === sessionId);
      if (index === -1) return null;

      const persisted = sessions[index] as OnboardingSession;
      if (persisted.status !== "reviewing" || !persisted.generatedSuggestion) return null;

      const updated: OnboardingSession = {
        ...persisted,
        status: "completing",
        currentStep: "completing",
        updatedAt: nextTimestamp(persisted.updatedAt)
      };
      sessions[index] = cloneSession(updated);
      sessionOrders.set(updated.id, ++operationOrder);
      return cloneSession(updated);
    }
  };
}
