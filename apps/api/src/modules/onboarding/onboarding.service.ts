import { ApiError } from "../../http/api-error";
import { formatProcessSopBody } from "@prymeira/baase-shared";
import { createAnnouncementService } from "../announcements/announcement.service";
import type { AnnouncementRepository } from "../announcements/announcement.types";
import { createCompanyService } from "../company/company.service";
import type { Area, CompanyRepository, RoleTemplate } from "../company/company.types";
import { createProcessService } from "../processes/process.service";
import type { ProcessRepository } from "../processes/process.types";
import { createRoutineService } from "../routines/routine.service";
import type { RoutineRepository } from "../routines/routine.types";
import { createTrainingService } from "../trainings/training.service";
import type { TrainingRepository } from "../trainings/training.types";
import type {
  OnboardingAnswer,
  OnboardingRepository,
  OnboardingReviewDecision,
  OnboardingSession,
  OnboardingSessionStatus
} from "./onboarding.types";

export type PatchOnboardingSessionInput = {
  currentStep?: string;
  companyName?: string | null;
  segment?: string | null;
  customSegment?: string | null;
  normalizedSegment?: string | null;
  teamSizeRange?: string | null;
  goals?: string[];
  mainAnswers?: OnboardingAnswer[];
};

export type CompleteSessionRepositories = {
  companyRepository: CompanyRepository;
  processRepository: ProcessRepository;
  routineRepository: RoutineRepository;
  trainingRepository: TrainingRepository;
  announcementRepository: AnnouncementRepository;
};

type CompletionCreatedRecordIds = {
  areas: string[];
  roleTemplates: string[];
  teamMembers: string[];
  processes: string[];
  routines: string[];
  trainings: string[];
  announcements: string[];
};

export function createOnboardingService(repository: OnboardingRepository) {
  async function getOrCreateSession(workspaceId: string, ownerProfileId: string, currentStep = "identity") {
    const existing = await repository.getCurrentSession(workspaceId);
    if (existing && existing.status !== "completed") return existing;

    return repository.createSession({
      workspaceId,
      ownerProfileId,
      status: "in_progress",
      currentStep,
      companyName: null,
      segment: null,
      customSegment: null,
      normalizedSegment: null,
      teamSizeRange: null,
      goals: [],
      mainAnswers: [],
      attachments: [],
      diagnosis: null,
      followupQuestions: [],
      followupAnswers: [],
      generatedSuggestion: null,
      reviewDecisions: [],
      activationPlan: [],
      createdSetupSummary: null,
      aiRunIds: []
    });
  }

  async function patchSession(workspaceId: string, ownerProfileId: string, input: PatchOnboardingSessionInput) {
    const session = await getOrCreateSession(workspaceId, ownerProfileId, input.currentStep ?? "identity");
    assertCanMutateSession(session);
    return repository.updateSession({
      ...session,
      currentStep: input.currentStep ?? session.currentStep,
      companyName: input.companyName !== undefined ? input.companyName : session.companyName,
      segment: input.segment !== undefined ? input.segment : session.segment,
      customSegment: input.customSegment !== undefined ? input.customSegment : session.customSegment,
      normalizedSegment: input.normalizedSegment !== undefined ? input.normalizedSegment : session.normalizedSegment,
      teamSizeRange: input.teamSizeRange !== undefined ? input.teamSizeRange : session.teamSizeRange,
      goals: input.goals ?? session.goals,
      mainAnswers: input.mainAnswers ?? session.mainAnswers
    });
  }

  async function setStatus(
    workspaceId: string,
    ownerProfileId: string,
    status: OnboardingSessionStatus,
    currentStep: string
  ) {
    const session = await getOrCreateSession(workspaceId, ownerProfileId, currentStep);
    assertCanMutateSession(session);
    return repository.updateSession({
      ...session,
      status,
      currentStep,
      completedAt: status === "completed" ? new Date().toISOString() : session.completedAt
    });
  }

  function serialize(session: OnboardingSession) {
    return { ...session };
  }

  async function completeSession(
    workspaceId: string,
    actorProfileId: string,
    repositories: CompleteSessionRepositories
  ) {
    const currentSession = await repository.getCurrentSession(workspaceId);
    if (!currentSession) throw new ApiError(404, "ONBOARDING_SESSION_NOT_FOUND", "Onboarding não iniciado.");
    const claimedSession = await repository.claimCompletion(workspaceId, currentSession.id);
    if (!claimedSession) {
      const latestSession = await repository.findSession(workspaceId, currentSession.id);
      if (latestSession?.status === "completing") {
        throw new ApiError(409, "ONBOARDING_COMPLETION_IN_PROGRESS", "A conclusão deste onboarding já está em andamento.");
      }
      if (latestSession?.status === "completion_failed") {
        throw new ApiError(
          409,
          "ONBOARDING_COMPLETION_FAILED",
          "A conclusão anterior falhou. Revise o onboarding antes de tentar novamente."
        );
      }
      throw new ApiError(409, "ONBOARDING_REVIEW_REQUIRED", "Gere a sugestão antes de concluir o onboarding.");
    }

    const createdIds: CompletionCreatedRecordIds = {
      areas: [],
      roleTemplates: [],
      teamMembers: [],
      processes: [],
      routines: [],
      trainings: [],
      announcements: []
    };

    try {
      validateCompletionReferences(claimedSession);
      const session = claimedSession;
      const suggestion = session.generatedSuggestion;
      if (!suggestion) {
        throw new ApiError(409, "ONBOARDING_REVIEW_REQUIRED", "Gere a sugestão antes de concluir o onboarding.");
      }
      const companyService = createCompanyService(repositories.companyRepository);
      const processService = createProcessService(repositories.processRepository);
      const routineService = createRoutineService(repositories.routineRepository);
      const trainingService = createTrainingService(repositories.trainingRepository);
      const announcementService = createAnnouncementService(repositories.announcementRepository);
      const areaBySuggestionId = new Map<string, Area>();
      const areaByName = new Map<string, Area>();
      const roleBySuggestionId = new Map<string, RoleTemplate>();
      const roleByName = new Map<string, RoleTemplate>();
      let people = 0;
      let placeholders = 0;
      let processes = 0;
      let routines = 0;
      let trainings = 0;
      let announcements = 0;

      for (const areaSuggestion of suggestion.areas) {
        const decision = findDecision(session, "area", areaSuggestion.id);
        if (decision?.action === "remove") continue;
        const edited = decision?.editedPayload;
        const name = normalizeName(readEditedString(edited, "name") ?? areaSuggestion.name);
        const description = readEditedNullableOverride(edited, "description", areaSuggestion.description);
        const area = await companyService.createArea(workspaceId, { name, description });
        createdIds.areas.push(area.id);
        areaBySuggestionId.set(areaSuggestion.id, area);
        areaByName.set(name, area);
      }

      for (const roleSuggestion of suggestion.roles) {
        const decision = findDecision(session, "role", roleSuggestion.id);
        if (decision?.action === "remove") continue;
        const edited = decision?.editedPayload;
        const areaName = normalizeName(readEditedString(edited, "areaName") ?? roleSuggestion.areaName);
        const area = areaByName.get(areaName);
        if (!area) continue;
        const name = normalizeName(readEditedString(edited, "name") ?? roleSuggestion.name);
        const description = readEditedNullableOverride(edited, "description", roleSuggestion.description);
        const roleTemplate = await companyService.createRoleTemplate(workspaceId, {
          areaId: area.id,
          name,
          description
        });
        createdIds.roleTemplates.push(roleTemplate.id);
        roleBySuggestionId.set(roleSuggestion.id, roleTemplate);
        roleByName.set(name, roleTemplate);
        roleByName.set(`${areaName}:${name}`, roleTemplate);
      }

      for (const personSuggestion of suggestion.people) {
        const decision = findDecision(session, "person", personSuggestion.id);
        if (decision?.action === "remove") continue;
        const edited = decision?.editedPayload;
        const areaName = normalizeNullableName(readEditedNullableString(edited, "areaName", personSuggestion.areaName));
        const roleName = normalizeNullableName(readEditedNullableString(edited, "roleName", personSuggestion.roleName));
        const area = areaName ? areaByName.get(areaName) ?? null : null;
        const roleTemplate = roleName ? readRole(roleByName, areaName, roleName) : null;
        const isPlaceholder = readEditedBoolean(edited, "placeholder") ?? personSuggestion.placeholder;

        const member = await companyService.createTeamMember(workspaceId, {
          name: readEditedString(edited, "name") ?? personSuggestion.name,
          email: readEditedNullableString(edited, "email", personSuggestion.email),
          role: readEditedRole(edited) ?? personSuggestion.role,
          areaId: area?.id ?? null,
          roleTemplateId: roleTemplate?.id ?? null,
          status: isPlaceholder ? "placeholder" : "active",
          createdByProfileId: actorProfileId
        });
        createdIds.teamMembers.push(member.id);
        people += 1;
        if (isPlaceholder) placeholders += 1;
      }

      for (const processSuggestion of suggestion.processes) {
        const decision = findDecision(session, "process", processSuggestion.id);
        if (decision?.action === "remove") continue;
        const edited = decision?.editedPayload;
        const areaName = normalizeNullableName(readEditedNullableString(edited, "areaName", processSuggestion.areaName));
        const area = areaName ? areaByName.get(areaName) ?? null : null;
        const draft = await processService.createProcess(workspaceId, actorProfileId, {
          title: readEditedString(edited, "title") ?? processSuggestion.title,
          summary: readEditedString(edited, "summary") ?? processSuggestion.summary,
          body: readEditedString(edited, "body") ?? processSuggestion.body ?? formatProcessSopBody({
            objective: processSuggestion.objective ?? processSuggestion.summary,
            trigger: processSuggestion.trigger ?? "Sempre que este processo for iniciado.",
            operationalRule: processSuggestion.operationalRule ?? null,
            steps: processSuggestion.steps?.length ? processSuggestion.steps : [{
              title: "Executar o processo",
              instruction: "Siga o roteiro operacional definido e registre pendências no Baase.",
              expectedResult: "A equipe consegue entender o andamento sem depender de conversa solta.",
              attentionPoints: []
            }]
          }),
          areaId: area?.id ?? null
        });
        createdIds.processes.push(draft.id);
        if (decision?.action === "publish") await processService.publishProcess(workspaceId, draft.id);
        processes += 1;
      }

      for (const routineSuggestion of suggestion.routines) {
        const decision = findDecision(session, "routine", routineSuggestion.id);
        if (decision?.action === "remove") continue;
        const edited = decision?.editedPayload;
        const areaName = normalizeNullableName(readEditedNullableString(edited, "areaName", routineSuggestion.areaName));
        const area = areaName ? areaByName.get(areaName) ?? null : null;
        const taskTitles = readEditedStringArray(edited, "taskTitles") ?? routineSuggestion.taskTitles;
        const routine = await routineService.createRoutine(workspaceId, actorProfileId, {
          title: readEditedString(edited, "title") ?? routineSuggestion.title,
          areaId: area?.id ?? null,
          taskTemplates: taskTitles.map((title) => ({
            title,
            approvalMode: "direct",
            evidencePolicy: "optional"
          }))
        });
        createdIds.routines.push(routine.id);
        if (decision?.action !== "activate") await routineService.archiveRoutine(workspaceId, routine.id);
        routines += 1;
      }

      for (const trainingSuggestion of suggestion.trainings) {
        const decision = findDecision(session, "training", trainingSuggestion.id);
        if (decision?.action === "remove") continue;
        const edited = decision?.editedPayload;
        const title = readEditedString(edited, "title") ?? trainingSuggestion.title;
        const draft = await trainingService.createTraining(workspaceId, actorProfileId, {
          title,
          description: readEditedString(edited, "description") ?? trainingSuggestion.description,
          materials: [{
            kind: "lesson",
            title: `Aula inicial - ${title}`,
            body: readEditedString(edited, "materialBody") ?? trainingSuggestion.materialBody
          }],
          quizQuestions: [{
            prompt: readEditedString(edited, "quizPrompt") ?? trainingSuggestion.quizPrompt,
            options: [
              { id: "a", label: "Seguir o processo publicado e registrar a execução." },
              { id: "b", label: "Executar de memória e avisar apenas se houver erro." }
            ],
            correctOptionId: "a",
            explanation: "O Baase transforma conhecimento em rotina rastreável."
          }]
        });
        createdIds.trainings.push(draft.id);
        if (decision?.action === "publish") await trainingService.publishTraining(workspaceId, draft.id);
        trainings += 1;
      }

      if (suggestion.announcement) {
        const decision = findDecision(session, "announcement", suggestion.announcement.id);
        if (decision?.action !== "remove") {
          const edited = decision?.editedPayload;
          const announcement = await announcementService.createAnnouncement(workspaceId, actorProfileId, {
            title: readEditedString(edited, "title") ?? suggestion.announcement.title,
            body: readEditedString(edited, "body") ?? suggestion.announcement.body,
            type: "simple",
            requirement: "none",
            audience: { type: "all" }
          });
          createdIds.announcements.push(announcement.id);
          if (decision?.action === "publish") await announcementService.publishAnnouncement(workspaceId, announcement.id);
          announcements = 1;
        }
      }

      return await repository.updateSession({
        ...session,
        status: "completed",
        currentStep: "completed",
        createdSetupSummary: {
          areas: areaBySuggestionId.size,
          roles: roleBySuggestionId.size,
          people,
          placeholders,
          processes,
          routines,
          trainings,
          announcements,
          invites: 0
        },
        completedAt: new Date().toISOString()
      });
    } catch (error) {
      const rollbackSucceeded = await rollbackCompletionRecords(workspaceId, repositories, createdIds);
      await markCompletionAfterFailure(claimedSession, rollbackSucceeded);
      throw error;
    }
  }

  async function markCompletionAfterFailure(session: OnboardingSession, rollbackSucceeded: boolean) {
    try {
      await repository.updateSession({
        ...session,
        status: rollbackSucceeded ? "reviewing" : "completion_failed",
        currentStep: rollbackSucceeded ? "review_map" : "completion_failed"
      });
    } catch {
      if (!rollbackSucceeded) return;
      try {
        await repository.updateSession({
          ...session,
          status: "completion_failed",
          currentStep: "completion_failed"
        });
      } catch {
        // Preserve the original completion error for the caller.
      }
    }
  }

  return {
    getOrCreateSession,
    patchSession,
    setStatus,
    completeSession,
    serialize
  };
}

function validateCompletionReferences(session: OnboardingSession) {
  const suggestion = session.generatedSuggestion;
  if (!suggestion) return;

  const areaNames = new Set<string>();
  for (const areaSuggestion of suggestion.areas) {
    const decision = findDecision(session, "area", areaSuggestion.id);
    if (decision?.action === "remove") continue;
    const name = normalizeName(readEditedString(decision?.editedPayload, "name") ?? areaSuggestion.name);
    if (!name) throwInvalidReference();
    if (areaNames.has(name)) throwInvalidReference();
    areaNames.add(name);
  }

  const roleNamesByArea = new Set<string>();
  const roleNameCounts = new Map<string, number>();
  for (const roleSuggestion of suggestion.roles) {
    const decision = findDecision(session, "role", roleSuggestion.id);
    if (decision?.action === "remove") continue;
    const areaName = normalizeName(readEditedString(decision?.editedPayload, "areaName") ?? roleSuggestion.areaName);
    if (!areaNames.has(areaName)) throwInvalidReference();

    const name = normalizeName(readEditedString(decision?.editedPayload, "name") ?? roleSuggestion.name);
    if (!name) throwInvalidReference();
    const areaRoleKey = `${areaName}:${name}`;
    if (roleNamesByArea.has(areaRoleKey)) throwInvalidReference();
    roleNamesByArea.add(areaRoleKey);
    roleNameCounts.set(name, (roleNameCounts.get(name) ?? 0) + 1);
  }

  for (const personSuggestion of suggestion.people) {
    const decision = findDecision(session, "person", personSuggestion.id);
    if (decision?.action === "remove") continue;
    const areaName = normalizeNullableName(readEditedNullableString(decision?.editedPayload, "areaName", personSuggestion.areaName));
    const roleName = normalizeNullableName(readEditedNullableString(decision?.editedPayload, "roleName", personSuggestion.roleName));
    if (areaName && !areaNames.has(areaName)) throwInvalidReference();
    if (roleName && !hasUniqueRoleReference(roleNamesByArea, roleNameCounts, areaName, roleName)) {
      throwInvalidReference();
    }
  }

  for (const processSuggestion of suggestion.processes) {
    const decision = findDecision(session, "process", processSuggestion.id);
    if (decision?.action === "remove") continue;
    const areaName = normalizeNullableName(readEditedNullableString(decision?.editedPayload, "areaName", processSuggestion.areaName));
    if (areaName && !areaNames.has(areaName)) throwInvalidReference();
  }

  for (const routineSuggestion of suggestion.routines) {
    const decision = findDecision(session, "routine", routineSuggestion.id);
    if (decision?.action === "remove") continue;
    const areaName = normalizeNullableName(readEditedNullableString(decision?.editedPayload, "areaName", routineSuggestion.areaName));
    if (areaName && !areaNames.has(areaName)) throwInvalidReference();
  }
}

async function rollbackCompletionRecords(
  workspaceId: string,
  repositories: CompleteSessionRepositories,
  createdIds: CompletionCreatedRecordIds
) {
  let succeeded = true;
  const attempt = async (operation: () => Promise<void>) => {
    try {
      await operation();
    } catch {
      succeeded = false;
    }
  };

  for (const id of [...createdIds.announcements].reverse()) {
    await attempt(() => repositories.announcementRepository.deleteAnnouncement(workspaceId, id));
  }
  for (const id of [...createdIds.trainings].reverse()) {
    await attempt(() => repositories.trainingRepository.deleteTraining(workspaceId, id));
  }
  for (const id of [...createdIds.routines].reverse()) {
    await attempt(() => repositories.routineRepository.deleteRoutine(workspaceId, id));
  }
  for (const id of [...createdIds.processes].reverse()) {
    await attempt(() => repositories.processRepository.deleteProcess(workspaceId, id));
  }
  for (const id of [...createdIds.teamMembers].reverse()) {
    await attempt(() => repositories.companyRepository.deleteTeamMember(workspaceId, id));
  }
  for (const id of [...createdIds.roleTemplates].reverse()) {
    await attempt(() => repositories.companyRepository.deleteRoleTemplate(workspaceId, id));
  }
  for (const id of [...createdIds.areas].reverse()) {
    await attempt(() => repositories.companyRepository.deleteArea(workspaceId, id));
  }

  return succeeded;
}

function assertCanMutateSession(session: OnboardingSession) {
  if (session.status === "completing") {
    throw new ApiError(409, "ONBOARDING_COMPLETION_IN_PROGRESS", "A conclusão deste onboarding já está em andamento.");
  }
  if (session.status === "completion_failed") {
    throw new ApiError(
      409,
      "ONBOARDING_COMPLETION_FAILED",
      "A conclusão anterior falhou. Revise o onboarding antes de continuar."
    );
  }
}

function normalizeName(value: string) {
  return value.trim();
}

function normalizeNullableName(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function throwInvalidReference(): never {
  throw new ApiError(
    400,
    "ONBOARDING_REVIEW_REFERENCE_INVALID",
    "Revise as referências de área ou cargo antes de concluir o onboarding."
  );
}

export function findDecision(
  session: OnboardingSession,
  itemType: OnboardingReviewDecision["itemType"],
  itemId: string
) {
  return session.reviewDecisions.find((decision) => decision.itemType === itemType && decision.itemId === itemId) ?? null;
}

function readEditedString(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readEditedNullableString(
  payload: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string | null
) {
  if (!payload || !(key in payload)) return fallback;
  const value = payload[key];
  if (value === null) return null;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readEditedNullableOverride(
  payload: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string | null
) {
  if (!payload || !(key in payload)) return fallback;
  const value = payload[key];
  if (value === null) return null;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readEditedBoolean(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key];
  return typeof value === "boolean" ? value : null;
}

function readEditedRole(payload: Record<string, unknown> | null | undefined) {
  const value = payload?.role;
  return value === "owner" || value === "manager" || value === "employee" ? value : null;
}

function readEditedStringArray(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key];
  if (!Array.isArray(value)) return null;
  const strings = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return strings.length > 0 ? strings : null;
}

function hasUniqueRoleReference(
  roleNamesByArea: Set<string>,
  roleNameCounts: Map<string, number>,
  areaName: string | null,
  roleName: string
) {
  if (areaName) return roleNamesByArea.has(`${areaName}:${roleName}`);
  return roleNameCounts.get(roleName) === 1;
}

function readRole(roleByName: Map<string, RoleTemplate>, areaName: string | null, roleName: string) {
  return (areaName ? roleByName.get(`${areaName}:${roleName}`) : null) ?? roleByName.get(roleName) ?? null;
}
