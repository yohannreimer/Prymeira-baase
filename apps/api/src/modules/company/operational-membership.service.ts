import type { CompanyRepository, ExternalAccountIdentity, OperationalMembership, TeamMember } from "./company.types";

export type HubAccountProfile = {
  email: string;
  name: string | null;
};

export type OperationalMembershipResolverOptions = {
  repository: CompanyRepository;
  loadHubProfile(identity: ExternalAccountIdentity): Promise<HubAccountProfile>;
};

export function createOperationalMembershipResolver(options: OperationalMembershipResolverOptions) {
  return {
    async resolve(identity: ExternalAccountIdentity): Promise<OperationalMembership> {
      const byClerk = await options.repository.findTeamMemberByClerkUserId(identity.workspaceId, identity.clerkUserId);
      const byCustomer = await options.repository.findTeamMemberByCustomerId(identity.workspaceId, identity.customerId);
      if (byClerk && byCustomer && byClerk.id !== byCustomer.id) throw new Error("BAASE_MEMBERSHIP_CONFLICT");
      if (byClerk ?? byCustomer) return membershipFromPerson(byClerk ?? byCustomer!);

      const profile = await options.loadHubProfile(identity);
      const candidates = await options.repository.findUnlinkedTeamMembersByEmail(identity.workspaceId, profile.email);
      if (candidates.length > 1) throw new Error("BAASE_MEMBERSHIP_CONFLICT");
      if (candidates.length === 1) {
        const person = await activatePerson(options.repository, candidates[0]!, identity);
        return membershipFromPerson(person);
      }

      const pendingInvites = (await options.repository.listTeamInvites(identity.workspaceId)).filter((invite) => {
        return invite.status === "pending" && invite.email?.trim().toLowerCase() === profile.email;
      });
      if (pendingInvites.length > 1) throw new Error("BAASE_MEMBERSHIP_CONFLICT");
      if (pendingInvites.length === 1) {
        const person = await acceptOperationalInvite(options.repository, pendingInvites[0]!, profile, identity);
        return membershipFromPerson(person);
      }

      if ((identity.productRole === "admin" || identity.productRole === "owner")
        && !await options.repository.hasLinkedOwner(identity.workspaceId)) {
        const person = await options.repository.createTeamMember({
          workspaceId: identity.workspaceId,
          name: profile.name?.trim() || profile.email,
          email: profile.email,
          role: "owner",
          areaId: null,
          areaAccessIds: [],
          roleTemplateId: null,
          accessScope: "workspace",
          clerkUserId: identity.clerkUserId,
          customerId: identity.customerId,
          status: "active",
          createdByProfileId: identity.clerkUserId
        });
        return membershipFromPerson(person);
      }

      throw new Error("BAASE_MEMBERSHIP_REQUIRED");
    }
  };
}

async function activatePerson(repository: CompanyRepository, person: TeamMember, identity: ExternalAccountIdentity) {
  return repository.updateTeamMember({
    ...person,
    clerkUserId: identity.clerkUserId,
    customerId: identity.customerId,
    status: "active"
  });
}

async function acceptOperationalInvite(
  repository: CompanyRepository,
  invite: Awaited<ReturnType<CompanyRepository["listTeamInvites"]>>[number],
  profile: HubAccountProfile,
  identity: ExternalAccountIdentity
) {
  const member = {
    workspaceId: invite.workspaceId,
    name: profile.name?.trim() || invite.name,
    email: profile.email,
    role: invite.role,
    areaId: invite.areaId,
    areaAccessIds: invite.areaAccessIds ?? [],
    roleTemplateId: invite.roleTemplateId,
    accessScope: invite.accessScope,
    clerkUserId: identity.clerkUserId,
    customerId: identity.customerId,
    status: "active" as const,
    createdByProfileId: identity.clerkUserId
  };
  if (repository.acceptTeamInviteAtomically) {
    return (await repository.acceptTeamInviteAtomically(invite, member)).person;
  }

  const person = await repository.createTeamMember(member);
  await repository.updateTeamInvite({
    ...invite,
    status: "accepted",
    personId: person.id,
    acceptedAt: person.createdAt
  }, { updatedAt: invite.updatedAt, status: "pending" });
  return person;
}

function membershipFromPerson(person: TeamMember): OperationalMembership {
  return {
    person,
    personId: person.id,
    role: person.role,
    accessScope: person.accessScope,
    areaAccessIds: person.areaAccessIds
  };
}
