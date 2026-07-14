import { ApiError, forbiddenError } from "../../http/api-error";
import type { AnnouncementAudience, AnnouncementRepository } from "../announcements/announcement.types";
import type { CompanyRepository, OperationalMembership, TeamMember } from "../company/company.types";
import { createDashboardService } from "../dashboard/dashboard.service";
import type { OperationalOverview } from "../dashboard/dashboard.types";
import type { ProcessRepository } from "../processes/process.types";
import type { RoutineRepository } from "../routines/routine.types";
import type { TrainingAudience, TrainingRepository } from "../trainings/training.types";
import type {
  StudioCitationInput,
  StudioContextFact,
  StudioContextRequest,
  StudioContextSnapshot,
  StudioOperationalResourceType,
  StudioOwnerScope
} from "./studio.types";

export type StudioContextRepositories = {
  companyRepository: CompanyRepository;
  processRepository: ProcessRepository;
  routineRepository: RoutineRepository;
  trainingRepository: TrainingRepository;
  announcementRepository: AnnouncementRepository;
};

export type StudioContextBuilderOptions = {
  now?: () => Date;
  maxSerializedBytes?: number;
  maxPersonIds?: number;
  maxPeriodDays?: number;
  perTypeCaps?: Partial<Record<StudioOperationalResourceType, number>>;
};

export type StudioContextBuilder = {
  buildStudioContext(scope: StudioOwnerScope, request: StudioContextRequest): Promise<StudioContextSnapshot>;
};

const RESOURCE_ORDER: StudioOperationalResourceType[] = [
  "dashboard", "task", "routine", "process", "training", "announcement", "people"
];
const RESOURCE_SET = new Set<string>(RESOURCE_ORDER);
const DEFAULT_CAPS: Record<StudioOperationalResourceType, number> = {
  dashboard: 12,
  task: 16,
  routine: 10,
  process: 10,
  training: 10,
  announcement: 10,
  people: 16
};

export function createStudioContextBuilder(
  repositories: StudioContextRepositories,
  options: StudioContextBuilderOptions = {}
): StudioContextBuilder {
  const now = options.now ?? (() => new Date());
  const maxSerializedBytes = boundedInteger(options.maxSerializedBytes, 48_000, 1_024, 256_000);
  const maxPersonIds = boundedInteger(options.maxPersonIds, 10, 1, 50);
  const maxPeriodDays = boundedInteger(options.maxPeriodDays, 366, 1, 3_660);
  const caps = normalizeCaps(options.perTypeCaps);
  const dashboard = createDashboardService(repositories, { now });

  return {
    async buildStudioContext(scope, request) {
      const observedAt = normalizeNow(now());
      const period = resolvePeriod(request, observedAt, maxPeriodDays);
      const resourceTypes = normalizeResourceTypes(request.resourceTypes);
      const people = await authorizeScopeAndPeople(repositories.companyRepository, scope, request.personIds, maxPersonIds);
      const membership = ownerMembership(people.owner);
      const selectedPeople = people.selected;
      const personIds = selectedPeople.map((person) => person.id).sort();
      const needsOverview = resourceTypes.has("dashboard") || resourceTypes.has("task") || resourceTypes.has("announcement");
      const overviews = needsOverview
        ? await readOverviews(dashboard, scope, membership, period, personIds)
        : [];
      const result: StudioContextSnapshot = {
        period,
        facts: [],
        citations: [],
        serializedBytes: 0,
        truncated: false
      };
      const add = createBoundedAppender(result, {
        scope, period, observedAt, personIds, caps, maxSerializedBytes
      });

      for (const resourceType of RESOURCE_ORDER) {
        if (!resourceTypes.has(resourceType)) continue;
        if (resourceType === "dashboard") appendDashboardFacts(add, overviews, personIds, period);
        if (resourceType === "task") appendTaskFacts(add, overviews);
        if (resourceType === "routine") {
          const [routines, tasks] = await Promise.all([
            repositories.routineRepository.listRoutines(scope.workspaceId),
            personIds.length ? repositories.routineRepository.listTaskOccurrences(scope.workspaceId) : Promise.resolve([])
          ]);
          const relevantRoutineIds = new Set(tasks
            .filter((task) => personIds.includes(task.assigneeProfileId ?? "") && task.dueDate >= period.from && task.dueDate <= period.to)
            .flatMap((task) => task.routineId ? [task.routineId] : []));
          routines
            .filter((routine) => !personIds.length
              || routine.assigneeProfileIds?.some((id) => personIds.includes(id))
              || relevantRoutineIds.has(routine.id))
            .sort(byUpdatedAtThenId)
            .forEach((routine) => add(resourceType, {
              key: `routine.${routine.id}`,
              kind: "direct",
              sourceId: routine.id,
              label: routine.title,
              excerpt: `Rotina ${routine.status}: ${routine.title}`,
              value: {
                id: routine.id, title: routine.title, status: routine.status, areaId: routine.areaId,
                frequency: routine.frequency ?? null, dueHint: routine.dueHint ?? null,
                assigneeProfileIds: [...(routine.assigneeProfileIds ?? [])].sort(), updatedAt: routine.updatedAt
              }
            }));
        }
        if (resourceType === "process") {
          const [processes, tasks] = await Promise.all([
            repositories.processRepository.listProcesses(scope.workspaceId),
            personIds.length ? repositories.routineRepository.listTaskOccurrences(scope.workspaceId) : Promise.resolve([])
          ]);
          const referencedProcessIds = new Set(tasks
            .filter((task) => personIds.includes(task.assigneeProfileId ?? "") && task.dueDate >= period.from && task.dueDate <= period.to)
            .flatMap((task) => task.processId ? [task.processId] : []));
          processes
            .filter((process) => !personIds.length
              || process.ownerProfileId && personIds.includes(process.ownerProfileId)
              || process.owner?.type === "person" && personIds.includes(process.owner.personId)
              || referencedProcessIds.has(process.id))
            .sort(byUpdatedAtThenId)
            .forEach((process) => add(resourceType, {
              key: `process.${process.id}`,
              kind: "direct",
              sourceId: process.id,
              label: process.title,
              excerpt: `Processo ${process.status}: ${process.title}`,
              value: {
                id: process.id, title: process.title, summary: safeText(process.summary, 240), status: process.status,
                areaId: process.areaId, owner: process.owner ?? (process.ownerProfileId
                  ? { type: "person", personId: process.ownerProfileId } : null), publishedAt: process.publishedAt,
                updatedAt: process.updatedAt
              }
            }));
        }
        if (resourceType === "training") {
          const trainings = await repositories.trainingRepository.listTrainings(scope.workspaceId);
          trainings
            .filter((training) => !personIds.length || selectedPeople.some((person) => audienceMatches(training.audience, person)))
            .sort(byUpdatedAtThenId)
            .forEach((training) => add(resourceType, {
              key: `training.${training.id}`,
              kind: "direct",
              sourceId: training.id,
              label: training.title,
              excerpt: `Treinamento ${training.status}: ${training.title}`,
              value: {
                id: training.id, title: training.title, description: safeText(training.description, 240),
                status: training.status, audience: training.audience, dueDate: training.dueDate,
                publishedAt: training.publishedAt, updatedAt: training.updatedAt
              }
            }));
        }
        if (resourceType === "announcement") {
          const announcements = await repositories.announcementRepository.listAnnouncements(scope.workspaceId);
          const pendingIds = new Set(overviews.flatMap((overview) =>
            overview.pendingRequiredAnnouncements.map((item) => `${item.id}:${item.profileId ?? ""}`)));
          announcements
            .filter((announcement) => !personIds.length || selectedPeople.some((person) => audienceMatches(announcement.audience, person)))
            .sort(byUpdatedAtThenId)
            .forEach((announcement) => add(resourceType, {
              key: `announcement.${announcement.id}`,
              kind: "direct",
              sourceId: announcement.id,
              label: announcement.title,
              excerpt: `Comunicado ${announcement.status}: ${announcement.title}`,
              value: {
                id: announcement.id, title: announcement.title, type: announcement.type, status: announcement.status,
                requirement: announcement.requirement, audience: announcement.audience, publishedAt: announcement.publishedAt,
                updatedAt: announcement.updatedAt,
                pendingConfirmationCount: [...pendingIds].filter((key) => key.startsWith(`${announcement.id}:`)).length,
                pendingForPersonIds: personIds.filter((id) => pendingIds.has(`${announcement.id}:${id}`))
              }
            }));
        }
        if (resourceType === "people") {
          const visiblePeople = personIds.length ? selectedPeople : people.workspacePeople;
          visiblePeople
            .filter((person) => person.status !== "archived")
            .sort((left, right) => left.name.localeCompare(right.name, "pt-BR") || left.id.localeCompare(right.id))
            .forEach((person) => add(resourceType, {
              key: `people.${person.id}`,
              kind: "direct",
              sourceId: person.id,
              label: person.name,
              excerpt: `Pessoa ${person.name} (${person.role})`,
              value: {
                id: person.id, name: person.name, role: person.role, areaId: person.areaId,
                roleTemplateId: person.roleTemplateId, status: person.status, updatedAt: person.updatedAt
              }
            }));
        }
      }
      result.serializedBytes = serializedBytes(result);
      return result;
    }
  };
}

type AppendInput = {
  key: string;
  kind: StudioContextFact["kind"];
  sourceId: string;
  label: string;
  excerpt: string;
  value: unknown;
};

function createBoundedAppender(
  result: StudioContextSnapshot,
  context: {
    scope: StudioOwnerScope;
    period: { from: string; to: string };
    observedAt: string;
    personIds: string[];
    caps: Record<StudioOperationalResourceType, number>;
    maxSerializedBytes: number;
  }
) {
  const counts = new Map<StudioOperationalResourceType, number>();
  return (resourceType: StudioOperationalResourceType, input: AppendInput) => {
    const count = counts.get(resourceType) ?? 0;
    if (count >= context.caps[resourceType] || result.citations.length >= 30) {
      result.truncated = true;
      return;
    }
    const citationIndex = result.citations.length;
    const fact: StudioContextFact = {
      key: safeText(input.key, 180) || "fact",
      value: input.value,
      citationIndex,
      kind: input.kind,
      resourceType
    };
    const citation: StudioCitationInput = {
      ...context.scope,
      sourceType: resourceType === "dashboard" ? "operational_metric" : "operational_resource",
      sourceId: safeText(input.sourceId, 160) || "resource",
      url: null,
      label: safeText(input.label, 160) || "Fonte operacional",
      excerpt: safeText(input.excerpt, 800) || "",
      observedAt: context.observedAt,
      periodFrom: context.period.from,
      periodTo: context.period.to,
      metadata: { resourceType, personIds: [...context.personIds], contentTrust: "untrusted_data" }
    };
    const next = {
      period: context.period,
      facts: [...result.facts, fact],
      citations: [...result.citations, citation]
    };
    if (Buffer.byteLength(JSON.stringify(next), "utf8") > context.maxSerializedBytes) {
      result.truncated = true;
      return;
    }
    result.facts.push(fact);
    result.citations.push(citation);
    counts.set(resourceType, count + 1);
  };
}

function appendDashboardFacts(
  add: ReturnType<typeof createBoundedAppender>,
  overviews: OperationalOverview[],
  personIds: string[],
  period: { from: string; to: string }
) {
  overviews.forEach((overview, index) => {
    const personId = personIds[index] ?? null;
    const suffix = personId ? `.${personId}` : "";
    add("dashboard", {
      key: `dashboard.metrics${suffix}`,
      kind: "direct",
      sourceId: `dashboard:${period.from}:${period.to}${personId ? `:${personId}` : ""}`,
      label: personId ? `Indicadores operacionais de ${personId}` : "Indicadores operacionais",
      excerpt: `Indicadores operacionais de ${period.from} a ${period.to}`,
      value: { ...overview.metrics, personId }
    });
    if (overview.trends.people.length || overview.trends.areas.length) {
      add("dashboard", {
        key: `dashboard.trends${suffix}`,
        kind: "inferred",
        sourceId: `dashboard-trends:${period.from}:${period.to}${personId ? `:${personId}` : ""}`,
        label: personId ? `Tendências calculadas de ${personId}` : "Tendências calculadas",
        excerpt: `Inferências calculadas pelo painel para ${period.from} a ${period.to}`,
        value: { people: overview.trends.people, areas: overview.trends.areas, personId }
      });
    }
  });
}

function appendTaskFacts(add: ReturnType<typeof createBoundedAppender>, overviews: OperationalOverview[]) {
  const items = new Map<string, OperationalOverview["openTasks"][number]>();
  for (const overview of overviews) {
    for (const task of [...overview.openTasks, ...overview.lateTasks, ...overview.awaitingApprovals]) items.set(task.id, task);
  }
  [...items.values()]
    .sort((left, right) => (left.dueDate ?? "").localeCompare(right.dueDate ?? "") || left.id.localeCompare(right.id))
    .forEach((task) => add("task", {
      key: `task.${task.id}`,
      kind: "direct",
      sourceId: task.id,
      label: task.title,
      excerpt: `Tarefa ${task.status ?? "aberta"}: ${task.title}`,
      value: {
        id: task.id, title: task.title, status: task.status ?? null, dueDate: task.dueDate ?? null,
        assigneeProfileId: task.assigneeProfileId ?? task.profileId, areaId: task.areaId, daysLate: task.daysLate ?? null,
        submittedAt: task.submittedAt ?? null, reviewedAt: task.reviewedAt ?? null
      }
    }));
}

async function readOverviews(
  dashboard: ReturnType<typeof createDashboardService>,
  scope: StudioOwnerScope,
  membership: OperationalMembership,
  period: { from: string; to: string },
  personIds: string[]
) {
  if (!personIds.length) {
    return [await dashboard.readOperationalOverview({ workspaceId: scope.workspaceId, membership, ...period })];
  }
  return Promise.all(personIds.map((profileId) => dashboard.readPersonOperationalOverview({
    workspaceId: scope.workspaceId, membership, profileId, ...period
  })));
}

async function authorizeScopeAndPeople(
  repository: CompanyRepository,
  scope: StudioOwnerScope,
  requestedPersonIds: string[],
  maxPersonIds: number
) {
  if (!Array.isArray(requestedPersonIds) || requestedPersonIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw invalid("STUDIO_CONTEXT_PEOPLE_INVALID", "A seleção de pessoas é inválida.");
  }
  const personIds = [...new Set(requestedPersonIds.map((id) => id.trim()))];
  if (personIds.length > maxPersonIds) throw invalid("STUDIO_CONTEXT_PEOPLE_LIMIT", "Selecione menos pessoas para esta consulta.");
  const workspacePeople = await repository.listTeamMembers(scope.workspaceId);
  const owner = workspacePeople.find((person) => person.id === scope.ownerProfileId);
  if (!owner || owner.role !== "owner" || owner.status === "archived" || owner.status === "inactive") throw forbiddenError();
  const peopleById = new Map(workspacePeople.map((person) => [person.id, person]));
  const selected = personIds.map((id) => peopleById.get(id));
  if (selected.some((person) => !person || person.status === "archived")) {
    throw new ApiError(404, "STUDIO_CONTEXT_PERSON_NOT_FOUND", "Uma das pessoas selecionadas não foi encontrada.");
  }
  return { owner, selected: selected as TeamMember[], workspacePeople };
}

function ownerMembership(owner: TeamMember): OperationalMembership {
  return { person: owner, personId: owner.id, role: "owner", accessScope: "workspace", areaAccessIds: [] };
}

function normalizeResourceTypes(values: StudioContextRequest["resourceTypes"]) {
  if (!Array.isArray(values) || values.length > RESOURCE_ORDER.length
    || values.some((value) => typeof value !== "string" || !RESOURCE_SET.has(value))) {
    throw invalid("STUDIO_CONTEXT_RESOURCE_TYPES_INVALID", "As fontes operacionais solicitadas são inválidas.");
  }
  return new Set(values);
}

function resolvePeriod(request: Pick<StudioContextRequest, "from" | "to">, observedAt: string, maxPeriodDays: number) {
  if (request.from === null && request.to === null) {
    const to = operationalDate(new Date(observedAt));
    return { from: addDays(to, -29), to };
  }
  if (!isIsoDate(request.from) || !isIsoDate(request.to) || request.from > request.to) {
    throw invalid("STUDIO_CONTEXT_PERIOD_INVALID", "Informe um período operacional válido.");
  }
  const days = daysInclusive(request.from, request.to);
  if (days > maxPeriodDays) throw invalid("STUDIO_CONTEXT_PERIOD_LIMIT", "O período solicitado é muito extenso.");
  return { from: request.from, to: request.to };
}

function normalizeNow(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error("STUDIO_CONTEXT_CLOCK_INVALID");
  return value.toISOString();
}

function operationalDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function daysInclusive(from: string, to: string) {
  return Math.floor((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000) + 1;
}

function audienceMatches(audience: AnnouncementAudience | TrainingAudience | null, person: TeamMember) {
  if (!audience || audience.type === "all") return true;
  if (audience.type === "person") return audience.profileId === person.id;
  if (audience.type === "area") return audience.areaId === person.areaId;
  return audience.roleTemplateId === person.roleTemplateId;
}

function byUpdatedAtThenId(left: { updatedAt: string; id: string }, right: { updatedAt: string; id: string }) {
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
}

function safeText(value: string | null | undefined, max: number) {
  if (value === null || value === undefined) return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.slice(0, max);
}

function normalizeCaps(input: StudioContextBuilderOptions["perTypeCaps"]) {
  return Object.fromEntries(RESOURCE_ORDER.map((type) => [
    type,
    boundedInteger(input?.[type], DEFAULT_CAPS[type], 0, 30)
  ])) as Record<StudioOperationalResourceType, number>;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error("STUDIO_CONTEXT_LIMIT_INVALID");
  return value;
}

function serializedBytes(result: Pick<StudioContextSnapshot, "period" | "facts" | "citations">) {
  return Buffer.byteLength(JSON.stringify({ period: result.period, facts: result.facts, citations: result.citations }), "utf8");
}

function invalid(code: string, message: string) {
  return new ApiError(400, code, message);
}
