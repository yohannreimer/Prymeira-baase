import type { AiTextStreamEvent } from "./ai.types";
import {
  validateSafePublicHttpUrl,
  type StudioLinkResolver
} from "../studio/studio-link-fetcher";

const CITATION_TITLE_MAX_CHARACTERS = 240;
const CITATION_URL_MAX_CHARACTERS = 2_048;
const CITATION_DATE_MAX_CHARACTERS = 64;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2})))?$/u;

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
  const parts = ISO_DATE_PATTERN.exec(normalized);
  if (!normalized || unicodeLength(normalized) > CITATION_DATE_MAX_CHARACTERS
    || !parts || !isValidIsoCalendarParts(parts) || !Number.isFinite(Date.parse(normalized))) {
    throw new Error("AI_STREAM_CITATION_INVALID");
  }
  return normalized;
}

function isValidIsoCalendarParts(parts: RegExpExecArray) {
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return false;
  if (parts[4] === undefined) return true;

  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (parts[7] === "Z") return true;

  const offsetHour = Number(parts[9]);
  const offsetMinute = Number(parts[10]);
  return offsetHour <= 14 && offsetMinute <= 59 && (offsetHour < 14 || offsetMinute === 0);
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return new Set([4, 6, 9, 11]).has(month) ? 30 : 31;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function unicodeLength(value: string) {
  return Array.from(value).length;
}
