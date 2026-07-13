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
  } = {}
) {
  const directory = await mkdtemp(join(tmpdir(), "baase-studio-upload-"));
  const path = join(directory, "private-upload");
  let sizeBytes = 0;
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
    await pipeline(input.file, counter, createWriteStream(path, { flags: "wx", mode: 0o600 }));
    if (sizeBytes === 0) {
      throw new ApiError(400, "STUDIO_ASSET_FILE_EMPTY", "O arquivo não pode estar vazio.");
    }
    if (input.isTruncated?.()) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "O arquivo enviado é grande demais para esta operação.", {
        limit_bytes: STUDIO_ASSET_MAX_FILE_BYTES
      });
    }
    const inspected = await inspectStudioUploadFile(path, input.declaredMimeType);
    return await run({ path, sizeBytes, mimeType: inspected.mimeType });
  } finally {
    try {
      await (options.removeDirectory ?? rm)(directory, { recursive: true, force: true });
    } catch (error) {
      try {
        options.onCleanupError?.(error, directory);
      } catch {
        // Reporting must never replace the upload's primary success or failure.
      }
    }
  }
}

export async function scavengeStaleStudioUploadDirectories(options: {
  root?: string;
  now?: () => number;
  olderThanMs?: number;
  maxEntries?: number;
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
    options.onError?.(error, root);
    return 0;
  }
  let removed = 0;
  for (const entry of entries.slice(0, maxEntries)) {
    if (!entry.isDirectory() || !/^baase-studio-upload-[A-Za-z0-9_-]+$/u.test(entry.name)) continue;
    const path = join(root, entry.name);
    try {
      const metadata = await stat(path, { bigint: false });
      if (now() - metadata.mtimeMs < olderThanMs) continue;
      await rm(path, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      options.onError?.(error, path);
    }
  }
  return removed;
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
    return { mimeType: await inspectAudioFile(path, declared, header.subarray(0, bytesRead)) };
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

async function inspectAudioFile(path: string, declared: string, header: Buffer) {
  const detected = await fileTypeFromFile(path);
  const canonical = detectedAudioMime(detected?.mime, detected?.ext);
  if (!canonical || !mimeMatches(declared, canonical)) throw mimeMismatch();
  if (canonical === "audio/mpeg" && !hasValidMp3Frame(header)) throw mimeMismatch();
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

function hasValidMp3Frame(header: Buffer) {
  let offset = 0;
  if (header.subarray(0, 3).toString("ascii") === "ID3") {
    if (header.length < 10 || [...header.subarray(6, 10)].some((value) => (value & 0x80) !== 0)) return false;
    const size = (header[6]! << 21) | (header[7]! << 14) | (header[8]! << 7) | header[9]!;
    offset = 10 + size;
  }
  for (; offset + 4 <= header.length; offset += 1) {
    const first = header[offset]!;
    const second = header[offset + 1]!;
    const third = header[offset + 2]!;
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
