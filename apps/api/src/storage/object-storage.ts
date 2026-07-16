import type { Readable } from "node:stream";

export type PutObjectInput = {
  key: string;
  body: Readable;
  contentType: string;
  sizeBytes: number;
};

export type AtomicUploadInput = {
  key: string;
  contentType: string;
  sizeBytes: number;
};

export type CompleteAtomicUploadInput = {
  key: string;
  uploadId: string;
  body: Readable;
  sizeBytes: number;
};

export type AbortAtomicUploadInput = {
  key: string;
  uploadId: string;
};

export type DownloadUrlOptions = {
  downloadFilename?: string;
};

export type ObjectStorage = {
  ensureReady(): Promise<void>;
  put(input: PutObjectInput, options?: { signal?: AbortSignal }): Promise<void>;
  beginAtomicUpload(input: AtomicUploadInput, options?: { signal?: AbortSignal }): Promise<{ uploadId: string }>;
  completeAtomicUploadFromStream(
    input: CompleteAtomicUploadInput,
    options?: { signal?: AbortSignal }
  ): Promise<void>;
  abortAtomicUpload(input: AbortAtomicUploadInput, options?: { signal?: AbortSignal }): Promise<void>;
  inspectAtomicUpload(input: AbortAtomicUploadInput, options?: { signal?: AbortSignal }): Promise<{ active: boolean }>;
  get(key: string, options?: { signal?: AbortSignal }): Promise<{
    body: Readable;
    contentType: string | null;
    sizeBytes: number | null;
  }>;
  createDownloadUrl(key: string, expiresInSeconds: number, options?: DownloadUrlOptions): Promise<string>;
  delete(key: string, options?: { signal?: AbortSignal }): Promise<void>;
};

export function attachmentContentDisposition(filename: string): string {
  const singleLine = filename.split(/[\r\n]/u, 1)[0]?.trim() || "download";
  const fallback = singleLine.normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^\x20-\x7E]/gu, "_")
    .replace(/["\\]/gu, "_")
    .trim() || "download";
  const encoded = encodeURIComponent(singleLine).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
