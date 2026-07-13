import type { CompanyRepository, OperationalMembership, RoleTemplate, TeamMember } from "../company/company.types";
import { canManageAreaResource, canReadAreaResource } from "../company/access-policy";
import type { AnnouncementAudience } from "./announcement.types";

export type ResolvedAnnouncementAudience = {
  audience: AnnouncementAudience;
  areaId: string | null;
};

export async function resolveAnnouncementAudience(
  companyRepository: CompanyRepository,
  workspaceId: string,
  audience: AnnouncementAudience
): Promise<ResolvedAnnouncementAudience> {
  if (audience.type === "all") return { audience, areaId: null };
  if (audience.type === "area") {
    const area = await companyRepository.findAreaById(workspaceId, audience.areaId);
    if (!area) throw new Error("ANNOUNCEMENT_AUDIENCE_AREA_NOT_FOUND");
    return { audience, areaId: area.id };
  }

  const roleTemplates = await companyRepository.listRoleTemplates(workspaceId);
  if (audience.type === "role") {
    const role = roleTemplates.find((item) => item.id === audience.roleTemplateId);
    if (!role) throw new Error("ANNOUNCEMENT_AUDIENCE_ROLE_NOT_FOUND");
    return { audience, areaId: role.areaId };
  }

  const person = await companyRepository.findTeamMember(workspaceId, audience.profileId);
  if (!person) throw new Error("ANNOUNCEMENT_AUDIENCE_PERSON_NOT_FOUND");
  return { audience, areaId: effectivePersonArea(person, roleTemplates) };
}

export async function canReadAnnouncementAudience(
  companyRepository: CompanyRepository,
  workspaceId: string,
  member: OperationalMembership,
  audience: AnnouncementAudience
) {
  if (audience.type === "all") return true;
  if (audience.type === "person") return audience.profileId === member.personId;
  if (audience.type === "role") return audience.roleTemplateId === member.person.roleTemplateId;

  const resolved = await resolveAnnouncementAudience(companyRepository, workspaceId, audience);
  if (!canReadAreaResource(member, resolved.areaId)) return false;
  return true;
}

export async function canManageAnnouncementAudience(
  companyRepository: CompanyRepository,
  workspaceId: string,
  member: OperationalMembership,
  audience: AnnouncementAudience
) {
  const resolved = audience.type === "all"
    ? null
    : await resolveAnnouncementAudience(companyRepository, workspaceId, audience);
  if (member.role === "owner") return true;
  if (member.role !== "manager") return false;
  if (member.accessScope === "workspace") return true;
  if (audience.type === "all") return false;
  return resolved!.areaId !== null && canManageAreaResource(member, resolved!.areaId);
}

function effectivePersonArea(person: TeamMember, roleTemplates: RoleTemplate[]) {
  if (person.areaId) return person.areaId;
  return roleTemplates.find((role) => role.id === person.roleTemplateId)?.areaId ?? null;
}
