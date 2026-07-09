import type { FastifyInstance } from "fastify";
import { readHomeRouteForRole, type BaaseRole } from "@prymeira/baase-shared";
import { readRequestContext } from "../../http/auth-context";
import type { CompanyRepository, TeamMember } from "../company/company.types";
import type { OnboardingRepository } from "../onboarding/onboarding.types";

const profileByRole: Record<BaaseRole, { display_name: string; initials: string; area_name: string | null }> = {
  owner: {
    display_name: "Marina Alves",
    initials: "MA",
    area_name: null
  },
  manager: {
    display_name: "Rafael Nunes",
    initials: "RN",
    area_name: "Criação"
  },
  employee: {
    display_name: "Bruno Costa",
    initials: "BC",
    area_name: "Criação"
  }
};

function initialsFromName(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "BB";
}

async function readWorkspaceProfile(
  workspaceId: string,
  role: BaaseRole,
  companyRepository?: CompanyRepository
) {
  const fallback = profileByRole[role];
  if (!companyRepository) return fallback;

  const people = await companyRepository.listTeamMembers(workspaceId);
  const person = people.find((member) => member.role === role && member.status === "active")
    ?? people.find((member) => member.role === role && member.status !== "placeholder");
  if (!person) return fallback;

  const areaName = await readAreaName(workspaceId, person, companyRepository);
  return {
    display_name: person.name,
    initials: initialsFromName(person.name),
    area_name: areaName
  };
}

async function readAreaName(workspaceId: string, person: TeamMember, companyRepository: CompanyRepository) {
  if (!person.areaId) return null;

  const area = await companyRepository.findAreaById(workspaceId, person.areaId);
  return area?.name ?? null;
}

export async function registerSessionRoutes(
  app: FastifyInstance,
  onboardingRepository?: OnboardingRepository,
  companyRepository?: CompanyRepository
) {
  app.get("/me", async (request) => {
    const context = readRequestContext(request);
    const onboardingSession = onboardingRepository
      ? await onboardingRepository.getCurrentSession(context.workspaceId)
      : null;
    const profile = await readWorkspaceProfile(context.workspaceId, context.role, companyRepository);
    const workspaceName = onboardingSession?.companyName?.trim() || "Estúdio Norte";

    return {
      workspace: {
        id: context.workspaceId,
        name: workspaceName
      },
      profile: {
        id: context.profileId,
        role: context.role,
        display_name: profile.display_name,
        initials: profile.initials,
        area_name: profile.area_name
      },
      home_route: readHomeRouteForRole(context.role)
    };
  });
}
