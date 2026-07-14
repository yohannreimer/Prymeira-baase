import type { AiTextStreamEvent } from "./ai.types";
import {
  validateSafePublicHttpUrl,
  type StudioLinkResolver
} from "../studio/studio-link-fetcher";

const CITATION_TITLE_MAX_CHARACTERS = 240;
const CITATION_URL_MAX_CHARACTERS = 2_048;
const CITATION_DATE_MAX_CHARACTERS = 64;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/u;

export async function validateAiCitation(
  event: Extract<AiTextStreamEvent, { type: "citation" }>,
  allowExternalResearch: boolean,
  resolver?: StudioLinkResolver
): Promise<Extract<AiTextStreamEvent, { type: "citation" }>> {
  if (!allowExternalResearch) throw new Error("AI_STREAM_UNAUTHORIZED_CITATION");

  const title = event.title.trim();
  if (!title || unicodeLength(title) > CITATION_TITLE_MAX_CHARACTERS) {
    throw new Error("AI_STREAM_CITATION_INVALID");
  }
  if (!event.url || unicodeLength(event.url) > CITATION_URL_MAX_CHARACTERS) {
    throw new Error("AI_STREAM_CITATION_INVALID");
  }

  let url: URL;
  try {
    url = await validateSafePublicHttpUrl(event.url, resolver);
  } catch {
    throw new Error("AI_STREAM_CITATION_INVALID");
  }

  const publishedAt = normalizePublishedAt(event.publishedAt);
  return { type: "citation", title, url: url.toString(), publishedAt };
}

function normalizePublishedAt(value: string | null) {
  if (value === null) return null;
  const normalized = value.trim();
  if (!normalized || unicodeLength(normalized) > CITATION_DATE_MAX_CHARACTERS
    || !ISO_DATE_PATTERN.test(normalized) || !Number.isFinite(Date.parse(normalized))) {
    throw new Error("AI_STREAM_CITATION_INVALID");
  }
  return normalized;
}

function unicodeLength(value: string) {
  return Array.from(value).length;
}
