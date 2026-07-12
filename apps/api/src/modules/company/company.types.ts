export type Area = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  sortOrder: number;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AreaImpact = {
  area: Area;
  processes: Array<{ id: string; title: string }>;
  routines: Array<{ id: string; title: string }>;
  roleTemplates: Array<{ id: string; name: string }>;
  people: Array<{ id: string; name: string }>;
  pendingInvites: Array<{ id: string; name: string; email: string | null }>;
};

export type ArchiveAreaInput =
  | { strategy: "reassign"; targetAreaId: string }
  | { strategy: "unassign" };

export type AreaAffectedCounts = {
  processes: number;
  routines: number;
  roleTemplates: number;
  people: number;
  pendingInvites: number;
};

export type ArchiveAreaResult = {
  area: Area;
  reassigned: AreaAffectedCounts;
  unassigned: Omit<AreaAffectedCounts, "roleTemplates">;
  archived: { areas: number; roleTemplates: number };
};

export type AreaLifecycleRepository = {
  getImpact(workspaceId: string, areaId: string): Promise<AreaImpact | null>;
  archive(input: {
    workspaceId: string;
    areaId: string;
    actorProfileId: string;
    resolution?: ArchiveAreaInput;
  }): Promise<ArchiveAreaResult>;
};

export type InMemoryCompanyLifecycleState = {
  areas: Area[];
  roleTemplates: RoleTemplate[];
  teamMembers: TeamMember[];
  invites: TeamInvite[];
};

export type RoleTemplate = {
  id: string;
  workspaceId: string;
  areaId: string;
  name: string;
  description: string | null;
  archivedAt?: string | null;
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
  areaAccessIds?: string[];
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
  areaAccessIds: string[];
  roleTemplateId: string | null;
  accessScope: "workspace" | "area" | "assigned_only";
  clerkUserId: string | null;
  customerId: string | null;
  status: "pending" | "active" | "inactive" | "placeholder" | "archived";
  createdByProfileId: string;
  createdAt: string;
  updatedAt: string;
};

export type ExternalAccountIdentity = {
  workspaceId: string;
  workspaceName?: string;
  clerkUserId: string;
  customerId: string;
  productRole: string | null;
  profileName?: string;
  bearerToken: string;
};

export type OperationalMembership = {
  person: TeamMember;
  personId: string;
  role: TeamMember["role"];
  accessScope: TeamMember["accessScope"];
  areaAccessIds: string[];
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
  areaAccessIds?: string[];
  roleTemplateId?: string | null;
  accessScope?: TeamMember["accessScope"];
  clerkUserId?: string | null;
  customerId?: string | null;
  status?: TeamMember["status"];
  createdByProfileId: string;
};

export type UpdateTeamMemberInput = {
  name: string;
  email?: string | null;
  role: TeamMember["role"];
  areaId?: string | null;
  areaAccessIds?: string[];
  roleTemplateId?: string | null;
  accessScope?: TeamMember["accessScope"];
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
  findTeamMemberByClerkUserId(workspaceId: string, clerkUserId: string): Promise<TeamMember | null>;
  findTeamMemberByCustomerId(workspaceId: string, customerId: string): Promise<TeamMember | null>;
  findUnlinkedTeamMembersByEmail(workspaceId: string, email: string): Promise<TeamMember[]>;
  hasLinkedOwner(workspaceId: string): Promise<boolean>;
  createTeamMember(
    input: Omit<TeamMember, "id" | "status" | "createdAt" | "updatedAt" | "areaAccessIds" | "accessScope" | "clerkUserId" | "customerId">
      & Partial<Pick<TeamMember, "areaAccessIds" | "accessScope" | "clerkUserId" | "customerId">>
      & { status?: TeamMember["status"] }
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
  getLifecycleState?(): InMemoryCompanyLifecycleState;
  commitLifecycleState?(state: InMemoryCompanyLifecycleState): void;
};

export function normalizeAreaAccessIds(areaId: string | null, areaAccessIds: string[] | null | undefined) {
  return [...new Set([...(areaAccessIds ?? []), ...(areaId ? [areaId] : [])].filter(Boolean))];
}

export function normalizeAccessScope(role: TeamMember["role"], scope: TeamMember["accessScope"] | null | undefined) {
  if (role === "owner") return "workspace" as const;
  return scope ?? "workspace";
}
