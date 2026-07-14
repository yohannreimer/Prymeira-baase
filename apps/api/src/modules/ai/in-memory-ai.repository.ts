import type { AiRepository, AiRun, CreateAiRunRecordInput } from "./ai.types";

type InMemoryAiRepositoryOptions = {
  now?: () => string;
  initialRuns?: AiRun[];
};

export function createInMemoryAiRepository(options: InMemoryAiRepositoryOptions = {}): AiRepository {
  const runs: AiRun[] = [...(options.initialRuns ?? [])];
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async listRuns(workspaceId, actorProfileId) {
      return runs.filter((run) => run.workspaceId === workspaceId && canReadRun(run, actorProfileId));
    },

    async findRun(workspaceId, runId, actorProfileId) {
      return runs.find((run) => run.workspaceId === workspaceId && run.id === runId
        && canReadRun(run, actorProfileId)) ?? null;
    },

    async createRun(input: CreateAiRunRecordInput) {
      const timestamp = now();
      const run: AiRun = {
        ...input,
        id: `ai_run_${runs.length + 1}`,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      runs.push(run);
      return run;
    },

    async updateRun(run) {
      const index = runs.findIndex((item) => item.workspaceId === run.workspaceId && item.id === run.id);
      if (index === -1) throw new Error("AI_RUN_NOT_FOUND");
      const persisted = runs[index]!;
      if ((persisted.source === "owner_studio" || run.source === "owner_studio")
        && (persisted.source !== run.source || persisted.actorProfileId !== run.actorProfileId)) {
        throw new Error("AI_RUN_NOT_FOUND");
      }

      const updated = {
        ...run,
        updatedAt: now()
      };
      runs[index] = updated;
      return updated;
    }
  };
}

function canReadRun(run: AiRun, actorProfileId?: string) {
  return run.source !== "owner_studio" || Boolean(actorProfileId && run.actorProfileId === actorProfileId);
}
