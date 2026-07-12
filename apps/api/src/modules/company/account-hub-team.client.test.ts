import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../http/api-error";
import { createAccountHubTeamClient } from "./account-hub-team.client";

describe("Account Hub team client", () => {
  it("invites a Base member through the Account Hub", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      status: "pending",
      invitation: { id: "hub_invite_1" }
    }), { status: 200 }));
    const client = createAccountHubTeamClient({ accountApiUrl: "https://hub.test/api/", fetcher });

    const result = await client.inviteBaseMember({
      bearerToken: "clerk-token",
      email: "ana@example.com",
      name: "Ana"
    });

    expect(fetcher).toHaveBeenCalledWith("https://hub.test/api/team/members/invite", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer clerk-token" }),
      body: JSON.stringify({ email: "ana@example.com", name: "Ana", role: "member", product_key: "base" })
    }));
    expect(result).toEqual({ status: "pending", invitationId: "hub_invite_1" });
  });

  it("does not expose Account Hub failures as a local invite", async () => {
    const client = createAccountHubTeamClient({
      accountApiUrl: "https://hub.test/api",
      fetcher: async () => new Response("unavailable", { status: 503 })
    });

    await expect(client.inviteBaseMember({ bearerToken: "clerk-token", email: "ana@example.com", name: "Ana" }))
      .rejects.toMatchObject({ code: "ACCOUNT_HUB_INVITE_FAILED", statusCode: 502 } satisfies Partial<ApiError>);
  });
});
