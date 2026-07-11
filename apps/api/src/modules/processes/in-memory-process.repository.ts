import type { CompanyProcess, ProcessRepository } from "./process.types";

type InMemoryProcessRepositoryOptions = {
  now?: () => string;
  initialProcesses?: CompanyProcess[];
};

export function createInMemoryProcessRepository(
  options: InMemoryProcessRepositoryOptions = {}
): ProcessRepository {
  const processes: CompanyProcess[] = [...(options.initialProcesses ?? [])];
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async listProcesses(workspaceId) {
      return processes.filter((process) => process.workspaceId === workspaceId);
    },

    async findProcess(workspaceId, processId) {
      return processes.find((process) => process.workspaceId === workspaceId && process.id === processId) ?? null;
    },

    async createProcess(input) {
      const timestamp = now();
      const processId = `process_${processes.length + 1}`;
      const versions = input.versions.map((version) => ({
        ...version,
        id: `version_${processId}_${version.version}`,
        processId
      }));
      const process: CompanyProcess = {
        ...input,
        id: processId,
        versions,
        currentVersion: versions.find((version) => version.version === input.currentVersion.version)!,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      processes.push(process);
      return process;
    },

    async updateProcess(process) {
      const index = processes.findIndex((item) => item.id === process.id && item.workspaceId === process.workspaceId);
      if (index === -1) throw new Error("PROCESS_NOT_FOUND");
      const updated = {
        ...process,
        updatedAt: now()
      };
      processes[index] = updated;
      return updated;
    },

    async deleteProcess(workspaceId, processId) {
      const index = processes.findIndex((item) => item.workspaceId === workspaceId && item.id === processId);
      if (index >= 0) processes.splice(index, 1);
    }
  };
}
