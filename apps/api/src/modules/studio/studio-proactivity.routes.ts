import { canAccessOwnerStudio } from "@prymeira/baase-shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ApiError, forbiddenError } from "../../http/api-error";
import { readRequestContext } from "../../http/auth-context";
import type { createStudioProactivityService } from "./studio-proactivity.service";
import type { StudioOwnerScope } from "./studio.types";

export type StudioProactivityService = ReturnType<typeof createStudioProactivityService>;

const emptySchema = z.object({}).strict();
const settingsSchema = z.object({
  ritual_reminder: z.boolean().optional(),
  stale_goal: z.boolean().optional(),
  recurring_theme: z.boolean().optional(),
  decision_review: z.boolean().optional(),
  operational_change: z.boolean().optional(),
  focused_content: z.boolean().optional(),
  stale_goal_after_days: z.number().int().min(1).max(3_650).optional()
}).strict();
const signalListSchema = z.object({ limit: z.coerce.number().int().min(1).max(10).default(1) }).strict();
const signalParamsSchema = z.object({ signalId: z.string().trim().min(1).max(200) }).strict();
const snoozeSchema = z.object({ until: z.string().datetime({ offset: true }) }).strict();

export async function registerStudioProactivityRoutes(
  app: FastifyInstance,
  service: StudioProactivityService
) {
  app.get("/studio/proactivity/settings", async (request) => {
    const scope = requireStudioScope(request);
    emptySchema.parse(request.params);
    emptySchema.parse(request.query);
    if (request.body !== undefined) emptySchema.parse(request.body);
    return { settings: await run(() => service.readSettings(scope)) };
  });

  app.patch("/studio/proactivity/settings", async (request) => {
    const scope = requireStudioScope(request);
    emptySchema.parse(request.params);
    emptySchema.parse(request.query);
    const input = settingsSchema.parse(request.body);
    return { settings: await run(() => service.updateSettings(scope, {
      ritualReminder: input.ritual_reminder,
      staleGoal: input.stale_goal,
      recurringTheme: input.recurring_theme,
      decisionReview: input.decision_review,
      operationalChange: input.operational_change,
      focusedContent: input.focused_content,
      staleGoalAfterDays: input.stale_goal_after_days
    })) };
  });

  app.get("/studio/proactivity/signals", async (request) => {
    const scope = requireStudioScope(request);
    emptySchema.parse(request.params);
    const query = signalListSchema.parse(request.query);
    if (request.body !== undefined) emptySchema.parse(request.body);
    return { signals: await run(() => service.listSignals(scope, query.limit)) };
  });

  app.post("/studio/proactivity/signals/:signalId/snooze", async (request) => {
    const scope = requireStudioScope(request);
    const params = signalParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    const body = snoozeSchema.parse(request.body);
    return { signal: await run(() => service.snoozeSignal(scope, params.signalId, body.until)) };
  });

  app.post("/studio/proactivity/signals/:signalId/dismiss", async (request) => {
    const scope = requireStudioScope(request);
    const params = signalParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    if (request.body !== undefined) emptySchema.parse(request.body);
    return { signal: await run(() => service.dismissSignal(scope, params.signalId)) };
  });
}

function requireStudioScope(request: FastifyRequest): StudioOwnerScope {
  const context = readRequestContext(request);
  if (!canAccessOwnerStudio(context.role)) throw forbiddenError();
  return { workspaceId: context.workspaceId, ownerProfileId: context.profileId };
}

async function run<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error && error.message === "STUDIO_PROACTIVE_SIGNAL_NOT_FOUND") {
      throw new ApiError(404, error.message, "Este sinal não está mais disponível.");
    }
    if (error instanceof Error && [
      "STUDIO_PROACTIVITY_STALE_GOAL_DAYS_INVALID",
      "STUDIO_PROACTIVE_SIGNAL_SNOOZE_INVALID",
      "STUDIO_PROACTIVITY_LIMIT_INVALID"
    ].includes(error.message)) {
      throw new ApiError(400, error.message, "Dados inválidos para esta configuração do Estúdio.");
    }
    throw error;
  }
}
