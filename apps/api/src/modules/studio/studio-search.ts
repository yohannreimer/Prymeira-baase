import type {
  StudioDocument,
  StudioOwnerScope,
  StudioRepository,
  StudioSearchResult
} from "./studio.types";

const SEARCH_PAGE_SIZE = 100;
const MAX_SCANNED_DOCUMENTS = 1_000;
const MAX_SEARCH_RESULTS = 50;
const MAX_EXCERPT_LENGTH = 240;

function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Mark}+/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/gu, " ")
    .trim();
}

function relevance(document: StudioDocument, query: string, tokens: string[]) {
  const title = fold(document.title ?? "");
  const body = fold(document.bodyText);
  const combined = `${title} ${body}`;
  if (!tokens.every((token) => combined.includes(token))) return null;

  let score = 0;
  if (title === query) score += 400;
  else if (title.startsWith(query)) score += 300;
  else if (title.includes(query)) score += 200;
  if (body.includes(query)) score += 100;
  for (const token of tokens) {
    if (title.includes(token)) score += 20;
    if (body.includes(token)) score += 5;
  }
  return score;
}

function excerpt(bodyText: string, query: string, tokens: string[]) {
  const body = bodyText.replace(/\s+/gu, " ").trim();
  if (body.length <= MAX_EXCERPT_LENGTH) return body;
  const foldedBody = fold(body);
  const matchIndex = foldedBody.indexOf(query) >= 0
    ? foldedBody.indexOf(query)
    : tokens.reduce((found, token) => found >= 0 ? found : foldedBody.indexOf(token), -1);
  const start = Math.max(0, matchIndex - 80);
  const hasPrefix = start > 0;
  const available = MAX_EXCERPT_LENGTH - (hasPrefix ? 1 : 0) - 1;
  const content = body.slice(start, start + available).trim();
  return `${hasPrefix ? "…" : ""}${content}…`;
}

export async function searchStudioDocuments(
  repository: StudioRepository,
  scope: StudioOwnerScope,
  rawQuery: string,
  requestedLimit: number
): Promise<StudioSearchResult[]> {
  const query = fold(rawQuery);
  if (!query || !Number.isFinite(requestedLimit) || requestedLimit <= 0) return [];
  const limit = Math.min(Math.trunc(requestedLimit), MAX_SEARCH_RESULTS);
  const tokens = [...new Set(query.split(" ").filter(Boolean))];
  const ranked: Array<{ document: StudioDocument; score: number }> = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let scanned = 0;

  while (scanned < MAX_SCANNED_DOCUMENTS) {
    const page = await repository.listDocuments(scope, {
      cursor,
      limit: Math.min(SEARCH_PAGE_SIZE, MAX_SCANNED_DOCUMENTS - scanned),
      status: "active"
    });
    scanned += page.items.length;
    for (const document of page.items) {
      const score = relevance(document, query, tokens);
      if (score !== null) ranked.push({ document, score });
    }
    if (!page.nextCursor || scanned >= MAX_SCANNED_DOCUMENTS) break;
    if (seenCursors.has(page.nextCursor)) throw new Error("STUDIO_DOCUMENT_PAGINATION_INVALID");
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  ranked.sort((left, right) =>
    right.score - left.score
    || right.document.updatedAt.localeCompare(left.document.updatedAt)
    || left.document.id.localeCompare(right.document.id)
  );

  return Promise.all(ranked.slice(0, limit).map(async ({ document }) => ({
    documentId: document.id,
    title: document.title,
    excerpt: excerpt(document.bodyText, query, tokens),
    updatedAt: document.updatedAt,
    collections: (await repository.listDocumentCollections(scope, document.id))
      .map((collection) => ({ id: collection.id, name: collection.name }))
  })));
}
