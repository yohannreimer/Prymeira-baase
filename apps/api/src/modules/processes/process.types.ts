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

export type CompanyProcess = {
  id: string;
  workspaceId: string;
  areaId: string | null;
  title: string;
  summary: string | null;
  status: ProcessStatus;
  ownerProfileId: string | null;
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
};

export type CreateProcessVersionInput = {
  body: string;
  changeNote: string;
  title?: string | null;
  summary?: string | null;
  areaId?: string | null;
  ownerProfileId?: string | null;
};

export type ProcessRepository = {
  listProcesses(workspaceId: string): Promise<CompanyProcess[]>;
  findProcess(workspaceId: string, processId: string): Promise<CompanyProcess | null>;
  createProcess(input: Omit<CompanyProcess, "id" | "createdAt" | "updatedAt">): Promise<CompanyProcess>;
  updateProcess(process: CompanyProcess): Promise<CompanyProcess>;
  deleteProcess(workspaceId: string, processId: string): Promise<void>;
  getLifecycleState?(): CompanyProcess[];
  commitLifecycleState?(processes: CompanyProcess[]): void;
};
