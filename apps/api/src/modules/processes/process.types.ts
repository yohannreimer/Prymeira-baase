export type ProcessStatus = "draft" | "published" | "archived";

export type ProcessVersionRecord = {
  id: string;
  processId: string;
  workspaceId: string;
  version: number;
  title: string;
  body: string;
  changeNote: string;
  editorProfileId: string;
  createdAt: string;
};

export type ProcessOwner =
  | { type: "person"; personId: string }
  | { type: "role"; roleTemplateId: string };

export type ProcessMaterial = {
  id: string;
  processId: string;
  workspaceId: string;
  kind: "link" | "file";
  title: string;
  url: string | null;
  objectKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

export type ProcessMaterialInput =
  | { kind: "link"; title: string; url: string }
  | {
      kind: "file";
      title: string;
      objectKey: string;
      contentType: string;
      sizeBytes: number;
    };

export type CompanyProcess = {
  id: string;
  workspaceId: string;
  areaId: string | null;
  title: string;
  summary: string | null;
  status: ProcessStatus;
  /** @deprecated Use owner. Kept while legacy JSONB records are migrated. */
  ownerProfileId: string | null;
  owner?: ProcessOwner | null;
  materials?: ProcessMaterial[];
  currentVersion: ProcessVersionRecord;
  versions: ProcessVersionRecord[];
  createdByProfileId: string;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateProcessInput = {
  title: string;
  body: string;
  areaId?: string | null;
  summary?: string | null;
  ownerProfileId?: string | null;
  owner?: ProcessOwner | null;
  materials?: ProcessMaterialInput[];
};

export type CreateProcessVersionInput = {
  body: string;
  changeNote: string;
  title?: string | null;
  summary?: string | null;
  areaId?: string | null;
  ownerProfileId?: string | null;
  owner?: ProcessOwner | null;
  materials?: ProcessMaterialInput[];
};

export type ProcessRepository = {
  listProcesses(workspaceId: string, filters?: { ids?: string[]; ownerProfileIds?: string[]; limit?: number }): Promise<CompanyProcess[]>;
  findProcess(workspaceId: string, processId: string): Promise<CompanyProcess | null>;
  createProcess(input: Omit<CompanyProcess, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<CompanyProcess>;
  updateProcess(process: CompanyProcess): Promise<CompanyProcess>;
  deleteProcess(workspaceId: string, processId: string): Promise<void>;
  listProcessMaterials(workspaceId: string, processId: string): Promise<ProcessMaterial[]>;
  findProcessMaterial(workspaceId: string, processId: string, materialId: string): Promise<ProcessMaterial | null>;
  addProcessMaterial(
    input: Omit<ProcessMaterial, "id" | "createdAt">
  ): Promise<ProcessMaterial>;
  removeProcessMaterial(workspaceId: string, processId: string, materialId: string): Promise<ProcessMaterial | null>;
  getLifecycleState?(): CompanyProcess[];
  commitLifecycleState?(processes: CompanyProcess[]): void;
};
