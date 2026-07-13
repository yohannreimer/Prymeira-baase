import type { FastifyInstance } from "fastify";
import { readHomeRouteForRole, type BaaseRole } from "@prymeira/baase-shared";
import { readRequestContext, requireOperationalMembership, type RequestContext } from "../../http/auth-context";
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
  context: RequestContext,
  companyRepository?: CompanyRepository
) {
  const fallback = context.accountAuthenticated
    ? accountProfileFallback(context.profileName)
    : profileByRole[context.role];
  if (!companyRepository) return fallback;

  const person = context.operationalMembership?.person ?? (await companyRepository.findTeamMember(context.workspaceId, context.profileId));
  if (!person) return fallback;

  const areaName = await readAreaName(context.workspaceId, person, companyRepository);
  return {
    display_name: person.name,
    initials: initialsFromName(person.name),
    area_name: areaName
  };
}

function accountProfileFallback(profileName: string | undefined) {
  const displayName = profileName || "Usuário";
  return {
    display_name: displayName,
    initials: initialsFromName(displayName),
    area_name: null
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
    const membership = requireOperationalMembership(request);
    const onboardingSession = onboardingRepository
      ? await onboardingRepository.getCurrentSession(context.workspaceId)
      : null;
    const profile = await readWorkspaceProfile(context, companyRepository);
    const workspaceName = onboardingSession?.companyName?.trim()
      || (context.accountAuthenticated ? context.workspaceName || "Empresa em configuração" : "Estúdio Norte");

    return {
      workspace: {
        id: context.workspaceId,
        name: workspaceName
      },
      profile: {
        id: membership.personId,
        role: membership.role,
        display_name: profile.display_name,
        initials: profile.initials,
        area_name: profile.area_name,
        area_names: await Promise.all(membership.areaAccessIds.map(async (areaId) => (await companyRepository?.findAreaById(context.workspaceId, areaId))?.name ?? areaId)),
        access_scope: membership.accessScope
      },
      home_route: readHomeRouteForRole(membership.role)
    };
  });
}
