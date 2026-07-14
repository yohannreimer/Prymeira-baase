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
  let nextMaterialId = 0;

  return {
    async listProcesses(workspaceId, filters = {}) {
      return processes
        .filter((process) => process.workspaceId === workspaceId)
        .filter((process) => {
          if (!filters.ids?.length && !filters.ownerProfileIds?.length) return true;
          return Boolean(filters.ids?.includes(process.id)
            || process.ownerProfileId && filters.ownerProfileIds?.includes(process.ownerProfileId)
            || process.owner?.type === "person" && filters.ownerProfileIds?.includes(process.owner.personId));
        })
        .slice(0, filters.limit)
        .map(normalizeProcess);
    },

    async findProcess(workspaceId, processId) {
      const process = processes.find((item) => item.workspaceId === workspaceId && item.id === processId);
      return process ? normalizeProcess(process) : null;
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
      return normalizeProcess(process);
    },

    async updateProcess(process) {
      const index = processes.findIndex((item) => item.id === process.id && item.workspaceId === process.workspaceId);
      if (index === -1) throw new Error("PROCESS_NOT_FOUND");
      const updated = {
        ...process,
        updatedAt: now()
      };
      processes[index] = updated;
      return normalizeProcess(updated);
    },

    async deleteProcess(workspaceId, processId) {
      const index = processes.findIndex((item) => item.workspaceId === workspaceId && item.id === processId);
      if (index >= 0) processes.splice(index, 1);
    },

    async listProcessMaterials(workspaceId, processId) {
      const process = processes.find((item) => item.workspaceId === workspaceId && item.id === processId);
      return process?.materials ?? [];
    },

    async findProcessMaterial(workspaceId, processId, materialId) {
      const process = processes.find((item) => item.workspaceId === workspaceId && item.id === processId);
      return process?.materials?.find((item) => item.id === materialId) ?? null;
    },

    async addProcessMaterial(input) {
      const index = processes.findIndex((item) => item.workspaceId === input.workspaceId && item.id === input.processId);
      if (index === -1) throw new Error("PROCESS_NOT_FOUND");
      const material = {
        ...input,
        id: `material_${input.processId}_${++nextMaterialId}`,
        createdAt: now()
      };
      processes[index] = {
        ...processes[index]!,
        materials: [...(processes[index]!.materials ?? []), material],
        updatedAt: now()
      };
      return material;
    },

    async removeProcessMaterial(workspaceId, processId, materialId) {
      const index = processes.findIndex((item) => item.workspaceId === workspaceId && item.id === processId);
      if (index === -1) throw new Error("PROCESS_NOT_FOUND");
      const process = processes[index]!;
      const material = process.materials?.find((item) => item.id === materialId) ?? null;
      if (!material) return null;
      processes[index] = {
        ...process,
        materials: process.materials!.filter((item) => item.id !== materialId),
        updatedAt: now()
      };
      return material;
    },

    getLifecycleState() {
      return structuredClone(processes);
    },

    commitLifecycleState(state) {
      processes.splice(0, processes.length, ...state);
    }
  };
}

function normalizeProcess(process: CompanyProcess): CompanyProcess {
  const owner = Object.prototype.hasOwnProperty.call(process, "owner")
    ? process.owner ?? null
    : process.ownerProfileId ? { type: "person" as const, personId: process.ownerProfileId } : null;
  return { ...process, owner, materials: process.materials ?? [] };
}
