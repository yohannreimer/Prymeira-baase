import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileTypeFromFile } from "file-type";
import { parseFile } from "music-metadata";
import { ApiError } from "../../http/api-error";

export const STUDIO_ASSET_MAX_FILE_BYTES = 25 * 1024 * 1024;

export type StudioUploadSemaphore = {
  tryAcquire(): (() => void) | null;
};

export type PreparedStudioAssetUpload = {
  path: string;
  sizeBytes: number;
  mimeType: string;
  cleanup(): Promise<void>;
};

export function createStudioUploadSemaphore(maxConcurrent = 2): StudioUploadSemaphore {
  let active = 0;
  return {
    tryAcquire() {
      if (active >= maxConcurrent) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    }
  };
}

export async function spoolStudioAssetUpload(
  input: { file: NodeJS.ReadableStream; declaredMimeType: string; isTruncated?: () => boolean },
  run: (file: { path: string; sizeBytes: number; mimeType: string }) => Promise<unknown>,
  options: {
    onCleanupError?: (error: unknown, path: string) => void;
    removeDirectory?: typeof rm;
    signal?: AbortSignal;
  } = {}
) {
  const prepared = await prepareStudioAssetUpload(input, options);
  try {
    return await run({ path: prepared.path, sizeBytes: prepared.sizeBytes, mimeType: prepared.mimeType });
  } finally {
    await prepared.cleanup();
  }
}

export async function prepareStudioAssetUpload(
  input: { file: NodeJS.ReadableStream; declaredMimeType: string; isTruncated?: () => boolean },
  options: {
    onCleanupError?: (error: unknown, path: string) => void;
    removeDirectory?: typeof rm;
    signal?: AbortSignal;
  } = {}
): Promise<PreparedStudioAssetUpload> {
  const directory = await mkdtemp(join(tmpdir(), "baase-studio-upload-"));
  const path = join(directory, "private-upload");
  let sizeBytes = 0;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      await (options.removeDirectory ?? rm)(directory, { recursive: true, force: true });
    } catch (error) {
      try {
        options.onCleanupError?.(error, directory);
      } catch {
        // Reporting must never replace the upload's primary success or failure.
      }
    }
  };
  const counter = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += buffer.length;
      if (sizeBytes > STUDIO_ASSET_MAX_FILE_BYTES) {
        callback(new ApiError(413, "PAYLOAD_TOO_LARGE", "O arquivo enviado é grande demais para esta operação.", {
          limit_bytes: STUDIO_ASSET_MAX_FILE_BYTES
        }));
        return;
      }
      callback(null, buffer);
    }
  });
  try {
    await pipeline(
      input.file,
      counter,
      createWriteStream(path, { flags: "wx", mode: 0o600 }),
      { signal: options.signal }
    );
    if (sizeBytes === 0) {
      throw new ApiError(400, "STUDIO_ASSET_FILE_EMPTY", "O arquivo não pode estar vazio.");
    }
    if (input.isTruncated?.()) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "O arquivo enviado é grande demais para esta operação.", {
        limit_bytes: STUDIO_ASSET_MAX_FILE_BYTES
      });
    }
    const inspected = await inspectStudioUploadFile(path, input.declaredMimeType);
    return { path, sizeBytes, mimeType: inspected.mimeType, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function scavengeStaleStudioUploadDirectories(options: {
  root?: string;
  now?: () => number;
  olderThanMs?: number;
  maxEntries?: number;
  cursor?: string | null;
  signal?: AbortSignal;
  onError?: (error: unknown, path: string) => void;
} = {}) {
  const root = options.root ?? tmpdir();
  const now = options.now ?? Date.now;
  const olderThanMs = options.olderThanMs ?? 24 * 60 * 60_000;
  const maxEntries = options.maxEntries ?? 100;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    reportScavengeError(options.onError, error, root);
    return { removed: 0, nextCursor: null };
  }
  const matchingNames = entries
    .filter((entry) => entry.isDirectory() && /^baase-studio-upload-[A-Za-z0-9_-]+$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const cursor = options.cursor ?? null;
  const orderedNames = cursor === null
    ? matchingNames
    : [...matchingNames.filter((name) => name > cursor), ...matchingNames.filter((name) => name <= cursor)];
  const selectedNames = orderedNames.slice(0, maxEntries);
  let removed = 0;
  for (const name of selectedNames) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    const path = join(root, name);
    try {
      const metadata = await stat(path, { bigint: false });
      if (now() - metadata.mtimeMs < olderThanMs) continue;
      await rm(path, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      reportScavengeError(options.onError, error, path);
    }
  }
  return {
    removed,
    nextCursor: matchingNames.length > selectedNames.length
      ? selectedNames.at(-1) ?? cursor
      : null
  };
}

export async function inspectStudioUploadFile(path: string, declaredMimeType: string) {
  const declared = declaredMimeType.trim().toLowerCase();
  const handle = await open(path, "r");
  const header = Buffer.alloc(64 * 1024);
  let bytesRead = 0;
  try {
    ({ bytesRead } = await handle.read(header, 0, header.length, 0));
  } finally {
    await handle.close();
  }
  const detected = detectBinaryMime(header.subarray(0, bytesRead));
  if (detected) {
    if (!mimeMatches(declared, detected)) throw mimeMismatch();
    return { mimeType: detected };
  }
  if (declared === "text/plain" || declared === "text/markdown") {
    await validateUtf8Text(path);
    return { mimeType: declared };
  }
  if (declared.startsWith("audio/")) {
    return { mimeType: await inspectAudioFile(path, declared) };
  }
  if (!supportedDeclaredMime(declared)) {
    throw new ApiError(415, "STUDIO_ASSET_MIME_UNSUPPORTED", "Este tipo de arquivo não é aceito no Studio.");
  }
  throw mimeMismatch();
}

export function studioAssetReadStream(path: string) {
  return createReadStream(path);
}

function detectBinaryMime(header: Buffer): string | null {
  if (header.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

async function inspectAudioFile(path: string, declared: string) {
  const detected = await fileTypeFromFile(path);
  const canonical = detectedAudioMime(detected?.mime, detected?.ext);
  if (!canonical || !mimeMatches(declared, canonical)) throw mimeMismatch();
  if (canonical === "audio/mpeg" && !await hasValidMp3Frame(path)) throw mimeMismatch();
  try {
    const metadata = await parseFile(path, { duration: false, skipCovers: true });
    if (metadata.format.hasAudio !== true || metadata.format.hasVideo === true
      || (!metadata.format.codec && metadata.format.numberOfChannels === undefined)) {
      throw mimeMismatch();
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw mimeMismatch();
  }
  return canonical;
}

function detectedAudioMime(mime?: string, extension?: string) {
  const baseMime = mime?.split(";", 1)[0]?.trim().toLowerCase();
  if (baseMime === "audio/mpeg" && extension === "mp3") return "audio/mpeg";
  if ((baseMime === "audio/wav" || baseMime === "audio/x-wav") && extension === "wav") return "audio/wav";
  if (baseMime === "audio/ogg" && ["ogg", "oga", "opus", "spx", "ogm", "ogv"].includes(extension ?? "")) {
    return "audio/ogg";
  }
  if ((baseMime === "video/webm" || baseMime === "audio/webm") && extension === "webm") return "audio/webm";
  if ((baseMime === "video/mp4" || baseMime === "audio/mp4" || baseMime === "audio/x-m4a")
    && ["mp4", "m4a", "m4b", "m4p", "m4v", "f4a", "f4b"].includes(extension ?? "")) {
    return "audio/mp4";
  }
  return null;
}

async function hasValidMp3Frame(path: string) {
  const handle = await open(path, "r");
  let offset = 0;
  try {
    const metadata = await handle.stat();
    const id3Header = Buffer.alloc(10);
    const { bytesRead } = await handle.read(id3Header, 0, id3Header.length, 0);
    if (bytesRead >= 3 && id3Header.subarray(0, 3).toString("ascii") === "ID3") {
      const version = id3Header[3]!;
      if (bytesRead < 10 || version < 2 || version > 4
        || [...id3Header.subarray(6, 10)].some((value) => (value & 0x80) !== 0)) return false;
      const tagSize = (id3Header[6]! << 21) | (id3Header[7]! << 14)
        | (id3Header[8]! << 7) | id3Header[9]!;
      const footerSize = version === 4 && (id3Header[5]! & 0x10) !== 0 ? 10 : 0;
      offset = 10 + tagSize + footerSize;
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + 4 > metadata.size) return false;
    const framePrefix = Buffer.alloc(Math.min(64 * 1024, metadata.size - offset));
    const frameRead = await handle.read(framePrefix, 0, framePrefix.length, offset);
    return containsValidMp3Frame(framePrefix.subarray(0, frameRead.bytesRead));
  } finally {
    await handle.close();
  }
}

function containsValidMp3Frame(buffer: Buffer) {
  for (let offset = 0; offset + 4 <= buffer.length; offset += 1) {
    const first = buffer[offset]!;
    const second = buffer[offset + 1]!;
    const third = buffer[offset + 2]!;
    if (first !== 0xff || (second & 0xe0) !== 0xe0) continue;
    const version = (second >> 3) & 0x03;
    const layer = (second >> 1) & 0x03;
    const bitrateIndex = (third >> 4) & 0x0f;
    const sampleRateIndex = (third >> 2) & 0x03;
    return version !== 0x01 && layer !== 0x00
      && bitrateIndex !== 0x00 && bitrateIndex !== 0x0f && sampleRateIndex !== 0x03;
  }
  return false;
}

function reportScavengeError(
  onError: ((error: unknown, path: string) => void) | undefined,
  error: unknown,
  path: string
) {
  try {
    onError?.(error, path);
  } catch {
    // Reporting cannot make maintenance fail or widen deletion scope.
  }
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new Error("STUDIO_UPLOAD_SCAVENGE_ABORTED");
}

async function validateUtf8Text(path: string) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for await (const chunk of createReadStream(path)) {
      const text = decoder.decode(Buffer.from(chunk), { stream: true });
      if (/\0|[\u0001-\u0008\u000B\u000C\u000E-\u001F]/u.test(text)) throw new Error();
    }
    const tail = decoder.decode();
    if (/\0|[\u0001-\u0008\u000B\u000C\u000E-\u001F]/u.test(tail)) throw new Error();
  } catch {
    throw new ApiError(415, "STUDIO_ASSET_TEXT_INVALID", "O arquivo de texto contém dados binários ou UTF-8 inválido.");
  }
}

function supportedDeclaredMime(value: string) {
  return new Set([
    "application/pdf", "image/png", "image/jpeg", "image/webp",
    "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/mpeg", "audio/mp4"
  ]).has(value);
}

function mimeMatches(declared: string, detected: string) {
  return declared === detected || (detected === "audio/wav" && declared === "audio/x-wav");
}

function mimeMismatch() {
  return new ApiError(415, "STUDIO_ASSET_MIME_MISMATCH", "O conteúdo do arquivo não corresponde ao tipo declarado.");
}
