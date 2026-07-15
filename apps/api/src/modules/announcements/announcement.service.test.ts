import { describe, expect, it } from "vitest";
import { createInMemoryAnnouncementRepository } from "./in-memory-announcement.repository";
import { createAnnouncementService } from "./announcement.service";

describe("announcement service", () => {
  it("recovers a draft announcement by its durable creation identity", async () => {
    const repository = createInMemoryAnnouncementRepository();
    let throwAfterCreate = true;
    const service = createAnnouncementService({
      ...repository,
      async createAnnouncement(input) {
        const created = await repository.createAnnouncement(input);
        if (throwAfterCreate) {
          throwAfterCreate = false;
          throw new Error("lost response after commit");
        }
        return created;
      }
    });
    const input = {
      title: "Comunicado estratégico",
      body: "Mensagem",
      type: "simple" as const,
      requirement: "none" as const,
      audience: { type: "all" as const }
    };

    const created = await service.createAnnouncement(
      "workspace_a", "profile_owner", input, { resourceId: "announcement_studio_durable" }
    );
    const repeated = await createAnnouncementService(repository).createAnnouncement(
      "workspace_a", "profile_owner", { ...input, title: "Não sobrescrever" },
      { resourceId: "announcement_studio_durable" }
    );

    expect(created.id).toBe("announcement_studio_durable");
    expect(repeated).toEqual(created);
    await expect(repository.listAnnouncements("workspace_a")).resolves.toHaveLength(1);
  });
});
