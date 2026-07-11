import type {
  AcceptTeamInviteInput,
  CompanyRepository,
  CreateAreaInput,
  CreateRoleTemplateInput,
  CreateTeamInviteInput,
  CreateTeamMemberInput,
  UpdateAreaInput,
  UpdateTeamMemberInput,
  TeamMember
} from "./company.types";

function normalizeRequiredName(value: string, errorCode: string) {
  const name = value.trim();
  if (!name) throw new Error(errorCode);
  return name;
}

function normalizeOptionalText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function normalizeOptionalEmail(value: string | null | undefined) {
  const email = normalizeOptionalText(value);
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("TEAM_MEMBER_EMAIL_INVALID");
  return email;
}

export function createCompanyService(repository: CompanyRepository) {
  return {
    listAreas(workspaceId: string) {
      return repository.listAreas(workspaceId);
    },

    async createArea(workspaceId: string, input: CreateAreaInput) {
      return repository.createArea({
        workspaceId,
        name: normalizeRequiredName(input.name, "AREA_NAME_REQUIRED"),
        description: normalizeOptionalText(input.description)
      });
    },

    async updateArea(workspaceId: string, areaId: string, input: UpdateAreaInput) {
      const current = await repository.findAreaById(workspaceId, areaId);
      if (!current) throw new Error("AREA_NOT_FOUND");

      return repository.updateArea({
        ...current,
        name: normalizeRequiredName(input.name, "AREA_NAME_REQUIRED"),
        description: normalizeOptionalText(input.description)
      });
    },

    async deleteArea(workspaceId: string, areaId: string) {
      const area = await repository.findAreaById(workspaceId, areaId);
      if (!area) throw new Error("AREA_NOT_FOUND");

      const roleTemplates = await repository.listRoleTemplates(workspaceId);
      const roleTemplateIds = new Set(
        roleTemplates.filter((roleTemplate) => roleTemplate.areaId === areaId).map((roleTemplate) => roleTemplate.id)
      );
      const teamMembers = await repository.listTeamMembers(workspaceId);
      const teamInvites = await repository.listTeamInvites(workspaceId);

      await Promise.all(teamMembers.map((member) => {
        const hasDeletedArea = member.areaId === areaId;
        const hasDeletedRole = member.roleTemplateId ? roleTemplateIds.has(member.roleTemplateId) : false;
        if (!hasDeletedArea && !hasDeletedRole) return Promise.resolve(member);

        return repository.updateTeamMember({
          ...member,
          areaId: hasDeletedArea ? null : member.areaId,
          roleTemplateId: hasDeletedRole ? null : member.roleTemplateId
        });
      }));

      await Promise.all(teamInvites.map((invite) => {
        const hasDeletedArea = invite.areaId === areaId;
        const hasDeletedRole = invite.roleTemplateId ? roleTemplateIds.has(invite.roleTemplateId) : false;
        if (!hasDeletedArea && !hasDeletedRole) return Promise.resolve(invite);

        return repository.updateTeamInvite({
          ...invite,
          areaId: hasDeletedArea ? null : invite.areaId,
          roleTemplateId: hasDeletedRole ? null : invite.roleTemplateId,
          accessScope: (hasDeletedArea && invite.accessScope === "area") || (hasDeletedRole && invite.accessScope === "assigned_only")
            ? "workspace"
            : invite.accessScope
        });
      }));

      await Promise.all([...roleTemplateIds].map((roleTemplateId) => repository.deleteRoleTemplate(workspaceId, roleTemplateId)));
      await repository.deleteArea(workspaceId, areaId);

      return area;
    },

    listRoleTemplates(workspaceId: string) {
      return repository.listRoleTemplates(workspaceId);
    },

    async createRoleTemplate(workspaceId: string, input: CreateRoleTemplateInput) {
      const area = await repository.findAreaById(workspaceId, input.areaId);
      if (!area) throw new Error("AREA_NOT_FOUND");

      return repository.createRoleTemplate({
        workspaceId,
        areaId: input.areaId,
        name: normalizeRequiredName(input.name, "ROLE_TEMPLATE_NAME_REQUIRED"),
        description: normalizeOptionalText(input.description)
      });
    },

    async deleteRoleTemplate(workspaceId: string, roleTemplateId: string) {
      const roleTemplate = (await repository.listRoleTemplates(workspaceId)).find((item) => item.id === roleTemplateId);
      if (!roleTemplate) throw new Error("ROLE_TEMPLATE_NOT_FOUND");

      const teamMembers = await repository.listTeamMembers(workspaceId);
      const teamInvites = await repository.listTeamInvites(workspaceId);

      await Promise.all(teamMembers.map((member) => {
        if (member.roleTemplateId !== roleTemplateId) return Promise.resolve(member);

        return repository.updateTeamMember({
          ...member,
          roleTemplateId: null
        });
      }));

      await Promise.all(teamInvites.map((invite) => {
        if (invite.roleTemplateId !== roleTemplateId) return Promise.resolve(invite);

        return repository.updateTeamInvite({
          ...invite,
          roleTemplateId: null,
          accessScope: invite.accessScope === "assigned_only" ? "workspace" : invite.accessScope
        });
      }));

      await repository.deleteRoleTemplate(workspaceId, roleTemplateId);
      return roleTemplate;
    },

    listTeamMembers(workspaceId: string) {
      return repository.listTeamMembers(workspaceId);
    },

    async updateTeamMember(workspaceId: string, personId: string, input: UpdateTeamMemberInput) {
      const current = await repository.findTeamMember(workspaceId, personId);
      if (!current) throw new Error("TEAM_MEMBER_NOT_FOUND");

      if (input.areaId) {
        const area = await repository.findAreaById(workspaceId, input.areaId);
        if (!area) throw new Error("AREA_NOT_FOUND");
      }

      if (input.roleTemplateId) {
        const roleTemplate = (await repository.listRoleTemplates(workspaceId)).find((item) => item.id === input.roleTemplateId);
        if (!roleTemplate) throw new Error("ROLE_TEMPLATE_NOT_FOUND");
        if (input.areaId && roleTemplate.areaId !== input.areaId) throw new Error("ROLE_TEMPLATE_AREA_MISMATCH");
      }

      return repository.updateTeamMember({
        ...current,
        name: normalizeRequiredName(input.name, "TEAM_MEMBER_NAME_REQUIRED"),
        email: normalizeOptionalEmail(input.email),
        role: input.role,
        areaId: normalizeOptionalText(input.areaId),
        roleTemplateId: normalizeOptionalText(input.roleTemplateId),
        status: input.status ?? current.status
      });
    },

    async createTeamMember(workspaceId: string, input: CreateTeamMemberInput) {
      if (input.areaId) {
        const area = await repository.findAreaById(workspaceId, input.areaId);
        if (!area) throw new Error("AREA_NOT_FOUND");
      }

      return repository.createTeamMember({
        workspaceId,
        name: normalizeRequiredName(input.name, "TEAM_MEMBER_NAME_REQUIRED"),
        email: normalizeOptionalEmail(input.email),
        role: input.role,
        areaId: normalizeOptionalText(input.areaId),
        roleTemplateId: normalizeOptionalText(input.roleTemplateId),
        status: input.status ?? "active",
        createdByProfileId: input.createdByProfileId
      });
    },

    async deleteTeamMember(workspaceId: string, personId: string) {
      const member = await repository.findTeamMember(workspaceId, personId);
      if (!member) throw new Error("TEAM_MEMBER_NOT_FOUND");

      await repository.deleteTeamMember(workspaceId, personId);
      return member;
    },

    listTeamInvites(workspaceId: string) {
      return repository.listTeamInvites(workspaceId);
    },

    async findTeamInviteByCode(code: string) {
      return repository.findTeamInviteByCode(code.trim().toUpperCase());
    },

    async createTeamInvite(workspaceId: string, input: CreateTeamInviteInput) {
      return repository.createTeamInvite({
        workspaceId,
        name: normalizeRequiredName(input.name, "INVITE_NAME_REQUIRED"),
        email: normalizeOptionalEmail(input.email),
        role: input.role,
        areaId: normalizeOptionalText(input.areaId),
        roleTemplateId: normalizeOptionalText(input.roleTemplateId),
        accessScope: input.accessScope ?? "workspace",
        createdByProfileId: input.createdByProfileId
      });
    },

    async acceptTeamInvite(code: string, input: AcceptTeamInviteInput = {}) {
      const invite = await repository.findTeamInviteByCode(code.trim().toUpperCase());
      if (!invite) throw new Error("INVITE_NOT_FOUND");
      const memberInput = {
        workspaceId: invite.workspaceId,
        name: normalizeRequiredName(input.name ?? invite.name, "TEAM_MEMBER_NAME_REQUIRED"),
        email: normalizeOptionalEmail(input.email ?? invite.email),
        role: invite.role,
        areaId: invite.areaId,
        roleTemplateId: invite.roleTemplateId,
        status: "active",
        createdByProfileId: normalizeOptionalText(input.acceptedByProfileId) ?? invite.createdByProfileId
      } satisfies Omit<TeamMember, "id" | "createdAt" | "updatedAt">;

      if (repository.acceptTeamInviteAtomically) {
        return repository.acceptTeamInviteAtomically(invite, memberInput);
      }
      if (invite.status !== "pending") throw new Error("INVITE_ALREADY_ACCEPTED");

      const member = await repository.createTeamMember(memberInput);

      const acceptedInvite = await repository.updateTeamInvite({
        ...invite,
        status: "accepted"
      }, {
        updatedAt: invite.updatedAt,
        status: invite.status
      });

      return {
        invite: acceptedInvite,
        person: member
      };
    },

    async deleteTeamInvite(workspaceId: string, inviteId: string) {
      const invite = (await repository.listTeamInvites(workspaceId)).find((item) => item.id === inviteId);
      if (!invite) throw new Error("INVITE_NOT_FOUND");

      await repository.deleteTeamInvite(workspaceId, inviteId, {
        updatedAt: invite.updatedAt,
        status: invite.status
      });
      return invite;
    }
  };
}
