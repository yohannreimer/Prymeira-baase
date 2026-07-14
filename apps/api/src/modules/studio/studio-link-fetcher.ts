import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import ipaddr from "ipaddr.js";
import { ApiError } from "../../http/api-error";

const MAX_LINK_BYTES = 5 * 1024 * 1024;
const MAX_LINK_REDIRECTS = 3;
const LINK_TIMEOUT_MS = 10_000;
const SAFE_URL_DNS_TIMEOUT_MS = 5_000;
export const STUDIO_EXTRACTED_TEXT_MAX_CHARACTERS = 500_000;

export type StudioLinkResolver = (hostname: string, signal?: AbortSignal) => Promise<string[]>;

export type StudioLinkFetchResponse = {
  statusCode: number;
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  body: Readable;
};

export type StudioLinkFetcher = (input: {
  url: URL;
  pinnedAddress: string;
  signal: AbortSignal;
}) => Promise<StudioLinkFetchResponse>;

export type StudioLinkSnapshot = {
  title: string;
  extractedText: string;
  textTruncated: boolean;
  originalCharacterCount: number;
  finalUrl: string;
  fetchedAt: string;
  mimeType: string;
  sizeBytes: number;
  redirectCount: number;
};

export async function captureStudioLinkSnapshot(
  sourceUrl: string,
  dependencies: {
    resolver?: StudioLinkResolver;
    fetcher?: StudioLinkFetcher;
    now?: () => Date;
  } = {}
): Promise<StudioLinkSnapshot> {
  const resolver = dependencies.resolver ?? defaultStudioLinkResolver;
  const fetcher = dependencies.fetcher ?? defaultStudioLinkFetcher;
  const now = dependencies.now ?? (() => new Date());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("STUDIO_LINK_TIMEOUT")), LINK_TIMEOUT_MS);
  timeout.unref?.();
  try {
    let url = readSafePublicHttpUrl(sourceUrl);
    let redirectCount = 0;
    while (true) {
      const hostname = url.hostname.replace(/^\[|\]$/gu, "");
      const addresses = await abortable(resolver(hostname, controller.signal), controller.signal);
      if (addresses.length === 0 || addresses.some((address) => !isGloballyRoutableAddress(address))) {
        throw new ApiError(400, "STUDIO_LINK_TARGET_FORBIDDEN", "O link aponta para uma rede não permitida.");
      }
      const response = await abortable(
        fetcher({ url, pinnedAddress: addresses[0]!, signal: controller.signal }),
        controller.signal
      );
      if (isRedirect(response.statusCode)) {
        const location = readHeader(response.headers, "location");
        response.body.destroy();
        if (!location) throw linkFetchFailed();
        if (redirectCount >= MAX_LINK_REDIRECTS) {
          throw new ApiError(400, "STUDIO_LINK_REDIRECT_LIMIT", "O link redirecionou vezes demais.");
        }
        url = readSafePublicHttpUrl(new URL(location, url).toString());
        redirectCount += 1;
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.body.destroy();
        throw linkFetchFailed();
      }
      const mimeType = (readHeader(response.headers, "content-type") ?? "text/plain")
        .split(";", 1)[0]!.trim().toLowerCase();
      const contentEncoding = (readHeader(response.headers, "content-encoding") ?? "identity").toLowerCase();
      if (contentEncoding !== "identity"
        || !new Set(["text/html", "application/xhtml+xml", "text/plain", "text/markdown"]).has(mimeType)) {
        response.body.destroy();
        throw new ApiError(415, "STUDIO_LINK_CONTENT_UNSUPPORTED", "O conteúdo deste link não pode ser capturado.");
      }
      const declaredSize = Number(readHeader(response.headers, "content-length"));
      if (Number.isFinite(declaredSize) && declaredSize > MAX_LINK_BYTES) {
        response.body.destroy();
        throw linkTooLarge();
      }
      const body = await readBoundedBody(response.body, MAX_LINK_BYTES, controller.signal);
      const decoded = body.toString("utf8");
      const extracted = mimeType === "text/html" || mimeType === "application/xhtml+xml"
        ? extractInertHtml(decoded)
        : { title: "", text: decoded.trim() };
      const originalCharacterCount = extracted.text.length;
      return {
        title: extracted.title || url.hostname,
        extractedText: extracted.text.slice(0, STUDIO_EXTRACTED_TEXT_MAX_CHARACTERS),
        textTruncated: originalCharacterCount > STUDIO_EXTRACTED_TEXT_MAX_CHARACTERS,
        originalCharacterCount,
        finalUrl: url.toString(),
        fetchedAt: now().toISOString(),
        mimeType,
        sizeBytes: body.length,
        redirectCount
      };
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      throw new ApiError(504, "STUDIO_LINK_TIMEOUT", "O link demorou demais para responder.");
    }
    throw linkFetchFailed();
  } finally {
    clearTimeout(timeout);
  }
}

export function isGloballyRoutableAddress(address: string) {
  if (address.includes("%") || !ipaddr.isValid(address)) return false;
  try {
    return ipaddr.parse(address).range() === "unicast";
  } catch {
    return false;
  }
}

export function readSafePublicHttpUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(400, "STUDIO_LINK_PROTOCOL_UNSUPPORTED", "O link usa um protocolo não permitido.");
  }
  if (url.username || url.password) {
    throw new ApiError(400, "STUDIO_LINK_CREDENTIALS_FORBIDDEN", "Links com credenciais não são permitidos.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")
    || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new ApiError(400, "STUDIO_LINK_TARGET_FORBIDDEN", "O link aponta para uma rede não permitida.");
  }
  if (isIP(hostname) !== 0 && !isGloballyRoutableAddress(hostname)) {
    throw new ApiError(400, "STUDIO_LINK_TARGET_FORBIDDEN", "O link aponta para uma rede não permitida.");
  }
  return url;
}

export async function validateSafePublicHttpUrl(
  value: string,
  resolver: StudioLinkResolver = defaultStudioLinkResolver,
  signal?: AbortSignal,
  resolverTimeoutMs = SAFE_URL_DNS_TIMEOUT_MS
) {
  const url = readSafePublicHttpUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  const boundedSignal = createBoundedAbortSignal(signal, resolverTimeoutMs, "STUDIO_LINK_DNS_TIMEOUT");
  try {
    if (boundedSignal.signal.aborted) throw boundedSignal.signal.reason;
    const addresses = await abortable(
      resolver(hostname, boundedSignal.signal),
      boundedSignal.signal
    );
    if (addresses.length === 0 || addresses.some((address) => !isGloballyRoutableAddress(address))) {
      throw new ApiError(400, "STUDIO_LINK_TARGET_FORBIDDEN", "O link aponta para uma rede não permitida.");
    }
    return url;
  } finally {
    boundedSignal.cleanup();
  }
}

async function readBoundedBody(body: Readable, limit: number, signal: AbortSignal) {
  const chunks: Buffer[] = [];
  let total = 0;
  const abort = () => body.destroy(signal.reason instanceof Error ? signal.reason : new Error("STUDIO_LINK_TIMEOUT"));
  signal.addEventListener("abort", abort, { once: true });
  try {
    for await (const chunk of body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > limit) {
        body.destroy();
        throw linkTooLarge();
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, total);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => reject(signal.reason));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
    if (signal.aborted) abort();
  });
}

function createBoundedAbortSignal(externalSignal: AbortSignal | undefined, timeoutMs: number, code: string) {
  const controller = new AbortController();
  const mirrorExternalAbort = () => controller.abort(externalSignal?.reason ?? new Error(code));
  externalSignal?.addEventListener("abort", mirrorExternalAbort, { once: true });
  if (externalSignal?.aborted) mirrorExternalAbort();
  const timer = setTimeout(() => controller.abort(new Error(code)), Math.max(1, timeoutMs));
  timer.unref?.();
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", mirrorExternalAbort);
    }
  };
}

function extractInertHtml(html: string) {
  const titleMatch = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title\s*>/iu.exec(html);
  const withoutActiveOrHiddenContent = html
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(script|style|noscript|template|svg)(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/giu, " ");
  return {
    title: decodeHtmlEntities(titleMatch?.[1] ?? "").replace(/\s+/gu, " ").trim().slice(0, 240),
    text: decodeHtmlEntities(withoutActiveOrHiddenContent.replace(/<[^>]*>/gu, " "))
      .replace(/\s+/gu, " ").trim()
  };
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/giu, " ").replace(/&amp;/giu, "&").replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">").replace(/&quot;/giu, '"').replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

async function defaultStudioLinkResolver(hostname: string, signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason;
  const results = await lookup(hostname, { all: true, verbatim: true });
  if (signal?.aborted) throw signal.reason;
  return results.map((result) => result.address);
}

async function defaultStudioLinkFetcher(input: {
  url: URL;
  pinnedAddress: string;
  signal: AbortSignal;
}): Promise<StudioLinkFetchResponse> {
  // Defense in depth: deployments must also deny private/link-local egress at the network layer.
  // This transport disables pooling and pins lookup so application DNS cannot be rebound after validation.
  return new Promise((resolve, reject) => {
    const family = isIP(input.pinnedAddress) as 4 | 6;
    const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, input.pinnedAddress, family);
    };
    const request = (input.url.protocol === "https:" ? httpsRequest : httpRequest)(input.url, {
      agent: false,
      family,
      signal: input.signal,
      lookup: pinnedLookup,
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain,text/markdown;q=0.9",
        "accept-encoding": "identity",
        "user-agent": "Baase-Studio-Link-Snapshot/1.0"
      }
    }, (response) => resolve({
      statusCode: response.statusCode ?? 0,
      headers: response.headers,
      body: response
    }));
    request.once("error", reject);
    request.end();
  });
}

function readHeader(headers: StudioLinkFetchResponse["headers"], name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function isRedirect(statusCode: number) {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function linkFetchFailed() {
  return new ApiError(502, "STUDIO_LINK_FETCH_FAILED", "Não foi possível capturar este link.");
}

function linkTooLarge() {
  return new ApiError(413, "STUDIO_LINK_RESPONSE_TOO_LARGE", "O conteúdo deste link é grande demais para captura.", {
    limit_bytes: MAX_LINK_BYTES
  });
}
