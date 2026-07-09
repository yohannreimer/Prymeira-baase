import type {
  CompanyProcess,
  CreateProcessInput,
  CreateProcessVersionInput,
  ProcessRepository,
  ProcessVersionRecord
} from "./process.types";

function requiredText(value: string, errorCode: string) {
  const text = value.trim();
  if (!text) throw new Error(errorCode);
  return text;
}

function optionalText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function createVersion(input: {
  processId: string;
  workspaceId: string;
  title: string;
  body: string;
  changeNote: string;
  editorProfileId: string;
  version: number;
}): ProcessVersionRecord {
  const createdAt = new Date().toISOString();
  return {
    id: `version_${input.processId}_${input.version}`,
    processId: input.processId,
    workspaceId: input.workspaceId,
    version: input.version,
    title: input.title,
    body: input.body,
    changeNote: input.changeNote,
    editorProfileId: input.editorProfileId,
    createdAt
  };
}

export function createProcessService(repository: ProcessRepository) {
  return {
    listProcesses(workspaceId: string) {
      return repository.listProcesses(workspaceId);
    },

    async createProcess(workspaceId: string, editorProfileId: string, input: CreateProcessInput) {
      const title = requiredText(input.title, "PROCESS_TITLE_REQUIRED");
      const body = requiredText(input.body, "PROCESS_BODY_REQUIRED");
      const temporaryProcessId = "new";
      const currentVersion = createVersion({
        processId: temporaryProcessId,
        workspaceId,
        title,
        body,
        changeNote: "Criação inicial",
        editorProfileId,
        version: 1
      });

      const process = await repository.createProcess({
        workspaceId,
        areaId: input.areaId ?? null,
        title,
        summary: optionalText(input.summary),
        status: "draft",
        ownerProfileId: input.ownerProfileId ?? null,
        currentVersion,
        versions: [currentVersion],
        createdByProfileId: editorProfileId,
        publishedAt: null,
        archivedAt: null
      });

      const versionWithRealProcessId = {
        ...currentVersion,
        id: `version_${process.id}_1`,
        processId: process.id
      };

      return repository.updateProcess({
        ...process,
        currentVersion: versionWithRealProcessId,
        versions: [versionWithRealProcessId]
      });
    },

    async createProcessVersion(
      workspaceId: string,
      processId: string,
      editorProfileId: string,
      input: CreateProcessVersionInput
    ) {
      const process = await readProcessOrThrow(repository, workspaceId, processId);
      const nextVersionNumber = process.currentVersion.version + 1;
      const title = optionalText(input.title) ?? process.title;
      const nextVersion = createVersion({
        processId: process.id,
        workspaceId,
        title,
        body: requiredText(input.body, "PROCESS_BODY_REQUIRED"),
        changeNote: requiredText(input.changeNote, "PROCESS_CHANGE_NOTE_REQUIRED"),
        editorProfileId,
        version: nextVersionNumber
      });

      return repository.updateProcess({
        ...process,
        title,
        summary: input.summary === undefined ? process.summary : optionalText(input.summary),
        areaId: input.areaId === undefined ? process.areaId : input.areaId,
        ownerProfileId: input.ownerProfileId === undefined ? process.ownerProfileId : input.ownerProfileId,
        currentVersion: nextVersion,
        versions: [...process.versions, nextVersion]
      });
    },

    async publishProcess(workspaceId: string, processId: string): Promise<CompanyProcess> {
      const process = await readProcessOrThrow(repository, workspaceId, processId);
      return repository.updateProcess({
        ...process,
        status: "published",
        publishedAt: new Date().toISOString()
      });
    },

    async unpublishProcess(workspaceId: string, processId: string): Promise<CompanyProcess> {
      const process = await readProcessOrThrow(repository, workspaceId, processId);
      return repository.updateProcess({
        ...process,
        status: "draft",
        publishedAt: null
      });
    },

    async deleteProcess(workspaceId: string, processId: string): Promise<CompanyProcess> {
      const process = await readProcessOrThrow(repository, workspaceId, processId);
      await repository.deleteProcess(workspaceId, processId);
      return process;
    }
  };
}

async function readProcessOrThrow(repository: ProcessRepository, workspaceId: string, processId: string) {
  const process = await repository.findProcess(workspaceId, processId);
  if (!process) throw new Error("PROCESS_NOT_FOUND");
  return process;
}
