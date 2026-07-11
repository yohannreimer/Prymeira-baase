export type Area = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type RoleTemplate = {
  id: string;
  workspaceId: string;
  areaId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TeamInvite = {
  id: string;
  workspaceId: string;
  name: string;
  email: string | null;
  role: "owner" | "manager" | "employee";
  areaId: string | null;
  roleTemplateId: string | null;
  accessScope: "workspace" | "area" | "assigned_only";
  code: string;
  status: "pending" | "accepted" | "revoked";
  createdByProfileId: string;
  createdAt: string;
  updatedAt: string;
};

export type TeamMember = {
  id: string;
  workspaceId: string;
  name: string;
  email: string | null;
  role: "owner" | "manager" | "employee";
  areaId: string | null;
  roleTemplateId: string | null;
  status: "active" | "inactive" | "placeholder";
  createdByProfileId: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateAreaInput = {
  name: string;
  description?: string | null;
};

export type UpdateAreaInput = CreateAreaInput;

export type CreateRoleTemplateInput = {
  areaId: string;
  name: string;
  description?: string | null;
};

export type CreateTeamInviteInput = {
  name: string;
  email?: string | null;
  role: TeamInvite["role"];
  areaId?: string | null;
  roleTemplateId?: string | null;
  accessScope?: TeamInvite["accessScope"];
  createdByProfileId: string;
};

export type CreateTeamMemberInput = {
  name: string;
  email?: string | null;
  role: TeamMember["role"];
  areaId?: string | null;
  roleTemplateId?: string | null;
  status?: TeamMember["status"];
  createdByProfileId: string;
};

export type UpdateTeamMemberInput = {
  name: string;
  email?: string | null;
  role: TeamMember["role"];
  areaId?: string | null;
  roleTemplateId?: string | null;
  status?: TeamMember["status"];
};

export type AcceptTeamInviteInput = {
  name?: string | null;
  email?: string | null;
  acceptedByProfileId?: string | null;
};

export type CompanyRepository = {
  listAreas(workspaceId: string): Promise<Area[]>;
  findAreaById(workspaceId: string, areaId: string): Promise<Area | null>;
  createArea(input: Omit<Area, "id" | "sortOrder" | "createdAt" | "updatedAt">): Promise<Area>;
  updateArea(area: Area): Promise<Area>;
  deleteArea(workspaceId: string, areaId: string): Promise<void>;
  listRoleTemplates(workspaceId: string): Promise<RoleTemplate[]>;
  createRoleTemplate(input: Omit<RoleTemplate, "id" | "createdAt" | "updatedAt">): Promise<RoleTemplate>;
  deleteRoleTemplate(workspaceId: string, roleTemplateId: string): Promise<void>;
  listTeamMembers(workspaceId: string): Promise<TeamMember[]>;
  findTeamMember(workspaceId: string, personId: string): Promise<TeamMember | null>;
  createTeamMember(
    input: Omit<TeamMember, "id" | "status" | "createdAt" | "updatedAt"> & { status?: TeamMember["status"] }
  ): Promise<TeamMember>;
  updateTeamMember(person: TeamMember): Promise<TeamMember>;
  deleteTeamMember(workspaceId: string, personId: string): Promise<void>;
  listTeamInvites(workspaceId: string): Promise<TeamInvite[]>;
  findTeamInviteByCode(code: string): Promise<TeamInvite | null>;
  createTeamInvite(input: Omit<TeamInvite, "id" | "code" | "status" | "createdAt" | "updatedAt">): Promise<TeamInvite>;
  updateTeamInvite(
    invite: TeamInvite,
    expected?: Pick<TeamInvite, "updatedAt" | "status">
  ): Promise<TeamInvite>;
  deleteTeamInvite(
    workspaceId: string,
    inviteId: string,
    expected?: Pick<TeamInvite, "updatedAt" | "status">
  ): Promise<void>;
  acceptTeamInviteAtomically?(
    invite: TeamInvite,
    member: Omit<TeamMember, "id" | "createdAt" | "updatedAt">
  ): Promise<{ invite: TeamInvite; person: TeamMember }>;
};
