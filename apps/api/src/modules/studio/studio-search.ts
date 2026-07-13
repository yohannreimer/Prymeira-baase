import type {
  StudioOwnerScope,
  StudioRepository,
  StudioSearchDocument,
  StudioSearchResult
} from "./studio.types";

const MAX_SEARCH_RESULTS = 50;
const MAX_EXCERPT_LENGTH = 240;

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

function foldWithOriginalOffsets(value: string): FoldedText {
  let folded = "";
  const originalOffsets: number[] = [];
  let previousWasWhitespace = false;

  for (let index = 0; index < value.length;) {
    const character = String.fromCodePoint(value.codePointAt(index)!);
    const characterLength = character.length;
    if (/\s/u.test(character)) {
      if (folded && !previousWasWhitespace) {
        folded += " ";
        originalOffsets.push(index);
        previousWasWhitespace = true;
      }
      index += characterLength;
      continue;
    }

    const transformed = character
      .normalize("NFD")
      .replace(/\p{Mark}+/gu, "")
      .toLocaleLowerCase("pt-BR");
    for (let transformedIndex = 0; transformedIndex < transformed.length; transformedIndex += 1) {
      folded += transformed[transformedIndex];
      originalOffsets.push(index);
    }
    if (transformed) previousWasWhitespace = false;
    index += characterLength;
  }

  if (folded.endsWith(" ")) {
    folded = folded.slice(0, -1);
    originalOffsets.pop();
  }
  return { value: folded, originalOffsets };
}

function lexicalTokens(value: string) {
  return value.split(/[^\p{Letter}\p{Number}]+/u).filter(Boolean);
}

export function studioSearchTokens(value: string) {
  return [...new Set(lexicalTokens(foldStudioSearchText(value)))].sort();
}

export function studioSearchScore(document: StudioSearchDocument, query: string) {
  const title = foldStudioSearchText(document.title ?? "");
  const body = foldStudioSearchText(document.bodyText);
  const documentTokens = new Set(studioSearchTokens(`${title} ${body}`));
  if (!lexicalTokens(query).every((token) => documentTokens.has(token))) return null;

  let score = 0;
  if (title === query) score += 400;
  else if (title.startsWith(query)) score += 300;
  else if (title.includes(query)) score += 200;
  if (body.includes(query)) score += 100;
  return score;
}

function excerpt(bodyText: string, query: string) {
  if (bodyText.length <= MAX_EXCERPT_LENGTH) return bodyText;
  const foldedBody = foldWithOriginalOffsets(bodyText);
  const queryTokens = lexicalTokens(query);
  const foldedMatchIndex = foldedBody.value.indexOf(query) >= 0
    ? foldedBody.value.indexOf(query)
    : queryTokens.reduce((found, token) => (
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
  const query = foldStudioSearchText(rawQuery);
  if (!query || !Number.isFinite(requestedLimit) || requestedLimit <= 0) return [];
  const limit = Math.min(Math.trunc(requestedLimit), MAX_SEARCH_RESULTS);
  const documents = await repository.searchDocuments(scope, { query, limit });

  return Promise.all(documents.map(async (document) => ({
    documentId: document.id,
    title: document.title,
    excerpt: excerpt(document.bodyText, query),
    updatedAt: document.updatedAt,
    collections: (await repository.listDocumentCollections(scope, document.id))
      .map((collection) => ({ id: collection.id, name: collection.name }))
  })));
}
