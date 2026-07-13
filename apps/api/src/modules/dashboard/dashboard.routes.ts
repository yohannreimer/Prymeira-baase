import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { forbiddenError } from "../../http/api-error";
import { readRequestContext, requireOperationalMembership } from "../../http/auth-context";
import type { AnnouncementRepository } from "../announcements/announcement.types";
import type { CompanyRepository } from "../company/company.types";
import type { ProcessRepository } from "../processes/process.types";
import type { RoutineRepository } from "../routines/routine.types";
import type { TrainingRepository } from "../trainings/training.types";
import { createDashboardService } from "./dashboard.service";

const dashboardQuerySchema = z.object({
  date: z.string().min(10).max(10).optional()
});

const operationalOverviewQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date()
}).refine(({ from, to }) => from <= to, { message: "INVALID_PERIOD" });

type DashboardRouteRepositories = {
  companyRepository: CompanyRepository;
  processRepository: ProcessRepository;
  routineRepository: RoutineRepository;
  trainingRepository: TrainingRepository;
  announcementRepository: AnnouncementRepository;
};

export async function registerDashboardRoutes(app: FastifyInstance, repositories: DashboardRouteRepositories) {
  const service = createDashboardService(repositories);

  app.get("/dashboard", async (request) => {
    const context = readRequestContext(request);
    const query = dashboardQuerySchema.parse(request.query);

    return service.readDashboard({
      workspaceId: context.workspaceId,
      profileId: context.profileId,
      role: context.role,
      membership: requireOperationalMembership(request),
      date: query.date ?? new Date().toISOString().slice(0, 10)
    });
  });

  app.get("/operational-overview", async (request) => {
    const context = readRequestContext(request);
    if (context.role === "employee") throw forbiddenError();
    const query = operationalOverviewQuerySchema.parse(request.query);

    return service.readOperationalOverview({
      workspaceId: context.workspaceId,
      membership: requireOperationalMembership(request),
      from: query.from,
      to: query.to
    });
  });
}
