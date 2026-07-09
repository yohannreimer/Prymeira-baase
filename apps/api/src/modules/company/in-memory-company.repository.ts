import type { Area, CompanyRepository, RoleTemplate, TeamInvite, TeamMember } from "./company.types";

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
        .sort((a, b) => a.sortOrder - b.sortOrder);
    },

    async findAreaById(workspaceId, areaId) {
      return areas.find((area) => area.workspaceId === workspaceId && area.id === areaId) ?? null;
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
      const index = areas.findIndex((area) => area.workspaceId === workspaceId && area.id === areaId);
      if (index >= 0) areas.splice(index, 1);
    },

    async listRoleTemplates(workspaceId) {
      return roleTemplates.filter((roleTemplate) => roleTemplate.workspaceId === workspaceId);
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
        return roleTemplate.workspaceId === workspaceId && roleTemplate.id === roleTemplateId;
      });
      if (index >= 0) roleTemplates.splice(index, 1);
    },

    async listTeamMembers(workspaceId) {
      return teamMembers.filter((member) => member.workspaceId === workspaceId);
    },

    async findTeamMember(workspaceId, personId) {
      return teamMembers.find((member) => member.workspaceId === workspaceId && member.id === personId) ?? null;
    },

    async createTeamMember(input) {
      const timestamp = now();
      const member: TeamMember = {
        ...input,
        id: `person_${teamMembers.length + 1}`,
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

      const updatedMember = {
        ...person,
        updatedAt: now()
      };
      teamMembers[index] = updatedMember;
      return updatedMember;
    },

    async deleteTeamMember(workspaceId, personId) {
      const index = teamMembers.findIndex((member) => member.workspaceId === workspaceId && member.id === personId);
      if (index >= 0) teamMembers.splice(index, 1);
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
    }
  };
}
