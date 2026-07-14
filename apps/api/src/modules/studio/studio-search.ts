import type {
  StudioOwnerScope,
  StudioRepository,
  StudioSearchDocument,
  StudioSearchResult
} from "./studio.types";

export const STUDIO_SEARCH_MIN_PREFIX_LENGTH = 3;
export const STUDIO_SEARCH_MAX_PREFIX_LENGTH = 24;
export const STUDIO_SEARCH_MAX_PREFIX_TOKENS = 32_768;

const MAX_SEARCH_RESULTS = 50;
const MAX_EXCERPT_LENGTH = 240;

export type StudioSearchFields = {
  titleFolded: string;
  bodyFolded: string;
  tokens: string[];
  prefixTokens: string[];
};

export type PreparedStudioSearchQuery = {
  query: string;
  tokens: string[];
  exactTokens: string[];
  prefixToken: string | null;
};

type FoldedText = {
  value: string;
  originalOffsets: number[];
};

export function foldStudioSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Mark}+/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/gu, " ")
    .trim();
}

function lexicalTokens(value: string) {
  return value.split(/[^\p{Letter}\p{Number}]+/u).filter(Boolean);
}

export function studioSearchTokens(value: string) {
  return [...new Set(lexicalTokens(foldStudioSearchText(value)))].sort();
}

export function studioSearchPrefixTokens(tokens: string[]) {
  const prefixes = new Set<string>();
  for (const token of [...tokens].sort()) {
    const characters = [...token];
    const maximumLength = Math.min(characters.length, STUDIO_SEARCH_MAX_PREFIX_LENGTH);
    for (let length = STUDIO_SEARCH_MIN_PREFIX_LENGTH; length <= maximumLength; length += 1) {
      prefixes.add(characters.slice(0, length).join(""));
      if (prefixes.size >= STUDIO_SEARCH_MAX_PREFIX_TOKENS) return [...prefixes].sort();
    }
  }
  return [...prefixes].sort();
}

export function prepareStudioSearchFields(
  title: string | null,
  bodyText: string
): StudioSearchFields {
  const titleFolded = foldStudioSearchText(title ?? "");
  const bodyFolded = foldStudioSearchText(bodyText);
  const tokens = studioSearchTokens(`${titleFolded} ${bodyFolded}`);
  return {
    titleFolded,
    bodyFolded,
    tokens,
    prefixTokens: studioSearchPrefixTokens(tokens)
  };
}

export function prepareStudioSearchQuery(rawQuery: string): PreparedStudioSearchQuery | null {
  const query = foldStudioSearchText(rawQuery);
  const tokens = lexicalTokens(query);
  if (!query || tokens.length === 0) return null;
  const finalToken = tokens[tokens.length - 1]!;
  const finalTokenLength = [...finalToken].length;
  const supportsPrefix = finalTokenLength >= STUDIO_SEARCH_MIN_PREFIX_LENGTH
    && finalTokenLength <= STUDIO_SEARCH_MAX_PREFIX_LENGTH;
  return {
    query,
    tokens,
    exactTokens: supportsPrefix ? tokens.slice(0, -1) : tokens,
    prefixToken: supportsPrefix ? finalToken : null
  };
}

export function matchesStudioSearchCandidate(
  fields: StudioSearchFields,
  query: PreparedStudioSearchQuery
) {
  const documentTokens = new Set(fields.tokens);
  if (!query.exactTokens.every((token) => documentTokens.has(token))) return false;
  return query.prefixToken === null
    || documentTokens.has(query.prefixToken)
    || fields.prefixTokens.includes(query.prefixToken);
}

export function scoreStudioSearchFields(
  fields: StudioSearchFields,
  query: PreparedStudioSearchQuery
) {
  let score = 0;
  if (fields.titleFolded === query.query) score += 400;
  else if (fields.titleFolded.startsWith(query.query)) score += 300;
  else if (fields.titleFolded.includes(query.query)) score += 200;
  if (fields.bodyFolded.includes(query.query)) score += 100;
  for (const token of query.tokens) {
    if (fields.titleFolded.includes(token)) score += 20;
    if (fields.bodyFolded.includes(token)) score += 5;
  }
  return score;
}

export function studioSearchScore(document: StudioSearchDocument, rawQuery: string) {
  const query = prepareStudioSearchQuery(rawQuery);
  if (!query) return null;
  const fields = prepareStudioSearchFields(document.title, document.bodyText);
  return matchesStudioSearchCandidate(fields, query)
    ? scoreStudioSearchFields(fields, query)
    : null;
}

function segmentOffsets(segment: string, segmentStart: number, transformedLength: number) {
  const offsets: number[] = [];
  for (let index = 0; index < segment.length;) {
    const character = String.fromCodePoint(segment.codePointAt(index)!);
    const transformed = character
      .normalize("NFD")
      .replace(/\p{Mark}+/gu, "")
      .toLocaleLowerCase("pt-BR");
    for (let outputIndex = 0; outputIndex < transformed.length; outputIndex += 1) {
      offsets.push(segmentStart + index);
    }
    index += character.length;
  }
  if (offsets.length === transformedLength) return offsets;
  return Array.from({ length: transformedLength }, (_, index) => (
    segmentStart + Math.floor((index / Math.max(1, transformedLength)) * segment.length)
  ));
}

function foldWithOriginalOffsets(value: string): FoldedText {
  let folded = "";
  const originalOffsets: number[] = [];
  const segments = value.matchAll(/[\p{Letter}\p{Mark}\p{Number}]+|\s+|[^\p{Letter}\p{Mark}\p{Number}\s]+/gu);

  for (const match of segments) {
    const segment = match[0];
    const segmentStart = match.index;
    if (/^\s+$/u.test(segment)) {
      if (folded && !folded.endsWith(" ")) {
        folded += " ";
        originalOffsets.push(segmentStart);
      }
      continue;
    }
    const transformed = segment
      .normalize("NFD")
      .replace(/\p{Mark}+/gu, "")
      .toLocaleLowerCase("pt-BR");
    folded += transformed;
    originalOffsets.push(...segmentOffsets(segment, segmentStart, transformed.length));
  }

  if (folded.endsWith(" ")) {
    folded = folded.slice(0, -1);
    originalOffsets.pop();
  }
  const wholeFolded = foldStudioSearchText(value);
  if (folded === wholeFolded) return { value: folded, originalOffsets };
  return {
    value: wholeFolded,
    originalOffsets: Array.from({ length: wholeFolded.length }, (_, index) => (
      Math.floor((index / Math.max(1, wholeFolded.length)) * value.length)
    ))
  };
}

function excerpt(bodyText: string, query: PreparedStudioSearchQuery) {
  if (bodyText.length <= MAX_EXCERPT_LENGTH) return bodyText;
  const foldedBody = foldWithOriginalOffsets(bodyText);
  const foldedMatchIndex = foldedBody.value.indexOf(query.query) >= 0
    ? foldedBody.value.indexOf(query.query)
    : query.tokens.reduce((found, token) => (
      found >= 0 ? found : foldedBody.value.indexOf(token)
    ), -1);
  const originalMatchIndex = foldedMatchIndex >= 0
    ? foldedBody.originalOffsets[foldedMatchIndex] ?? 0
    : 0;
  const start = Math.max(0, originalMatchIndex - 80);
  const hasPrefix = start > 0;
  const available = MAX_EXCERPT_LENGTH - (hasPrefix ? 1 : 0) - 1;
  const content = bodyText.slice(start, start + available).trim();
  const hasSuffix = start + available < bodyText.length;
  return `${hasPrefix ? "…" : ""}${content}${hasSuffix ? "…" : ""}`;
}

export async function searchStudioDocuments(
  repository: StudioRepository,
  scope: StudioOwnerScope,
  rawQuery: string,
  requestedLimit: number
): Promise<StudioSearchResult[]> {
  const query = prepareStudioSearchQuery(rawQuery);
  if (!query || !Number.isFinite(requestedLimit) || requestedLimit <= 0) return [];
  const limit = Math.min(Math.trunc(requestedLimit), MAX_SEARCH_RESULTS);
  const documents = await repository.searchDocuments(scope, { query: query.query, limit });
  const collectionContext = await repository.listDocumentCollectionsBatch(scope, documents.map((document) => document.id));

  return documents.map((document) => ({
    documentId: document.id,
    title: document.title,
    excerpt: excerpt(document.bodyText, query),
    updatedAt: document.updatedAt,
    collections: (collectionContext[document.id] ?? []).map((collection) => ({ id: collection.id, name: collection.name })),
    structures: []
  }));
}
