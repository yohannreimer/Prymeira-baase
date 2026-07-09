import type { Announcement, AnnouncementReceipt, AnnouncementRepository } from "./announcement.types";

type InMemoryAnnouncementRepositoryOptions = {
  now?: () => string;
  initialAnnouncements?: Announcement[];
  initialReceipts?: AnnouncementReceipt[];
};

export function createInMemoryAnnouncementRepository(
  options: InMemoryAnnouncementRepositoryOptions = {}
): AnnouncementRepository {
  const announcements: Announcement[] = [...(options.initialAnnouncements ?? [])];
  const receipts: AnnouncementReceipt[] = [...(options.initialReceipts ?? [])];
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async listAnnouncements(workspaceId) {
      return announcements.filter((announcement) => announcement.workspaceId === workspaceId);
    },

    async findAnnouncement(workspaceId, announcementId) {
      return announcements.find((announcement) => announcement.workspaceId === workspaceId && announcement.id === announcementId) ?? null;
    },

    async createAnnouncement(input) {
      const timestamp = now();
      const announcementId = `announcement_${announcements.length + 1}`;
      const announcement: Announcement = {
        ...input,
        id: announcementId,
        quizQuestions: input.quizQuestions.map((question) => ({
          ...question,
          id: question.id.replace("__announcement__", announcementId),
          announcementId
        })),
        createdAt: timestamp,
        updatedAt: timestamp
      };
      announcements.push(announcement);
      return announcement;
    },

    async updateAnnouncement(announcement) {
      const index = announcements.findIndex((item) => item.workspaceId === announcement.workspaceId && item.id === announcement.id);
      if (index === -1) throw new Error("ANNOUNCEMENT_NOT_FOUND");
      const updated = {
        ...announcement,
        updatedAt: now()
      };
      announcements[index] = updated;
      return updated;
    },

    async deleteAnnouncement(workspaceId, announcementId) {
      const index = announcements.findIndex((item) => item.workspaceId === workspaceId && item.id === announcementId);
      if (index >= 0) announcements.splice(index, 1);
      for (let receiptIndex = receipts.length - 1; receiptIndex >= 0; receiptIndex -= 1) {
        const receipt = receipts[receiptIndex];
        if (receipt?.workspaceId === workspaceId && receipt.announcementId === announcementId) receipts.splice(receiptIndex, 1);
      }
    },

    async listAnnouncementReceipts(workspaceId, filters = {}) {
      return receipts.filter((receipt) => {
        if (receipt.workspaceId !== workspaceId) return false;
        if (filters.announcementId && receipt.announcementId !== filters.announcementId) return false;
        if (filters.profileId && receipt.profileId !== filters.profileId) return false;
        return true;
      });
    },

    async upsertAnnouncementReceipt(input) {
      const timestamp = now();
      const existingIndex = input.id
        ? receipts.findIndex((receipt) => receipt.workspaceId === input.workspaceId && receipt.id === input.id)
        : receipts.findIndex((receipt) => {
          return receipt.workspaceId === input.workspaceId
            && receipt.announcementId === input.announcementId
            && receipt.profileId === input.profileId;
        });
      const receipt: AnnouncementReceipt = {
        ...input,
        id: existingIndex >= 0 ? receipts[existingIndex]!.id : `announcement_receipt_${receipts.length + 1}`,
        createdAt: existingIndex >= 0 ? receipts[existingIndex]!.createdAt : timestamp,
        updatedAt: timestamp
      };

      if (existingIndex >= 0) receipts[existingIndex] = receipt;
      else receipts.push(receipt);

      return receipt;
    }
  };
}
