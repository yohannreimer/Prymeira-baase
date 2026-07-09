import type { BaaseRole } from "@prymeira/baase-shared";

export type AnnouncementStatus = "draft" | "published" | "archived";
export type AnnouncementType = "simple" | "process_change" | "mandatory_training";
export type AnnouncementRequirement = "none" | "read_confirmation" | "quiz_confirmation";

export type AnnouncementAudience =
  | { type: "all" }
  | { type: "area"; areaId: string }
  | { type: "role"; roleTemplateId: string }
  | { type: "person"; profileId: string };

export type AnnouncementQuizOption = {
  id: string;
  label: string;
};

export type AnnouncementQuizQuestion = {
  id: string;
  announcementId: string;
  workspaceId: string;
  prompt: string;
  options: AnnouncementQuizOption[];
  correctOptionId: string;
  explanation: string | null;
  sortOrder: number;
};

export type Announcement = {
  id: string;
  workspaceId: string;
  title: string;
  body: string;
  type: AnnouncementType;
  status: AnnouncementStatus;
  requirement: AnnouncementRequirement;
  audience: AnnouncementAudience;
  relatedProcessId: string | null;
  relatedTrainingId: string | null;
  quizQuestions: AnnouncementQuizQuestion[];
  createdByProfileId: string;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AnnouncementReceiptStatus = "pending" | "confirmed" | "quiz_completed";

export type AnnouncementReceipt = {
  id: string;
  workspaceId: string;
  announcementId: string;
  profileId: string;
  status: AnnouncementReceiptStatus;
  quizScore: number | null;
  passed: boolean | null;
  answers: AnnouncementQuizAnswerInput[];
  readAt: string | null;
  confirmedAt: string | null;
  quizCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AnnouncementWithReceipt = Announcement & {
  receipt: AnnouncementReceipt;
};

export type AnnouncementQuizAnswerInput = {
  questionId: string;
  optionId: string;
};

export type CreateAnnouncementInput = {
  title: string;
  body: string;
  type: AnnouncementType;
  requirement: AnnouncementRequirement;
  audience: AnnouncementAudience;
  relatedProcessId?: string | null;
  relatedTrainingId?: string | null;
  quizQuestions?: Array<{
    prompt: string;
    options: AnnouncementQuizOption[];
    correctOptionId: string;
    explanation?: string | null;
  }>;
};

export type AnnouncementListContext = {
  profileId: string;
  role: BaaseRole;
  areaId?: string | null;
  roleTemplateId?: string | null;
};

export type AnnouncementRepository = {
  listAnnouncements(workspaceId: string): Promise<Announcement[]>;
  findAnnouncement(workspaceId: string, announcementId: string): Promise<Announcement | null>;
  createAnnouncement(input: Omit<Announcement, "id" | "createdAt" | "updatedAt">): Promise<Announcement>;
  updateAnnouncement(announcement: Announcement): Promise<Announcement>;
  deleteAnnouncement(workspaceId: string, announcementId: string): Promise<void>;
  listAnnouncementReceipts(workspaceId: string, filters?: { announcementId?: string; profileId?: string }): Promise<AnnouncementReceipt[]>;
  upsertAnnouncementReceipt(
    input: Omit<AnnouncementReceipt, "id" | "createdAt" | "updatedAt"> & { id?: string }
  ): Promise<AnnouncementReceipt>;
};
