import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canEditCompanyBase } from "@prymeira/baase-shared";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext } from "../../http/auth-context";
import { createCompanyService } from "./company.service";
import type { CompanyRepository } from "./company.types";

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
  role_template_id: z.string().optional().nullable(),
  access_scope: z.enum(["workspace", "area", "assigned_only"]).optional()
});

const createPersonSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().optional().nullable(),
  role: z.enum(["owner", "manager", "employee"]),
  area_id: z.string().optional().nullable(),
  role_template_id: z.string().optional().nullable()
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
  return error;
}

export async function registerCompanyRoutes(app: FastifyInstance, repository: CompanyRepository) {
  const service = createCompanyService(repository);

  app.get("/areas", async (request) => {
    const context = readRequestContext(request);
    const areas = await service.listAreas(context.workspaceId);
    return { areas };
  });

  app.post("/areas", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const body = createAreaSchema.parse(request.body);
    const area = await service.createArea(context.workspaceId, body);
    return reply.status(201).send({ area });
  });

  app.patch("/areas/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const params = idParamsSchema.parse(request.params);
    const body = createAreaSchema.parse(request.body);

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

    const params = idParamsSchema.parse(request.params);

    try {
      await service.deleteArea(context.workspaceId, params.id);
      return { ok: true };
    } catch (error) {
      throw companyMutationError(error);
    }
  });

  app.get("/roles", async (request) => {
    const context = readRequestContext(request);
    const roleTemplates = await service.listRoleTemplates(context.workspaceId);
    return { role_templates: roleTemplates };
  });

  app.post("/roles", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const body = createRoleTemplateSchema.parse(request.body);
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

    try {
      await service.deleteRoleTemplate(context.workspaceId, params.id);
      return { ok: true };
    } catch (error) {
      throw companyMutationError(error);
    }
  });

  app.get("/people", async (request) => {
    const context = readRequestContext(request);
    const people = await service.listTeamMembers(context.workspaceId);
    return { people };
  });

  app.post("/people", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const body = createPersonSchema.parse(request.body);
    const person = await service.createTeamMember(context.workspaceId, {
      name: body.name,
      email: body.email,
      role: body.role,
      areaId: body.area_id,
      roleTemplateId: body.role_template_id,
      createdByProfileId: context.profileId
    });

    return reply.status(201).send({ person });
  });

  app.patch("/people/:id", async (request) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const params = idParamsSchema.parse(request.params);
    const body = updatePersonSchema.parse(request.body);

    try {
      const person = await service.updateTeamMember(context.workspaceId, params.id, {
        name: body.name,
        email: body.email,
        role: body.role,
        areaId: body.area_id,
        roleTemplateId: body.role_template_id,
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

    try {
      await service.deleteTeamMember(context.workspaceId, params.id);
      return { ok: true };
    } catch (error) {
      throw companyMutationError(error);
    }
  });

  app.get("/invites", async (request) => {
    const context = readRequestContext(request);
    const invites = await service.listTeamInvites(context.workspaceId);
    return { invites };
  });

  app.get("/invites/:code", async (request) => {
    const params = inviteCodeParamsSchema.parse(request.params);
    const invite = await service.findTeamInviteByCode(params.code);
    if (!invite) throw new ApiError(404, "INVITE_NOT_FOUND", "Convite não encontrado.");
    return { invite };
  });

  app.post("/invites", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canEditCompanyBase(context.role)) throw forbiddenError();

    const body = createInviteSchema.parse(request.body);
    const invite = await service.createTeamInvite(context.workspaceId, {
      name: body.name,
      email: body.email,
      role: body.role,
      areaId: body.area_id,
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

    try {
      await service.deleteTeamInvite(context.workspaceId, params.id);
      return { ok: true };
    } catch (error) {
      throw companyMutationError(error);
    }
  });

  app.post("/invites/:code/accept", async (request) => {
    const params = inviteCodeParamsSchema.parse(request.params);
    const body = acceptInviteSchema.parse(request.body ?? {});

    try {
      return await service.acceptTeamInvite(params.code, body);
    } catch (error) {
      throw inviteError(error);
    }
  });
}
