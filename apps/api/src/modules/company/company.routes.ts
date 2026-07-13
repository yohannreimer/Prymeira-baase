import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canEditCompanyBase } from "@prymeira/baase-shared";
import type { BaaseAuthMode } from "../../config/runtime";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext, requireOperationalMembership } from "../../http/auth-context";
import { canManageAreaResource, canReadAreaResource, visibleAreaIds } from "./access-policy";
import { createAccountHubTeamClient } from "./account-hub-team.client";
import { createCompanyService } from "./company.service";
import { createAreaLifecycleService } from "./area-lifecycle.service";
import type { AreaLifecycleRepository, CompanyRepository, OperationalMembership } from "./company.types";

const createAreaSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(240).optional().nullable()
});

const createRoleTemplateSchema = z.object({
  area_id: z.string().min(1),
  name: z.string().min(1).max(80),
  description: z.string().max(240).optional().nullable()
});

const createInviteSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().optional().nullable(),
  role: z.enum(["owner", "manager", "employee"]),
  area_id: z.string().optional().nullable(),
  area_ids: z.array(z.string().min(1)).max(20).optional(),
  role_template_id: z.string().optional().nullable(),
  access_scope: z.enum(["workspace", "area", "assigned_only"]).optional()
});

const createPersonSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().optional().nullable(),
  role: z.enum(["owner", "manager", "employee"]),
  area_id: z.string().optional().nullable(),
  area_ids: z.array(z.string().min(1)).max(20).optional(),
  role_template_id: z.string().optional().nullable(),
  access_scope: z.enum(["workspace", "area", "assigned_only"]).optional()
});

const updatePersonSchema = createPersonSchema.extend({
  status: z.enum(["active", "inactive"]).optional()
});

const inviteCodeParamsSchema = z.object({
  code: z.string().min(1)
});

const idParamsSchema = z.object({
  id: z.string().min(1)
});

const archiveAreaSchema = z.union([
  z.object({ strategy: z.literal("reassign"), target_area_id: z.string().min(1) }).strict(),
  z.object({ strategy: z.literal("unassign") }).strict(),
  z.object({}).strict()
]);

const acceptInviteSchema = z.object({
  name: z.string().min(1).max(120).optional().nullable(),
  email: z.string().email().optional().nullable()
});

function inviteError(error: unknown) {
  if (error instanceof Error && error.message === "INVITE_NOT_FOUND") {
    return new ApiError(404, "INVITE_NOT_FOUND", "Convite não encontrado.");
  }
  if (error instanceof Error && error.message === "INVITE_ALREADY_ACCEPTED") {
    return new ApiError(409, "INVITE_ALREADY_ACCEPTED", "Este convite já foi aceito.");
  }
  return error;
}

function companyMutationError(error: unknown) {
  if (error instanceof Error && error.message === "TEAM_MEMBER_NOT_FOUND") {
    return new ApiError(404, "TEAM_MEMBER_NOT_FOUND", "Pessoa não encontrada.");
  }
  if (error instanceof Error && error.message === "INVITE_NOT_FOUND") {
    return new ApiError(404, "INVITE_NOT_FOUND", "Convite não encontrado.");
  }
  if (error instanceof Error && error.message === "AREA_NOT_FOUND") {
    return new ApiError(404, "AREA_NOT_FOUND", "Área não encontrada.");
  }
  if (error instanceof Error && error.message === "ROLE_TEMPLATE_NOT_FOUND") {
    return new ApiError(404, "ROLE_TEMPLATE_NOT_FOUND", "Cargo não encontrado.");
  }
  if (error instanceof Error && error.message === "ROLE_TEMPLATE_AREA_MISMATCH") {
    return new ApiError(400, "ROLE_TEMPLATE_AREA_MISMATCH", "Este cargo não pertence à área selecionada.");
  }
  if (error instanceof Error && error.message === "TEAM_MEMBER_AREA_ACCESS_REQUIRED") {
    return new ApiError(400, "TEAM_MEMBER_AREA_ACCESS_REQUIRED", "Selecione ao menos uma área para este escopo de acesso.");
  }
  if (error instanceof Error && error.message === "AREA_ARCHIVE_RESOLUTION_REQUIRED") {
    return new ApiError(409, "AREA_ARCHIVE_RESOLUTION_REQUIRED", "Resolva os vínculos ativos antes de arquivar esta área.");
  }
  if (error instanceof Error && error.message === "AREA_ARCHIVE_TARGET_SAME") {
    return new ApiError(400, "AREA_ARCHIVE_TARGET_SAME", "A área de destino deve ser diferente da área arquivada.");
  }
  if (error instanceof Error && error.message === "AREA_ARCHIVE_TARGET_NOT_FOUND") {
    return new ApiError(400, "AREA_ARCHIVE_TARGET_NOT_FOUND", "A área de destino não existe ou está arquivada.");
  }
  return error;
}

function scopeForbidden() {
  return new ApiError(403, "BAASE_SCOPE_FORBIDDEN", "Você não tem acesso a esta área ou pessoa.");
}

function requireOwner(membership: OperationalMembership) {
  if (membership.role !== "owner") throw scopeForbidden();
}

async function requireManagedArea(repository: CompanyRepository, workspaceId: string, areaId: string, membership: OperationalMembership) {
  const area = await repository.findAreaById(workspaceId, areaId);
  if (!area) throw companyMutationError(new Error("AREA_NOT_FOUND"));
  if (!canManageAreaResource(membership, area.id)) throw scopeForbidden();
  return area;
}

async function assertManagedPersonInput(
  repository: CompanyRepository,
  workspaceId: string,
  membership: OperationalMembership,
  input: {
    role: "owner" | "manager" | "employee";
    area_id?: string | null;
    area_ids?: string[];
    role_template_id?: string | null;
    access_scope?: "workspace" | "area" | "assigned_only";
  }
) {
  if (membership.role === "owner") return;
  if (membership.role !== "manager" || input.role !== "employee" || input.access_scope === "workspace") throw scopeForbidden();

  const areaIds = [...new Set([...(input.area_ids ?? []), ...(input.area_id ? [input.area_id] : [])])];
  if (areaIds.some((areaId) => !canManageAreaResource(membership, areaId))) throw scopeForbidden();

  if (input.role_template_id) {
    const roleTemplate = (await repository.listRoleTemplates(workspaceId)).find((item) => item.id === input.role_template_id);
    if (!roleTemplate) throw companyMutationError(new Error("ROLE_TEMPLATE_NOT_FOUND"));
    if (!canManageAreaResource(membership, roleTemplate.areaId)) throw scopeForbidden();
  }
}

export async function registerCompanyRoutes(
  app: FastifyInstance,
  repository: CompanyRepository,
  areaLifecycleRepository: AreaLifecycleRepository,
  options: { authMode?: BaaseAuthMode; accountApiUrl?: string | null; accountTeamFetch?: typeof fetch } = {}
) {
  const service = createCompanyService(repository);
  const areaLifecycle = createAreaLifecycleService(areaLifecycleRepository);
  const authMode = options.authMode ?? "local";
  const accountHubTeam = authMode === "account" && options.accountApiUrl
    ? createAccountHubTeamClient({ accountApiUrl: options.accountApiUrl, fetcher: options.accountTeamFetch })
    : null;

  app.get("/areas", async (request) => {
    const context = readRequestContext(request);
    const membership = requireOperationalMembership(request);
    const areas = await service.listAreas(context.workspaceId);
    const allowedIds = visibleAreaIds(membership);
    return { areas: allowedIds === null ? areas : areas.filter((area) => allowedIds.includes(area.id)) };
  });

  app.post("/areas", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();
    requireOwner(requireOperationalMembership(request));

    const body = createAreaSchema.parse(request.body);
    const area = await service.createArea(context.workspaceId, body);
    return reply.status(201).send({ area });
  });

  app.patch("/areas/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const params = idParamsSchema.parse(request.params);
    const body = createAreaSchema.parse(request.body);
    await requireManagedArea(repository, context.workspaceId, params.id, requireOperationalMembership(request));

    try {
      const area = await service.updateArea(context.workspaceId, params.id, body);
      return { area };
    } catch (error) {
      throw companyMutationError(error);
    }
  });

  app.delete("/areas/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();
    requireOwner(requireOperationalMembership(request));

    const params = idParamsSchema.parse(request.params);

    try {
      await areaLifecycle.archive(context.workspaceId, params.id, context.profileId);
      return { ok: true };
    } catch (error) {
      throw companyMutationError(error);
    }
  });

  app.get("/areas/:id/impact", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();
    const params = idParamsSchema.parse(request.params);
    await requireManagedArea(repository, context.workspaceId, params.id, requireOperationalMembership(request));
    try {
      return { impact: await areaLifecycle.getImpact(context.workspaceId, params.id) };
    } catch (error) {
      throw companyMutationError(error);
    }
  });

  app.post("/areas/:id/archive", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();
    requireOwner(requireOperationalMembership(request));
    const params = idParamsSchema.parse(request.params);
    const body = archiveAreaSchema.parse(request.body ?? {});
    const resolution = body.strategy === "reassign"
      ? { strategy: "reassign" as const, targetAreaId: body.target_area_id }
      : body.strategy === "unassign" ? { strategy: "unassign" as const } : undefined;
    try {
      return { result: await areaLifecycle.archive(context.workspaceId, params.id, context.profileId, resolution) };
    } catch (error) {
      throw companyMutationError(error);
    }
  });

  app.get("/roles", async (request) => {
    const context = readRequestContext(request);
    const membership = requireOperationalMembership(request);
    const roleTemplates = await service.listRoleTemplates(context.workspaceId);
    return { role_templates: roleTemplates.filter((role) => canReadAreaResource(membership, role.areaId)) };
  });

  app.post("/roles", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const body = createRoleTemplateSchema.parse(request.body);
    await requireManagedArea(repository, context.workspaceId, body.area_id, requireOperationalMembership(request));
    const roleTemplate = await service.createRoleTemplate(context.workspaceId, {
      areaId: body.area_id,
      name: body.name,
      description: body.description
    });

    return reply.status(201).send({ role_template: roleTemplate });
  });

  app.delete("/roles/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const params = idParamsSchema.parse(request.params);
    const membership = requireOperationalMembership(request);
    const roleTemplate = (await repository.listRoleTemplates(context.workspaceId)).find((item) => item.id === params.id);
    if (!roleTemplate) throw companyMutationError(new Error("ROLE_TEMPLATE_NOT_FOUND"));
    if (!canManageAreaResource(membership, roleTemplate.areaId)) throw scopeForbidden();

    try {
      await service.deleteRoleTemplate(context.workspaceId, params.id);
      return { ok: true };
    } catch (error) {
      throw companyMutationError(error);
    }
  });

  app.get("/people", async (request) => {
    const context = readRequestContext(request);
    const membership = requireOperationalMembership(request);
    const people = await service.listTeamMembers(context.workspaceId);
    if (membership.role === "employee") return { people: people.filter((person) => person.id === membership.personId) };
    if (membership.role === "manager" && membership.accessScope !== "workspace") {
      return { people: people.filter((person) => person.id === membership.personId || (person.areaId !== null && canReadAreaResource(membership, person.areaId))) };
    }
    return { people };
  });

  app.post("/people", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const body = createPersonSchema.parse(request.body);
    await assertManagedPersonInput(repository, context.workspaceId, requireOperationalMembership(request), body);
    const person = await service.createTeamMember(context.workspaceId, {
      name: body.name,
      email: body.email,
      role: body.role,
      areaId: body.area_id,
      areaAccessIds: body.area_ids,
      roleTemplateId: body.role_template_id,
      accessScope: body.access_scope,
      createdByProfileId: context.profileId
    });

    return reply.status(201).send({ person });
  });

  app.patch("/people/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const params = idParamsSchema.parse(request.params);
    const body = updatePersonSchema.parse(request.body);
    const membership = requireOperationalMembership(request);
    const existing = await repository.findTeamMember(context.workspaceId, params.id);
    if (!existing) throw companyMutationError(new Error("TEAM_MEMBER_NOT_FOUND"));
    if (membership.role !== "owner") {
      if (existing.role === "owner" || existing.id === membership.personId || !canManageAreaResource(membership, existing.areaId)) throw scopeForbidden();
      await assertManagedPersonInput(repository, context.workspaceId, membership, body);
    }

    try {
      const person = await service.updateTeamMember(context.workspaceId, params.id, {
        name: body.name,
        email: body.email,
        role: body.role,
        areaId: body.area_id,
        areaAccessIds: body.area_ids,
        roleTemplateId: body.role_template_id,
        accessScope: body.access_scope,
        status: body.status
      });

      return { person };
    } catch (error) {
      throw companyMutationError(error);
    }
  });

  app.delete("/people/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const params = idParamsSchema.parse(request.params);
    const membership = requireOperationalMembership(request);
    const existing = await repository.findTeamMember(context.workspaceId, params.id);
    if (!existing) throw companyMutationError(new Error("TEAM_MEMBER_NOT_FOUND"));
    if (membership.role !== "owner" && (existing.role === "owner" || existing.id === membership.personId || !canManageAreaResource(membership, existing.areaId))) {
      throw scopeForbidden();
    }

    try {
      await service.deleteTeamMember(context.workspaceId, params.id);
      return { ok: true };
    } catch (error) {
      throw companyMutationError(error);
    }
  });

  app.get("/invites", async (request) => {
    const context = readRequestContext(request);
    const membership = requireOperationalMembership(request);
    if (membership.role === "employee") throw forbiddenError();
    const invites = await service.listTeamInvites(context.workspaceId);
    if (membership.role === "manager" && membership.accessScope !== "workspace") {
      return { invites: invites.filter((invite) => invite.areaId !== null && canReadAreaResource(membership, invite.areaId)) };
    }
    return { invites };
  });

  app.get("/invites/:code", async (request) => {
    if (authMode === "account") throw legacyInviteFlowDisabled();
    const params = inviteCodeParamsSchema.parse(request.params);
    const invite = await service.findTeamInviteByCode(params.code);
    if (!invite) throw new ApiError(404, "INVITE_NOT_FOUND", "Convite não encontrado.");
    return { invite };
  });

  app.post("/invites", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const body = createInviteSchema.parse(request.body);
    await assertManagedPersonInput(repository, context.workspaceId, requireOperationalMembership(request), body);
    if (authMode === "account") {
      if (context.role !== "owner") throw forbiddenError();
      if (!context.externalIdentity || !accountHubTeam) {
        throw new ApiError(500, "ACCOUNT_HUB_INVITE_NOT_CONFIGURED", "O convite pelo Prymeira Hub não está configurado.");
      }
      if (!body.email) throw new ApiError(400, "INVITE_EMAIL_REQUIRED", "Informe o e-mail para enviar um convite.");

      const hubInvite = await accountHubTeam.inviteBaseMember({
        bearerToken: context.externalIdentity.bearerToken,
        email: body.email,
        name: body.name
      });
      const invite = await service.createTeamInvite(context.workspaceId, {
        name: body.name,
        email: body.email,
        role: body.role,
        areaId: body.area_id,
        areaAccessIds: body.area_ids,
        roleTemplateId: body.role_template_id,
        accessScope: body.access_scope,
        hubInvitationId: hubInvite.invitationId,
        hubStatus: hubInvite.status,
        createdByProfileId: context.profileId
      });
      return reply.status(201).send({ invite });
    }

    const invite = await service.createTeamInvite(context.workspaceId, {
      name: body.name,
      email: body.email,
      role: body.role,
      areaId: body.area_id,
      areaAccessIds: body.area_ids,
      roleTemplateId: body.role_template_id,
      accessScope: body.access_scope,
      createdByProfileId: context.profileId
    });

    return reply.status(201).send({ invite });
  });

  app.delete("/invites/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const params = idParamsSchema.parse(request.params);
    const membership = requireOperationalMembership(request);
    const invite = (await repository.listTeamInvites(context.workspaceId)).find((item) => item.id === params.id);
    if (!invite) throw companyMutationError(new Error("INVITE_NOT_FOUND"));
    if (membership.role !== "owner" && (invite.role !== "employee" || !canManageAreaResource(membership, invite.areaId))) throw scopeForbidden();

    try {
      await service.deleteTeamInvite(context.workspaceId, params.id);
      return { ok: true };
    } catch (error) {
      throw companyMutationError(error);
    }
  });

  app.post("/invites/:code/accept", async (request) => {
    if (authMode === "account") throw legacyInviteFlowDisabled();
    const params = inviteCodeParamsSchema.parse(request.params);
    const body = acceptInviteSchema.parse(request.body ?? {});

    try {
      const invite = await service.findTeamInviteByCode(params.code);
      if (!invite) throw new Error("INVITE_NOT_FOUND");
      if (invite.status !== "pending") throw new Error("INVITE_ALREADY_ACCEPTED");
      return await service.acceptTeamInvite(params.code, body);
    } catch (error) {
      throw inviteError(error);
    }
  });
}

function legacyInviteFlowDisabled() {
  return new ApiError(410, "LEGACY_INVITE_FLOW_DISABLED", "Este convite deve ser aceito pelo Prymeira Hub.");
}
