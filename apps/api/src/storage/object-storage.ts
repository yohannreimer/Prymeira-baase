import type { Readable } from "node:stream";

export type PutObjectInput = {
  key: string;
  body: Readable;
  contentType: string;
  sizeBytes: number;
};

export type ObjectStorage = {
  put(input: PutObjectInput, options?: { signal?: AbortSignal }): Promise<void>;
  get(key: string, options?: { signal?: AbortSignal }): Promise<{
    body: Readable;
    contentType: string | null;
    sizeBytes: number | null;
  }>;
  createDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string, options?: { signal?: AbortSignal }): Promise<void>;
};
