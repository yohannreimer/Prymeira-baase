import type {
  CompanyProcess,
  CreateProcessInput,
  CreateProcessVersionInput,
  ProcessRepository,
  ProcessVersionRecord
} from "./process.types";
import type { CompanyRepository } from "../company/company.types";

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

type ProcessServiceDependencies = {
  companyRepository?: CompanyRepository;
};

export function createProcessService(repository: ProcessRepository, dependencies: ProcessServiceDependencies = {}) {
  const validateReferences = async (
    workspaceId: string,
    areaId: string | null | undefined,
    owner: CreateProcessInput["owner"] | undefined
  ) => {
    const companyRepository = dependencies.companyRepository;
    if (!companyRepository) return;

    if (areaId && !await companyRepository.findAreaById(workspaceId, areaId)) {
      throw new Error("PROCESS_AREA_NOT_FOUND");
    }
    if (!owner) return;

    if (owner.type === "person") {
      const person = await companyRepository.findTeamMember(workspaceId, owner.personId);
      if (!person || person.status !== "active") throw new Error("PROCESS_OWNER_PERSON_NOT_FOUND");
      return;
    }

    const roleTemplate = (await companyRepository.listRoleTemplates(workspaceId))
      .find((item) => item.id === owner.roleTemplateId);
    if (!roleTemplate) throw new Error("PROCESS_OWNER_ROLE_NOT_FOUND");
    if (areaId && roleTemplate.areaId !== areaId) throw new Error("PROCESS_OWNER_AREA_MISMATCH");
  };

  return {
    listProcesses(workspaceId: string) {
      return repository.listProcesses(workspaceId);
    },

    async createProcess(workspaceId: string, editorProfileId: string, input: CreateProcessInput) {
      const title = requiredText(input.title, "PROCESS_TITLE_REQUIRED");
      const body = requiredText(input.body, "PROCESS_BODY_REQUIRED");
      const owner = input.owner === undefined
        ? input.ownerProfileId ? { type: "person" as const, personId: input.ownerProfileId } : null
        : input.owner;
      await validateReferences(workspaceId, input.areaId, owner);
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

      return repository.createProcess({
        workspaceId,
        areaId: input.areaId ?? null,
        title,
        summary: optionalText(input.summary),
        status: "draft",
        ownerProfileId: owner?.type === "person" ? owner.personId : null,
        owner,
        materials: toProcessMaterials("new", workspaceId, normalizeMaterials(input.materials)),
        currentVersion,
        versions: [currentVersion],
        createdByProfileId: editorProfileId,
        publishedAt: null,
        archivedAt: null
      });
    },

    async createProcessVersion(
      workspaceId: string,
      processId: string,
      editorProfileId: string,
      input: CreateProcessVersionInput
    ) {
      const process = await readProcessOrThrow(repository, workspaceId, processId);
      const owner = input.owner === undefined ? process.owner ?? legacyOwner(process) : input.owner;
      const areaId = input.areaId === undefined ? process.areaId : input.areaId;
      await validateReferences(workspaceId, areaId, owner);
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
        areaId,
        ownerProfileId: owner?.type === "person" ? owner.personId : null,
        owner,
        materials: input.materials === undefined
          ? process.materials ?? []
          : toProcessMaterials(process.id, workspaceId, normalizeMaterials(input.materials)),
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

function legacyOwner(process: CompanyProcess) {
  return process.ownerProfileId ? { type: "person" as const, personId: process.ownerProfileId } : null;
}

function normalizeMaterials(materials: readonly import("./process.types").ProcessMaterialInput[] | undefined) {
  return (materials ?? []).map((material) => {
    const title = requiredText(material.title, "PROCESS_MATERIAL_TITLE_REQUIRED");
    if (material.kind === "link") {
      const url = requiredText(material.url, "PROCESS_MATERIAL_URL_REQUIRED");
      try {
        new URL(url);
      } catch {
        throw new Error("PROCESS_MATERIAL_URL_INVALID");
      }
      return { kind: "link" as const, title, url };
    }
    return {
      kind: "file" as const,
      title,
      objectKey: requiredText(material.objectKey, "PROCESS_MATERIAL_OBJECT_KEY_REQUIRED"),
      contentType: requiredText(material.contentType, "PROCESS_MATERIAL_CONTENT_TYPE_REQUIRED"),
      sizeBytes: validFileSize(material.sizeBytes)
    };
  });
}

function validFileSize(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("PROCESS_MATERIAL_SIZE_INVALID");
  return value;
}

function toProcessMaterials(
  processId: string,
  workspaceId: string,
  materials: ReturnType<typeof normalizeMaterials>
) {
  const createdAt = new Date().toISOString();
  return materials.map((material, index) => material.kind === "link"
    ? {
        id: `material_${processId}_${index + 1}`,
        processId,
        workspaceId,
        kind: "link" as const,
        title: material.title,
        url: material.url,
        objectKey: null,
        contentType: null,
        sizeBytes: null,
        createdAt
      }
    : {
        id: `material_${processId}_${index + 1}`,
        processId,
        workspaceId,
        kind: "file" as const,
        title: material.title,
        url: null,
        objectKey: material.objectKey,
        contentType: material.contentType,
        sizeBytes: material.sizeBytes,
        createdAt
      }
  );
}

async function readProcessOrThrow(repository: ProcessRepository, workspaceId: string, processId: string) {
  const process = await repository.findProcess(workspaceId, processId);
  if (!process) throw new Error("PROCESS_NOT_FOUND");
  return process;
}
