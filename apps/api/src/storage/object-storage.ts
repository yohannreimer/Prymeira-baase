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

export type ObjectStorage = {
  put(input: PutObjectInput, options?: { signal?: AbortSignal }): Promise<void>;
  beginAtomicUpload(input: AtomicUploadInput, options?: { signal?: AbortSignal }): Promise<{ uploadId: string }>;
  completeAtomicUploadFromStream(
    input: CompleteAtomicUploadInput,
    options?: { signal?: AbortSignal }
  ): Promise<void>;
  abortAtomicUpload(input: AbortAtomicUploadInput, options?: { signal?: AbortSignal }): Promise<void>;
  get(key: string, options?: { signal?: AbortSignal }): Promise<{
    body: Readable;
    contentType: string | null;
    sizeBytes: number | null;
  }>;
  createDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string, options?: { signal?: AbortSignal }): Promise<void>;
};
