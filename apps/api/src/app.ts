import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { BAASE_PRODUCT_KEY } from "@prymeira/baase-shared";
import { readRuntimeConfig, type BaaseRuntimeConfig } from "./config/runtime";
import { registerAccountAuthHook } from "./http/account-auth";
import { ApiError } from "./http/api-error";
import { registerAiRoutes } from "./modules/ai/ai.routes";
import { createInMemoryAiRepository } from "./modules/ai/in-memory-ai.repository";
import type { AiProvider, AiRepository } from "./modules/ai/ai.types";
import { createDefaultAiProvider } from "./modules/ai/providers/default-ai.provider";
import { registerAnnouncementRoutes } from "./modules/announcements/announcement.routes";
import { createInMemoryAnnouncementRepository } from "./modules/announcements/in-memory-announcement.repository";
import type { AnnouncementRepository } from "./modules/announcements/announcement.types";
import { registerCompanyRoutes } from "./modules/company/company.routes";
import { createInMemoryCompanyRepository } from "./modules/company/in-memory-company.repository";
import type { CompanyRepository } from "./modules/company/company.types";
import { registerDashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { registerOnboardingRoutes } from "./modules/onboarding/onboarding.routes";
import { createInMemoryOnboardingRepository } from "./modules/onboarding/in-memory-onboarding.repository";
import type { OnboardingRepository } from "./modules/onboarding/onboarding.types";
import { registerProcessRoutes } from "./modules/processes/process.routes";
import { createInMemoryProcessRepository } from "./modules/processes/in-memory-process.repository";
import type { ProcessRepository } from "./modules/processes/process.types";
import { registerRoutineRoutes } from "./modules/routines/routine.routes";
import { createInMemoryRoutineRepository } from "./modules/routines/in-memory-routine.repository";
import type { RoutineRepository } from "./modules/routines/routine.types";
import { registerTrainingRoutes } from "./modules/trainings/training.routes";
import { createInMemoryTrainingRepository } from "./modules/trainings/in-memory-training.repository";
import type { TrainingRepository } from "./modules/trainings/training.types";
import { registerTemplateRoutes } from "./modules/templates/template.routes";
import { registerSessionRoutes } from "./modules/session/session.routes";
import {
  createLocalDemoProcesses,
  createLocalDemoRoutines,
  createLocalDemoTasks,
  createLocalDemoTrainings
} from "./demo/local-demo-data";

export type BuildAppOptions = {
  companyRepository?: CompanyRepository;
  processRepository?: ProcessRepository;
  routineRepository?: RoutineRepository;
  trainingRepository?: TrainingRepository;
  announcementRepository?: AnnouncementRepository;
  onboardingRepository?: OnboardingRepository;
  aiRepository?: AiRepository;
  aiProvider?: AiProvider;
  runtimeConfig?: BaaseRuntimeConfig;
  seedDemoData?: boolean;
  accountAccessFetch?: typeof fetch;
};

const API_BODY_LIMIT_BYTES = 40 * 1024 * 1024;

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: false,
    bodyLimit: API_BODY_LIMIT_BYTES
  });
  const companyRepository = options.companyRepository ?? createInMemoryCompanyRepository();
  const processRepository = options.processRepository ?? createInMemoryProcessRepository({
    initialProcesses: options.seedDemoData ? createLocalDemoProcesses() : undefined
  });
  const routineRepository = options.routineRepository ?? createInMemoryRoutineRepository({
    initialRoutines: options.seedDemoData ? createLocalDemoRoutines() : undefined,
    initialTasks: options.seedDemoData ? createLocalDemoTasks() : undefined
  });
  const trainingRepository = options.trainingRepository ?? createInMemoryTrainingRepository({
    initialTrainings: options.seedDemoData ? createLocalDemoTrainings() : undefined
  });
  const announcementRepository = options.announcementRepository ?? createInMemoryAnnouncementRepository();
  const onboardingRepository = options.onboardingRepository ?? createInMemoryOnboardingRepository();
  const aiRepository = options.aiRepository ?? createInMemoryAiRepository();
  const aiProvider = options.aiProvider ?? createDefaultAiProvider();
  const runtimeConfig = options.runtimeConfig ?? readRuntimeConfig({
    BAASE_SEED_DEMO_DATA: options.seedDemoData ? "true" : undefined
  });

  app.register(cors, {
    origin: true
  });

  registerAccountAuthHook(app, {
    runtimeConfig,
    fetcher: options.accountAccessFetch
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      });
    }

    if (error instanceof Error && error.message === "ONBOARDING_SESSION_STALE") {
      return reply.status(409).send({
        error: {
          code: "ONBOARDING_SESSION_CHANGED",
          message: "O onboarding mudou durante a operação. Atualize e tente novamente.",
          details: {}
        }
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "REQUEST_VALIDATION_ERROR",
          message: "Dados inválidos para esta operação.",
          details: {
            issues: error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message
            }))
          }
        }
      });
    }

    const fastifyError = error as { statusCode?: unknown; code?: unknown };
    const statusCode = typeof fastifyError.statusCode === "number" ? fastifyError.statusCode : null;
    if (statusCode === 413 || fastifyError.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.status(413).send({
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "O arquivo enviado é grande demais para esta operação.",
          details: {
            limit_bytes: API_BODY_LIMIT_BYTES
          }
        }
      });
    }

    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: {
          code: typeof fastifyError.code === "string" ? fastifyError.code : "REQUEST_ERROR",
          message: "Requisição inválida para esta operação.",
          details: {}
        }
      });
    }

    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Erro interno na API Baase.",
        details: {}
      }
    });
  });

  app.get("/health", async () => ({
    ok: true,
    service: "baase-api",
    product_key: BAASE_PRODUCT_KEY
  }));

  app.get("/readiness", async () => ({
    ok: runtimeConfig.ok,
    service: "baase-api",
    mode: runtimeConfig.mode,
    auth: {
      mode: runtimeConfig.auth.mode,
      account_api_configured: Boolean(runtimeConfig.auth.accountApiUrl)
    },
    persistence: runtimeConfig.persistence,
    operational_store: runtimeConfig.operationalStore,
    demo_seed_enabled: runtimeConfig.demoSeedEnabled,
    ai: runtimeConfig.ai,
    warnings: runtimeConfig.warnings
  }));

  app.register((routes) => registerSessionRoutes(routes, onboardingRepository, companyRepository));
  app.register((routes) => registerCompanyRoutes(routes, companyRepository));
  app.register((routes) => registerDashboardRoutes(routes, {
    companyRepository,
    processRepository,
    routineRepository,
    trainingRepository
  }));
  app.register((routes) => registerOnboardingRoutes(routes, {
    companyRepository,
    processRepository,
    routineRepository,
    trainingRepository,
    announcementRepository,
    onboardingRepository,
    aiRepository,
    aiProvider
  }));
  app.register((routes) => registerProcessRoutes(routes, processRepository));
  app.register((routes) => registerRoutineRoutes(routes, routineRepository, {
    trainingRepository,
    announcementRepository
  }));
  app.register((routes) => registerTrainingRoutes(routes, trainingRepository));
  app.register((routes) => registerAnnouncementRoutes(routes, announcementRepository));
  app.register((routes) => registerTemplateRoutes(routes, {
    processRepository,
    routineRepository,
    trainingRepository
  }));
  app.register((routes) => registerAiRoutes(routes, aiRepository, aiProvider, {
    companyRepository,
    processRepository,
    routineRepository,
    trainingRepository
  }));

  return app;
}
