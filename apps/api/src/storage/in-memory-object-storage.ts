import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import type { ObjectStorage, PutObjectInput } from "./object-storage";

export type InMemoryObjectStorage = ObjectStorage & {
  failNextPut(error: Error): void;
  failNextDelete(error: Error): void;
  keys(): string[];
};

export function createInMemoryObjectStorage(): InMemoryObjectStorage {
  const objects = new Map<string, { body: Buffer; contentType: string; sizeBytes: number }>();
  let nextPutError: Error | null = null;
  let nextDeleteError: Error | null = null;

  return {
    async put(input: PutObjectInput) {
      if (nextPutError) {
        const error = nextPutError;
        nextPutError = null;
        throw error;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of input.body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      objects.set(input.key, { body, contentType: input.contentType, sizeBytes: body.length });
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) throw new Error("OBJECT_NOT_FOUND");
      return {
        body: Readable.from(Buffer.from(object.body)),
        contentType: object.contentType,
        sizeBytes: object.sizeBytes
      };
    },
    async createDownloadUrl(key, expiresInSeconds) {
      if (!objects.has(key)) throw new Error("OBJECT_NOT_FOUND");
      return `memory://${encodeURIComponent(key)}?expires_in=${expiresInSeconds}`;
    },
    async delete(key) {
      if (nextDeleteError) {
        const error = nextDeleteError;
        nextDeleteError = null;
        throw error;
      }
      objects.delete(key);
    },
    failNextPut(error) {
      nextPutError = error;
    },
    failNextDelete(error) {
      nextDeleteError = error;
    },
    keys() {
      return [...objects.keys()].sort();
    }
  };
}
