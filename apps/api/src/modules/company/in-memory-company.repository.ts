import { normalizeAccessScope, normalizeAreaAccessIds, type Area, type CompanyRepository, type RoleTemplate, type TeamInvite, type TeamMember } from "./company.types";

type InMemoryCompanyRepositoryOptions = {
  now?: () => string;
};

export function createInMemoryCompanyRepository(
  options: InMemoryCompanyRepositoryOptions = {}
): CompanyRepository {
  const areas: Area[] = [];
  const roleTemplates: RoleTemplate[] = [];
  const teamMembers: TeamMember[] = [];
  const invites: TeamInvite[] = [];
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async listAreas(workspaceId) {
      return areas
        .filter((area) => area.workspaceId === workspaceId)
        .filter((area) => !area.archivedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder);
    },

    async findAreaById(workspaceId, areaId) {
      return areas.find((area) => area.workspaceId === workspaceId && area.id === areaId && !area.archivedAt) ?? null;
    },

    async createArea(input) {
      const workspaceAreas = areas.filter((area) => area.workspaceId === input.workspaceId);
      const timestamp = now();
      const area: Area = {
        ...input,
        id: `area_${workspaceAreas.length + 1}`,
        sortOrder: workspaceAreas.length + 1,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      areas.push(area);
      return area;
    },

    async updateArea(area) {
      const index = areas.findIndex((current) => current.workspaceId === area.workspaceId && current.id === area.id);
      if (index === -1) throw new Error("AREA_NOT_FOUND");

      const updatedArea = {
        ...area,
        updatedAt: now()
      };
      areas[index] = updatedArea;
      return updatedArea;
    },

    async deleteArea(workspaceId, areaId) {
      const index = areas.findIndex((area) => area.workspaceId === workspaceId && area.id === areaId && !area.archivedAt);
      if (index >= 0) areas[index] = { ...areas[index]!, archivedAt: now(), updatedAt: now() };
    },

    async listRoleTemplates(workspaceId) {
      return roleTemplates.filter((roleTemplate) => roleTemplate.workspaceId === workspaceId && !roleTemplate.archivedAt);
    },

    async createRoleTemplate(input) {
      const timestamp = now();
      const roleTemplate: RoleTemplate = {
        ...input,
        id: `role_${roleTemplates.length + 1}`,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      roleTemplates.push(roleTemplate);
      return roleTemplate;
    },

    async deleteRoleTemplate(workspaceId, roleTemplateId) {
      const index = roleTemplates.findIndex((roleTemplate) => {
        return roleTemplate.workspaceId === workspaceId && roleTemplate.id === roleTemplateId && !roleTemplate.archivedAt;
      });
      if (index >= 0) roleTemplates[index] = { ...roleTemplates[index]!, archivedAt: now(), updatedAt: now() };
    },

    async listTeamMembers(workspaceId) {
      return teamMembers.filter((member) => member.workspaceId === workspaceId && member.status !== "archived");
    },

    async findTeamMember(workspaceId, personId) {
      return teamMembers.find((member) => member.workspaceId === workspaceId && member.id === personId && member.status !== "archived") ?? null;
    },

    async findTeamMemberByClerkUserId(workspaceId, clerkUserId) {
      return teamMembers.find((member) => member.workspaceId === workspaceId && member.clerkUserId === clerkUserId && member.status !== "archived") ?? null;
    },

    async findTeamMemberByCustomerId(workspaceId, customerId) {
      return teamMembers.find((member) => member.workspaceId === workspaceId && member.customerId === customerId && member.status !== "archived") ?? null;
    },

    async findUnlinkedTeamMembersByEmail(workspaceId, email) {
      const normalized = email.trim().toLowerCase();
      return teamMembers.filter((member) => member.workspaceId === workspaceId
        && member.status !== "archived"
        && !member.clerkUserId
        && !member.customerId
        && member.email?.trim().toLowerCase() === normalized);
    },

    async hasLinkedOwner(workspaceId) {
      return teamMembers.some((member) => member.workspaceId === workspaceId && member.role === "owner" && member.status === "active" && Boolean(member.clerkUserId));
    },

    async createTeamMember(input) {
      if (input.clerkUserId && teamMembers.some((member) => member.workspaceId === input.workspaceId && member.clerkUserId === input.clerkUserId && member.status !== "archived")) {
        throw new Error("TEAM_MEMBER_CLERK_ID_CONFLICT");
      }
      if (input.customerId && teamMembers.some((member) => member.workspaceId === input.workspaceId && member.customerId === input.customerId && member.status !== "archived")) {
        throw new Error("TEAM_MEMBER_CUSTOMER_ID_CONFLICT");
      }
      const timestamp = now();
      const member: TeamMember = {
        ...input,
        id: `person_${teamMembers.length + 1}`,
        areaAccessIds: normalizeAreaAccessIds(input.areaId, input.areaAccessIds),
        accessScope: normalizeAccessScope(input.role, input.accessScope),
        clerkUserId: input.clerkUserId ?? null,
        customerId: input.customerId ?? null,
        status: input.status ?? "active",
        createdAt: timestamp,
        updatedAt: timestamp
      };
      teamMembers.push(member);
      return member;
    },

    async updateTeamMember(person) {
      const index = teamMembers.findIndex((member) => member.workspaceId === person.workspaceId && member.id === person.id);
      if (index === -1) throw new Error("TEAM_MEMBER_NOT_FOUND");

      if (person.clerkUserId && teamMembers.some((member) => member.workspaceId === person.workspaceId && member.id !== person.id && member.clerkUserId === person.clerkUserId && member.status !== "archived")) {
        throw new Error("TEAM_MEMBER_CLERK_ID_CONFLICT");
      }
      if (person.customerId && teamMembers.some((member) => member.workspaceId === person.workspaceId && member.id !== person.id && member.customerId === person.customerId && member.status !== "archived")) {
        throw new Error("TEAM_MEMBER_CUSTOMER_ID_CONFLICT");
      }
      const updatedMember: TeamMember = {
        ...person,
        areaAccessIds: normalizeAreaAccessIds(person.areaId, person.areaAccessIds),
        accessScope: normalizeAccessScope(person.role, person.accessScope),
        updatedAt: now()
      };
      teamMembers[index] = updatedMember;
      return updatedMember;
    },

    async deleteTeamMember(workspaceId, personId) {
      const index = teamMembers.findIndex((member) => member.workspaceId === workspaceId && member.id === personId);
      if (index >= 0) teamMembers[index] = { ...teamMembers[index]!, status: "archived", updatedAt: now() };
    },

    async listTeamInvites(workspaceId) {
      return invites.filter((invite) => invite.workspaceId === workspaceId);
    },

    async findTeamInviteByCode(code) {
      return invites.find((invite) => invite.code === code) ?? null;
    },

    async createTeamInvite(input) {
      const timestamp = now();
      const invite: TeamInvite = {
        ...input,
        id: `invite_${invites.length + 1}`,
        code: `BAASE-${String(invites.length + 1).padStart(4, "0")}`,
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp
      };
      invites.push(invite);
      return invite;
    },

    async updateTeamInvite(invite) {
      const index = invites.findIndex((current) => current.workspaceId === invite.workspaceId && current.id === invite.id);
      if (index === -1) throw new Error("TEAM_INVITE_NOT_FOUND");

      const updatedInvite = {
        ...invite,
        updatedAt: now()
      };
      invites[index] = updatedInvite;
      return updatedInvite;
    },

    async deleteTeamInvite(workspaceId, inviteId) {
      const index = invites.findIndex((invite) => invite.workspaceId === workspaceId && invite.id === inviteId);
      if (index >= 0) invites.splice(index, 1);
    },

    getLifecycleState() {
      return structuredClone({ areas, roleTemplates, teamMembers, invites });
    },

    commitLifecycleState(state) {
      areas.splice(0, areas.length, ...state.areas);
      roleTemplates.splice(0, roleTemplates.length, ...state.roleTemplates);
      teamMembers.splice(0, teamMembers.length, ...state.teamMembers);
      invites.splice(0, invites.length, ...state.invites);
    }
  };
}
