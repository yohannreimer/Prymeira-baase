import type { ProcessRepository } from "../processes/process.types";
import type { RoutineRepository } from "../routines/routine.types";
import type {
  ArchiveAreaInput,
  ArchiveAreaResult,
  AreaAffectedCounts,
  AreaImpact,
  AreaLifecycleRepository,
  CompanyRepository
} from "./company.types";

export function createAreaLifecycleService(repository: AreaLifecycleRepository) {
  return {
    async getImpact(workspaceId: string, areaId: string) {
      const impact = await repository.getImpact(workspaceId, areaId);
      if (!impact) throw new Error("AREA_NOT_FOUND");
      return impact;
    },

    archive(
      workspaceId: string,
      areaId: string,
      actorProfileId: string,
      resolution?: ArchiveAreaInput
    ) {
      return repository.archive({ workspaceId, areaId, actorProfileId, resolution });
    }
  };
}

export function createInMemoryAreaLifecycleRepository(input: {
  companyRepository: CompanyRepository;
  processRepository: ProcessRepository;
  routineRepository: RoutineRepository;
}): AreaLifecycleRepository {
  let serialized = Promise.resolve();

  const runSerialized = <T>(run: () => Promise<T>) => {
    const operation = serialized.then(run, run);
    serialized = operation.then(() => undefined, () => undefined);
    return operation;
  };

  return {
    async getImpact(workspaceId, areaId) {
      const state = readState(input);
      return buildImpact(state, workspaceId, areaId);
    },

    archive(command) {
      return runSerialized(async () => {
        const state = readState(input);
        const impact = buildImpact(state, command.workspaceId, command.areaId);
        if (!impact) throw new Error("AREA_NOT_FOUND");
        if (command.resolution?.strategy === "reassign") {
          const targetAreaId = command.resolution.targetAreaId;
          if (targetAreaId === command.areaId) throw new Error("AREA_ARCHIVE_TARGET_SAME");
          const target = state.company.areas.find((area) =>
            area.workspaceId === command.workspaceId && area.id === targetAreaId && !area.archivedAt
          );
          if (!target) throw new Error("AREA_ARCHIVE_TARGET_NOT_FOUND");
        }
        if (!command.resolution && hasLinks(impact)) throw new Error("AREA_ARCHIVE_RESOLUTION_REQUIRED");

        const result = mutateState(state, impact, command.resolution);
        input.companyRepository.commitLifecycleState!(state.company);
        input.processRepository.commitLifecycleState!(state.processes);
        input.routineRepository.commitLifecycleState!(state.routines);
        return result;
      });
    }
  };
}

type LifecycleState = {
  company: ReturnType<NonNullable<CompanyRepository["getLifecycleState"]>>;
  processes: ReturnType<NonNullable<ProcessRepository["getLifecycleState"]>>;
  routines: ReturnType<NonNullable<RoutineRepository["getLifecycleState"]>>;
};

function readState(input: {
  companyRepository: CompanyRepository;
  processRepository: ProcessRepository;
  routineRepository: RoutineRepository;
}): LifecycleState {
  if (!input.companyRepository.getLifecycleState || !input.companyRepository.commitLifecycleState
    || !input.processRepository.getLifecycleState || !input.processRepository.commitLifecycleState
    || !input.routineRepository.getLifecycleState || !input.routineRepository.commitLifecycleState) {
    throw new Error("AREA_LIFECYCLE_REPOSITORY_NOT_CONFIGURED");
  }
  return {
    company: input.companyRepository.getLifecycleState(),
    processes: input.processRepository.getLifecycleState(),
    routines: input.routineRepository.getLifecycleState()
  };
}

function buildImpact(state: LifecycleState, workspaceId: string, areaId: string): AreaImpact | null {
  const area = state.company.areas.find((item) => item.workspaceId === workspaceId && item.id === areaId && !item.archivedAt);
  if (!area) return null;
  const roles = state.company.roleTemplates.filter((role) => role.workspaceId === workspaceId && role.areaId === areaId && !role.archivedAt);
  const roleIds = new Set(roles.map((role) => role.id));
  return {
    area,
    processes: state.processes
      .filter((process) => process.workspaceId === workspaceId && process.status !== "archived" && process.areaId === areaId)
      .map(({ id, title }) => ({ id, title })),
    routines: state.routines.routines
      .filter((routine) => routine.workspaceId === workspaceId && routine.status === "active" && routine.areaId === areaId)
      .map(({ id, title }) => ({ id, title })),
    roleTemplates: roles.map(({ id, name }) => ({ id, name })),
    people: state.company.teamMembers
      .filter((person) => person.workspaceId === workspaceId
        && (person.areaId === areaId || Boolean(person.roleTemplateId && roleIds.has(person.roleTemplateId))))
      .map(({ id, name }) => ({ id, name })),
    pendingInvites: state.company.invites
      .filter((invite) => invite.workspaceId === workspaceId && invite.status === "pending"
        && (invite.areaId === areaId || Boolean(invite.roleTemplateId && roleIds.has(invite.roleTemplateId))))
      .map(({ id, name, email }) => ({ id, name, email }))
  };
}

function hasLinks(impact: AreaImpact) {
  return impact.processes.length + impact.routines.length + impact.roleTemplates.length
    + impact.people.length + impact.pendingInvites.length > 0;
}

function emptyCounts(): AreaAffectedCounts {
  return { processes: 0, routines: 0, roleTemplates: 0, people: 0, pendingInvites: 0 };
}

function mutateState(state: LifecycleState, impact: AreaImpact, resolution?: ArchiveAreaInput): ArchiveAreaResult {
  const reassigned = emptyCounts();
  const unassigned = { processes: 0, routines: 0, people: 0, pendingInvites: 0 };
  const roleIds = new Set(impact.roleTemplates.map((role) => role.id));
  const targetAreaId = resolution?.strategy === "reassign" ? resolution.targetAreaId : null;

  for (const process of state.processes) {
    if (process.workspaceId !== impact.area.workspaceId || process.status === "archived" || process.areaId !== impact.area.id) continue;
    process.areaId = targetAreaId;
    resolution?.strategy === "reassign" ? reassigned.processes++ : unassigned.processes++;
  }
  for (const routine of state.routines.routines) {
    if (routine.workspaceId !== impact.area.workspaceId || routine.status !== "active" || routine.areaId !== impact.area.id) continue;
    routine.areaId = targetAreaId;
    resolution?.strategy === "reassign" ? reassigned.routines++ : unassigned.routines++;
  }
  for (const role of state.company.roleTemplates) {
    if (role.workspaceId !== impact.area.workspaceId || role.areaId !== impact.area.id) continue;
    if (resolution?.strategy === "reassign") {
      role.areaId = resolution.targetAreaId;
      reassigned.roleTemplates++;
    }
  }
  for (const person of state.company.teamMembers) {
    if (person.workspaceId !== impact.area.workspaceId) continue;
    const linked = person.areaId === impact.area.id || Boolean(person.roleTemplateId && roleIds.has(person.roleTemplateId));
    if (!linked) continue;
    if (person.areaId === impact.area.id) person.areaId = targetAreaId;
    if (resolution?.strategy !== "reassign" && person.roleTemplateId && roleIds.has(person.roleTemplateId)) person.roleTemplateId = null;
    resolution?.strategy === "reassign" ? reassigned.people++ : unassigned.people++;
  }
  for (const invite of state.company.invites) {
    if (invite.workspaceId !== impact.area.workspaceId || invite.status !== "pending") continue;
    const linked = invite.areaId === impact.area.id || Boolean(invite.roleTemplateId && roleIds.has(invite.roleTemplateId));
    if (!linked) continue;
    if (invite.areaId === impact.area.id) invite.areaId = targetAreaId;
    if (resolution?.strategy !== "reassign") {
      if (invite.roleTemplateId && roleIds.has(invite.roleTemplateId)) invite.roleTemplateId = null;
      if (invite.accessScope !== "workspace") invite.accessScope = "workspace";
    }
    resolution?.strategy === "reassign" ? reassigned.pendingInvites++ : unassigned.pendingInvites++;
  }

  const archivedAt = new Date().toISOString();
  if (resolution?.strategy !== "reassign") {
    state.company.roleTemplates = state.company.roleTemplates.map((role) =>
      roleIds.has(role.id) ? { ...role, archivedAt, updatedAt: archivedAt } : role
    );
  }
  state.company.areas = state.company.areas.map((area) =>
    area.workspaceId === impact.area.workspaceId && area.id === impact.area.id
      ? { ...area, archivedAt, updatedAt: archivedAt }
      : area
  );
  return {
    area: impact.area,
    reassigned,
    unassigned,
    archived: { areas: 1, roleTemplates: resolution?.strategy === "reassign" ? 0 : impact.roleTemplates.length }
  };
}
