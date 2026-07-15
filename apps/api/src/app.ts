import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { BAASE_PRODUCT_KEY } from "@prymeira/baase-shared";
import { readRuntimeConfig, type BaaseRuntimeConfig } from "./config/runtime";
import { registerAccountAuthHook } from "./http/account-auth";
import { ApiError } from "./http/api-error";
import { registerAiRoutes } from "./modules/ai/ai.routes";
import { createInMemoryAiRepository } from "./modules/ai/in-memory-ai.repository";
import type { AiProvider, AiRepository } from "./modules/ai/ai.types";
import { createDefaultAiProvider } from "./modules/ai/providers/default-ai.provider";
import { createAiHarness } from "./modules/ai/ai-harness";
import { registerAnnouncementRoutes } from "./modules/announcements/announcement.routes";
import { createInMemoryAnnouncementRepository } from "./modules/announcements/in-memory-announcement.repository";
import type { AnnouncementRepository } from "./modules/announcements/announcement.types";
import { registerCompanyRoutes } from "./modules/company/company.routes";
import { createInMemoryAreaLifecycleRepository } from "./modules/company/area-lifecycle.service";
import { createInMemoryCompanyRepository } from "./modules/company/in-memory-company.repository";
import type { AreaLifecycleRepository, CompanyRepository } from "./modules/company/company.types";
import { registerDashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { registerOnboardingRoutes } from "./modules/onboarding/onboarding.routes";
import { createInMemoryOnboardingRepository } from "./modules/onboarding/in-memory-onboarding.repository";
import type { OnboardingRepository } from "./modules/onboarding/onboarding.types";
import { registerProcessRoutes } from "./modules/processes/process.routes";
import { createInMemoryProcessRepository } from "./modules/processes/in-memory-process.repository";
import type { ProcessRepository } from "./modules/processes/process.types";
import { registerProcessMaterialRoutes } from "./modules/processes/process-material.routes";
import { createInMemoryObjectStorage } from "./storage/in-memory-object-storage";
import type { ObjectStorage } from "./storage/object-storage";
import { registerRoutineRoutes } from "./modules/routines/routine.routes";
import { createInMemoryRoutineRepository } from "./modules/routines/in-memory-routine.repository";
import type { RoutineRepository } from "./modules/routines/routine.types";
import { registerTrainingRoutes } from "./modules/trainings/training.routes";
import { createInMemoryTrainingRepository } from "./modules/trainings/in-memory-training.repository";
import type { TrainingRepository } from "./modules/trainings/training.types";
import { registerTemplateRoutes } from "./modules/templates/template.routes";
import { registerSessionRoutes } from "./modules/session/session.routes";
import { createInMemoryStudioRepository } from "./modules/studio/in-memory-studio.repository";
import { registerStudioRoutes } from "./modules/studio/studio.routes";
import {
  registerStudioAssetRoutes,
  type StudioLinkFetcher,
  type StudioLinkResolver
} from "./modules/studio/studio-assets.routes";
import { createStudioService } from "./modules/studio/studio.service";
import { createStudioContextBuilder } from "./modules/studio/studio-context-builder";
import { createStudioAssistantService } from "./modules/studio/studio-assistant.service";
import { createStudioRitualService } from "./modules/studio/studio-ritual.service";
import { registerStudioProactivityRoutes } from "./modules/studio/studio-proactivity.routes";
import {
  createInMemoryStudioProactivityStore,
  createStudioProactivityService,
  type StudioProactivityStore
} from "./modules/studio/studio-proactivity.service";
import { createPostgresStudioProactivityStore } from "./modules/studio/postgres-studio-proactivity.store";
import { registerStudioAssistantRoutes } from "./modules/studio/studio-assistant.routes";
import { registerStudioPortabilityRoutes } from "./modules/studio/studio-portability.routes";
import {
  createInMemoryStudioPortabilityStore,
  createStudioPortabilityService,
  type StudioPortabilityProactivityHooks,
  type StudioPortabilityRepositoryHooks,
  type StudioPortabilityStore
} from "./modules/studio/studio-portability.service";
import { createPostgresStudioPortabilityStore } from "./modules/studio/postgres-studio-portability.store";
import {
  createInMemoryStudioOperationsStore,
  createPostgresStudioOperationsStore,
  createStudioOperationsBridge
} from "./modules/studio/studio-operations-bridge";
import type { StudioRepository } from "./modules/studio/studio.types";
import type { OperationalPool } from "./db/operational-repository-support";
import {
  createInMemoryStudioMemoryIndex,
  createStudioMemoryIndexProcessor,
  STUDIO_MEMORY_DEFAULT_DIMENSIONS,
  type StudioMemoryIndex
} from "./modules/studio/studio-memory";
import { createPostgresStudioMemoryIndex } from "./modules/studio/postgres-studio-memory";
import { buildStudioReadiness } from "./modules/studio/studio-readiness";
import { createStudioAssetProcessor } from "./modules/studio/studio-asset-processor";
import { createStudioAssetCleanupProcessor } from "./modules/studio/studio-asset-cleanup";
import { createStudioAssetUploadCleanupProcessor } from "./modules/studio/studio-asset-upload-cleanup";
import type { StudioUploadSemaphore } from "./modules/studio/studio-asset-upload";
import {
  createLocalDemoProcesses,
  createLocalDemoRoutines,
  createLocalDemoTasks,
  createLocalDemoTrainings
} from "./demo/local-demo-data";

export type BuildAppOptions = {
  companyRepository?: CompanyRepository;
  areaLifecycleRepository?: AreaLifecycleRepository;
  processRepository?: ProcessRepository;
  objectStorage?: ObjectStorage;
  routineRepository?: RoutineRepository;
  trainingRepository?: TrainingRepository;
  announcementRepository?: AnnouncementRepository;
  onboardingRepository?: OnboardingRepository;
  aiRepository?: AiRepository;
  aiProvider?: AiProvider;
  studioRepository?: StudioRepository;
  studioMemoryIndex?: StudioMemoryIndex;
  studioMemoryPool?: OperationalPool;
  studioProactivityStore?: StudioProactivityStore;
  studioPortabilityStore?: StudioPortabilityStore;
  studioMemoryModel?: string;
  studioMemoryDimensions?: number;
  studioVectorPersistent?: boolean;
  studioMaintenanceAvailable?: boolean;
  studioLinkResolver?: StudioLinkResolver;
  studioLinkFetcher?: StudioLinkFetcher;
  studioUploadSemaphore?: StudioUploadSemaphore;
  studioUploadPutTimeoutMs?: number;
  studioUploadLeaseMs?: number;
  studioUploadLeaseHeartbeatMs?: number;
  studioUploadAbortTimeoutMs?: number;
  requestTimeoutMs?: number;
  runtimeConfig?: BaaseRuntimeConfig;
  seedDemoData?: boolean;
  now?: () => Date;
  accountAccessFetch?: typeof fetch;
  accountTeamFetch?: typeof fetch;
};

const API_BODY_LIMIT_BYTES = 40 * 1024 * 1024;
const API_REQUEST_TIMEOUT_MS = 120_000;

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: false,
    bodyLimit: API_BODY_LIMIT_BYTES,
    requestTimeout: options.requestTimeoutMs ?? API_REQUEST_TIMEOUT_MS
  });
  const runtimeConfig = options.runtimeConfig ?? readRuntimeConfig({
    BAASE_SEED_DEMO_DATA: options.seedDemoData ? "true" : undefined
  });
  const companyRepository = options.companyRepository ?? createInMemoryCompanyRepository();
  const processRepository = options.processRepository ?? createInMemoryProcessRepository({
    initialProcesses: options.seedDemoData ? createLocalDemoProcesses() : undefined
  });
  const objectStorage = options.objectStorage ?? createInMemoryObjectStorage();
  const routineRepository = options.routineRepository ?? createInMemoryRoutineRepository({
    initialRoutines: options.seedDemoData ? createLocalDemoRoutines() : undefined,
    initialTasks: options.seedDemoData ? createLocalDemoTasks() : undefined
  });
  const areaLifecycleRepository = options.areaLifecycleRepository ?? createInMemoryAreaLifecycleRepository({
    companyRepository,
    processRepository,
    routineRepository
  });
  const trainingRepository = options.trainingRepository ?? createInMemoryTrainingRepository({
    initialTrainings: options.seedDemoData ? createLocalDemoTrainings() : undefined
  });
  const announcementRepository = options.announcementRepository ?? createInMemoryAnnouncementRepository();
  const onboardingRepository = options.onboardingRepository ?? createInMemoryOnboardingRepository();
  const aiRepository = options.aiRepository ?? createInMemoryAiRepository();
  const openAiApiKey = process.env.OPENAI_API_KEY;
  const studioAiUnavailable = runtimeConfig.mode === "production"
    && runtimeConfig.studio.enabled
    && !options.aiProvider
    && !openAiApiKey;
  const aiProvider = options.aiProvider ?? createDefaultAiProvider({
    mode: runtimeConfig.mode,
    studioEnabled: runtimeConfig.studio.enabled,
    openAiApiKey
  });
  const studioRepository = options.studioRepository ?? createInMemoryStudioRepository();
  const aiHarness = createAiHarness({
    repository: aiRepository,
    provider: aiProvider,
    now: options.now ? () => options.now!().getTime() : undefined
  });
  const studioMemoryIndex = options.studioMemoryIndex ?? (options.studioMemoryPool
    ? createPostgresStudioMemoryIndex(options.studioMemoryPool, {
        embedder: aiHarness,
        model: options.studioMemoryModel ?? runtimeConfig.studio.embeddingModel,
        dimensions: options.studioMemoryDimensions ?? STUDIO_MEMORY_DEFAULT_DIMENSIONS,
        now: options.now ? () => options.now!().toISOString() : undefined
      })
    : createInMemoryStudioMemoryIndex({
        embedder: aiHarness,
        model: options.studioMemoryModel ?? runtimeConfig.studio.embeddingModel,
        dimensions: options.studioMemoryDimensions ?? STUDIO_MEMORY_DEFAULT_DIMENSIONS,
        now: options.now ? () => options.now!().toISOString() : undefined
      }));
  const studioMemoryIndexProcessor = createStudioMemoryIndexProcessor({
    repository: studioRepository,
    memoryIndex: studioMemoryIndex,
    now: options.now ? () => options.now!().toISOString() : undefined
  });
  const studioReadiness = buildStudioReadiness({
    runtimeConfig,
    aiAvailable: Boolean(options.aiProvider) || Boolean(openAiApiKey),
    hasPersistentVectorIndex: options.studioVectorPersistent ?? Boolean(options.studioMemoryPool),
    maintenanceAvailable: options.studioMaintenanceAvailable ?? true
  });
  const studioService = createStudioService(studioRepository, {
    now: options.now ? () => options.now!().toISOString() : undefined
  });
  const studioContextBuilder = createStudioContextBuilder({
    companyRepository,
    processRepository,
    routineRepository,
    trainingRepository,
    announcementRepository
  }, { now: options.now });
  const studioAssistantService = createStudioAssistantService({
    repository: studioRepository,
    harness: aiHarness,
    model: runtimeConfig.studio.aiModel,
    aiAvailable: !studioAiUnavailable,
    contextBuilder: studioContextBuilder,
    now: options.now
  });
  const studioRitualService = createStudioRitualService({
    repository: studioRepository,
    harness: aiHarness,
    model: runtimeConfig.studio.aiModel,
    contextBuilder: studioContextBuilder,
    memoryIndex: studioMemoryIndex,
    now: options.now
  });
  const studioProactivityStore = options.studioProactivityStore ?? (options.studioMemoryPool
    ? createPostgresStudioProactivityStore(options.studioMemoryPool)
    : createInMemoryStudioProactivityStore({
        now: options.now ? () => options.now!().toISOString() : undefined
      }));
  const studioProactivityService = createStudioProactivityService({
    store: studioProactivityStore,
    ritualService: studioRitualService,
    now: options.now
  });
  const studioOperationsStore = options.studioMemoryPool
    ? createPostgresStudioOperationsStore(options.studioMemoryPool)
    : createInMemoryStudioOperationsStore({ now: options.now ? () => options.now!().toISOString() : undefined });
  const studioOperationsBridge = createStudioOperationsBridge({
    studioRepository,
    operationsStore: studioOperationsStore,
    companyRepository,
    routineRepository,
    processRepository,
    announcementRepository,
    trainingRepository,
    now: options.now
  });
  const studioPortabilityStore = options.studioPortabilityStore ?? (options.studioMemoryPool
    ? createPostgresStudioPortabilityStore(options.studioMemoryPool)
    : createInMemoryStudioPortabilityStore({
        repository: hasStudioPortabilityHooks(studioRepository) ? studioRepository : undefined,
        proactivity: hasStudioProactivityPortabilityHooks(studioProactivityStore) ? studioProactivityStore : undefined,
        removeMemory: async (scope, documentIds) => {
          for (const documentId of documentIds) await studioMemoryIndex.removeDocument(scope, documentId);
        },
        markOperationalOriginsDeleted: (scope, deletedAt) => studioOperationsStore.markOwnerOriginsDeleted?.(scope, deletedAt) ?? Promise.resolve()
      }));
  const studioPortabilityService = createStudioPortabilityService({
    store: studioPortabilityStore,
    objectStorage,
    now: options.now,
    verifyOwner: async (actor) => {
      const member = await companyRepository.findTeamMember(actor.workspaceId, actor.profileId);
      if (!member && actor.workspaceId === "local_workspace" && actor.profileId === "local_profile") return true;
      return member?.role === "owner" && member.status === "active";
    }
  });
  const studioPortabilityReconciliationProcessor = {
    async processNext(signal?: AbortSignal, budget?: { excludeOwnerKeys?: readonly string[] }) {
      return studioPortabilityService.processNextMaintenance(signal, budget);
    }
  };
  const studioAssetProcessor = createStudioAssetProcessor({
    repository: studioRepository,
    objectStorage,
    transcriptionHarness: aiHarness,
    now: options.now ? () => options.now!().toISOString() : undefined
  });
  const studioAssetCleanupProcessor = createStudioAssetCleanupProcessor({
    repository: studioRepository,
    objectStorage,
    now: options.now ? () => options.now!().toISOString() : undefined
  });
  const studioAssetUploadCleanupProcessor = createStudioAssetUploadCleanupProcessor({
    repository: studioRepository,
    objectStorage,
    now: options.now ? () => options.now!().toISOString() : undefined
  });
  app.register(cors, {
    origin: true
  });
  app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 1 }
  });

  registerAccountAuthHook(app, {
    runtimeConfig,
    companyRepository,
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

    if (error instanceof Error && ["INVITE_CODE_CONFLICT", "INVITE_STALE", "PROCESS_STALE", "ROUTINE_STALE", "TASK_OCCURRENCE_STALE"].includes(error.message)) {
      return reply.status(409).send({
        error: {
          code: error.message,
          message: "O registro mudou durante a operação. Atualize e tente novamente.",
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
    if (statusCode === 413 || fastifyError.code === "FST_ERR_CTP_BODY_TOO_LARGE" || fastifyError.code === "FST_REQ_FILE_TOO_LARGE") {
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
    object_storage: runtimeConfig.objectStorage.provider,
    demo_seed_enabled: runtimeConfig.demoSeedEnabled,
    ai: runtimeConfig.ai,
    warnings: runtimeConfig.warnings
  }));

  app.register((routes) => registerSessionRoutes(routes, onboardingRepository, companyRepository));
  app.register((routes) => registerCompanyRoutes(routes, companyRepository, areaLifecycleRepository, {
    authMode: runtimeConfig.auth.mode,
    accountApiUrl: runtimeConfig.auth.accountApiUrl,
    accountTeamFetch: options.accountTeamFetch
  }));
  app.register((routes) => registerDashboardRoutes(routes, {
    companyRepository,
    processRepository,
    routineRepository,
    trainingRepository,
    announcementRepository
  }, { now: options.now }));
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
  app.register((routes) => registerProcessRoutes(routes, processRepository, companyRepository, routineRepository));
  app.register((routes) => registerProcessMaterialRoutes(routes, processRepository, objectStorage));
  app.register((routes) => registerRoutineRoutes(routes, routineRepository, {
    companyRepository,
    objectStorage,
    trainingRepository,
    announcementRepository
  }));
  app.register((routes) => registerTrainingRoutes(routes, trainingRepository, companyRepository));
  app.register((routes) => registerAnnouncementRoutes(routes, announcementRepository, companyRepository));
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
  app.register((routes) => registerStudioRoutes(
    routes,
    studioService,
    studioMemoryIndex,
    studioRitualService,
    studioReadiness
  ));
  app.register((routes) => registerStudioAssistantRoutes(routes, studioAssistantService, studioOperationsBridge));
  app.register((routes) => registerStudioProactivityRoutes(routes, studioProactivityService));
  app.register((routes) => registerStudioPortabilityRoutes(routes, studioPortabilityService));
  app.register((routes) => registerStudioAssetRoutes(routes, {
    repository: studioRepository,
    objectStorage,
    resolver: options.studioLinkResolver,
    fetcher: options.studioLinkFetcher,
    uploadSemaphore: options.studioUploadSemaphore,
    uploadPutTimeoutMs: options.studioUploadPutTimeoutMs,
    uploadLeaseMs: options.studioUploadLeaseMs,
    uploadLeaseHeartbeatMs: options.studioUploadLeaseHeartbeatMs,
    uploadAbortTimeoutMs: options.studioUploadAbortTimeoutMs,
    cleanupProcessor: studioAssetCleanupProcessor,
    now: options.now
  }));

  return Object.assign(app, {
    studioAssetProcessor,
    studioAssetCleanupProcessor,
    studioAssetUploadCleanupProcessor,
    studioMemoryIndex,
    studioMemoryIndexProcessor,
    studioProactivityService,
    studioPortabilityService,
    studioPortabilityReconciliationProcessor
  });
}

function hasStudioPortabilityHooks(repository: StudioRepository): repository is StudioRepository & StudioPortabilityRepositoryHooks {
  const candidate = repository as Partial<StudioPortabilityRepositoryHooks>;
  return typeof candidate.readPortabilitySnapshot === "function" && typeof candidate.deletePortabilityData === "function";
}

function hasStudioProactivityPortabilityHooks(
  store: StudioProactivityStore
): store is StudioProactivityStore & StudioPortabilityProactivityHooks {
  return typeof store.readPortabilityRows === "function" && typeof store.deleteOwnerData === "function";
}
