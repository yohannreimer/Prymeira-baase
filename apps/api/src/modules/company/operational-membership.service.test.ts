import { describe, expect, it } from "vitest";
import { createInMemoryCompanyRepository } from "./in-memory-company.repository";
import { createOperationalMembershipResolver } from "./operational-membership.service";

const identity = {
  workspaceId: "workspace_a",
  clerkUserId: "user_ana",
  customerId: "customer_ana",
  productRole: "member",
  bearerToken: "token"
};

describe("operational membership resolver", () => {
  it("links the only unlinked person with the authenticated email", async () => {
    const repository = createInMemoryCompanyRepository();
    const person = await repository.createTeamMember({
      workspaceId: "workspace_a", name: "Ana", email: "ana@example.com", role: "employee",
      areaId: null, roleTemplateId: null, createdByProfileId: "person_owner"
    });
    const resolver = createOperationalMembershipResolver({
      repository,
      loadHubProfile: async () => ({ email: "ana@example.com", name: "Ana" })
    });

    const membership = await resolver.resolve(identity);

    expect(membership.personId).toBe(person.id);
    expect(membership.person).toMatchObject({ clerkUserId: "user_ana", customerId: "customer_ana", status: "active" });
  });

  it("does not choose between duplicate unlinked emails", async () => {
    const repository = createInMemoryCompanyRepository();
    for (const name of ["Ana 1", "Ana 2"]) {
      await repository.createTeamMember({
        workspaceId: "workspace_a", name, email: "ana@example.com", role: "employee",
        areaId: null, roleTemplateId: null, createdByProfileId: "person_owner"
      });
    }
    const resolver = createOperationalMembershipResolver({
      repository,
      loadHubProfile: async () => ({ email: "ana@example.com", name: "Ana" })
    });

    await expect(resolver.resolve(identity)).rejects.toThrow("BAASE_MEMBERSHIP_CONFLICT");
  });

  it("bootstraps the first workspace owner from an Account Hub owner", async () => {
    const resolver = createOperationalMembershipResolver({
      repository: createInMemoryCompanyRepository(),
      loadHubProfile: async () => ({ email: "owner@example.com", name: "Dona" })
    });

    const membership = await resolver.resolve({ ...identity, clerkUserId: "user_owner", customerId: "customer_owner", productRole: "owner" });

    expect(membership.person).toMatchObject({ role: "owner", accessScope: "workspace", email: "owner@example.com" });
  });

  it("requires an operational invitation for a non-owner without a matching person", async () => {
    const resolver = createOperationalMembershipResolver({
      repository: createInMemoryCompanyRepository(),
      loadHubProfile: async () => ({ email: "employee@example.com", name: "Pessoa sem convite" })
    });

    await expect(resolver.resolve(identity)).rejects.toThrow("BAASE_MEMBERSHIP_REQUIRED");
  });

  it("activates the operational invitation when the Hub user enters with the invited email", async () => {
    const repository = createInMemoryCompanyRepository();
    const invite = await repository.createTeamInvite({
      workspaceId: "workspace_a",
      name: "Ana",
      email: "ana@example.com",
      role: "manager",
      areaId: null,
      areaAccessIds: [],
      roleTemplateId: null,
      accessScope: "workspace",
      hubInvitationId: "hub_invite_1",
      hubStatus: "pending",
      createdByProfileId: "person_owner"
    });
    const resolver = createOperationalMembershipResolver({
      repository,
      loadHubProfile: async () => ({ email: "ana@example.com", name: "Ana Souza" })
    });

    const membership = await resolver.resolve(identity);

    expect(membership.person).toMatchObject({
      id: `person_${invite.id}`,
      name: "Ana Souza",
      role: "manager",
      clerkUserId: "user_ana",
      customerId: "customer_ana"
    });
    expect(await repository.findTeamInviteByCode(invite.code)).toMatchObject({
      status: "accepted",
      personId: membership.personId
    });
  });
});
