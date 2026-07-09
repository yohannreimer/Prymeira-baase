import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canManageKnowledge } from "@prymeira/baase-shared";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext } from "../../http/auth-context";
import { createProcessService } from "../processes/process.service";
import type { ProcessRepository } from "../processes/process.types";
import { createRoutineService } from "../routines/routine.service";
import type { RoutineRepository } from "../routines/routine.types";
import { createTrainingService } from "../trainings/training.service";
import type { TrainingRepository } from "../trainings/training.types";
import { findTemplate, listTemplates, readTemplateFilters, summarizeTemplate } from "./template-library";

const listTemplatesQuerySchema = z.object({
  segment: z.string().optional(),
  area: z.string().optional(),
  kind: z.enum(["process", "routine", "training"]).optional()
});

const templateParamsSchema = z.object({
  id: z.string().min(1)
});

type TemplateRouteRepositories = {
  processRepository: ProcessRepository;
  routineRepository: RoutineRepository;
  trainingRepository: TrainingRepository;
};

export async function registerTemplateRoutes(app: FastifyInstance, repositories: TemplateRouteRepositories) {
  const processService = createProcessService(repositories.processRepository);
  const routineService = createRoutineService(repositories.routineRepository);
  const trainingService = createTrainingService(repositories.trainingRepository);

  app.get("/templates", async (request) => {
    const query = listTemplatesQuerySchema.parse(request.query);
    return {
      templates: listTemplates(query),
      filters: readTemplateFilters()
    };
  });

  app.post("/templates/:id/use", async (request, reply) => {
    const context = readRequestContext(request);
    if (!canManageKnowledge(context.role)) throw forbiddenError();

    const params = templateParamsSchema.parse(request.params);
    const template = findTemplate(params.id);
    if (!template) throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Modelo não encontrado.");

    if (template.kind === "process") {
      const process = await processService.createProcess(context.workspaceId, context.profileId, template.content);
      return reply.status(201).send({
        kind: template.kind,
        template: summarizeTemplate(template),
        process
      });
    }

    if (template.kind === "routine") {
      const routine = await routineService.createRoutine(context.workspaceId, context.profileId, template.content);
      return reply.status(201).send({
        kind: template.kind,
        template: summarizeTemplate(template),
        routine
      });
    }

    const training = await trainingService.createTraining(context.workspaceId, context.profileId, template.content);
    return reply.status(201).send({
      kind: template.kind,
      template: summarizeTemplate(template),
      training
    });
  });
}

