import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
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
  run: (file: { path: string; sizeBytes: number; mimeType: string }) => Promise<unknown>
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
    await rm(directory, { recursive: true, force: true });
  }
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
  if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WAVE") return "audio/wav";
  if (header.subarray(0, 4).toString("ascii") === "OggS"
    && (header.includes(Buffer.from("OpusHead")) || header.includes(Buffer.from("vorbis")))) return "audio/ogg";
  if (header.length >= 4
    && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    && header.includes(Buffer.from("webm"))
    && (header.includes(Buffer.from("A_OPUS")) || header.includes(Buffer.from("A_VORBIS")))) return "audio/webm";
  if (header.subarray(0, 3).toString("ascii") === "ID3"
    || (header.length >= 2 && header[0] === 0xff && (header[1]! & 0xe0) === 0xe0)) return "audio/mpeg";
  if (header.subarray(4, 8).toString("ascii") === "ftyp"
    && (header.includes(Buffer.from("M4A ")) || header.includes(Buffer.from("M4B ")))) return "audio/mp4";
  return null;
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
