import { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadBucketCommand,
  UploadPartCommand
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { createS3ObjectStorage } from "./s3-object-storage";

const config = {
  region: "us-east-1",
  bucket: "private",
  accessKeyId: "test",
  secretAccessKey: "test",
  forcePathStyle: true
};

describe("S3 atomic multipart uploads", () => {
  it("uploads ordered five-MiB parts and publishes only with CompleteMultipartUpload", async () => {
    const commands: unknown[] = [];
    let part = 0;
    const client = {
      send: vi.fn(async (command: unknown) => {
        commands.push(command);
        if (command instanceof HeadBucketCommand) return {};
        if (command instanceof CreateMultipartUploadCommand) return { UploadId: "upload-1" };
        if (command instanceof UploadPartCommand) return { ETag: `etag-${++part}` };
        if (command instanceof CompleteMultipartUploadCommand) return {};
        throw new Error("unexpected command");
      })
    };
    const storage = createS3ObjectStorage(config, client);
    const sizeBytes = 5 * 1024 * 1024 + 7;
    const session = await storage.beginAtomicUpload({
      key: "private/atomic",
      contentType: "application/octet-stream",
      sizeBytes
    });
    await storage.completeAtomicUploadFromStream({
      key: "private/atomic",
      uploadId: session.uploadId,
      body: Readable.from(Buffer.alloc(sizeBytes, 1)),
      sizeBytes
    });

    const parts = commands.filter((command): command is UploadPartCommand => command instanceof UploadPartCommand);
    expect(parts).toHaveLength(2);
    expect(parts.map((command) => command.input.PartNumber)).toEqual([1, 2]);
    expect(parts.map((command) => (command.input.Body as Buffer).length)).toEqual([5 * 1024 * 1024, 7]);
    const complete = commands.find((command): command is CompleteMultipartUploadCommand =>
      command instanceof CompleteMultipartUploadCommand);
    expect(complete?.input.MultipartUpload?.Parts).toEqual([
      { ETag: "etag-1", PartNumber: 1 },
      { ETag: "etag-2", PartNumber: 2 }
    ]);
  });

  it("does not issue Complete after abort even when an UploadPart resolves late", async () => {
    const commands: unknown[] = [];
    let resolvePart!: (value: { ETag: string }) => void;
    let partStarted!: () => void;
    const started = new Promise<void>((resolve) => { partStarted = resolve; });
    const client = {
      send: vi.fn((command: unknown) => {
        commands.push(command);
        if (command instanceof HeadBucketCommand) return Promise.resolve({});
        if (command instanceof CreateMultipartUploadCommand) return Promise.resolve({ UploadId: "upload-late" });
        if (command instanceof UploadPartCommand) {
          partStarted();
          return new Promise<{ ETag: string }>((resolve) => { resolvePart = resolve; });
        }
        if (command instanceof AbortMultipartUploadCommand) return Promise.resolve({});
        if (command instanceof CompleteMultipartUploadCommand) return Promise.resolve({});
        return Promise.reject(new Error("unexpected command"));
      })
    };
    const storage = createS3ObjectStorage(config, client);
    const session = await storage.beginAtomicUpload({
      key: "private/late",
      contentType: "application/octet-stream",
      sizeBytes: 5 * 1024 * 1024
    });
    const controller = new AbortController();
    const completion = storage.completeAtomicUploadFromStream({
      key: "private/late",
      uploadId: session.uploadId,
      body: Readable.from(Buffer.alloc(5 * 1024 * 1024)),
      sizeBytes: 5 * 1024 * 1024
    }, { signal: controller.signal });
    await started;
    controller.abort(new Error("lease lost"));
    resolvePart({ ETag: "late-etag" });
    await expect(completion).rejects.toThrow("lease lost");
    expect(commands.some((command) => command instanceof CompleteMultipartUploadCommand)).toBe(false);
    await storage.abortAtomicUpload({ key: "private/late", uploadId: session.uploadId });
    expect(commands.some((command) => command instanceof AbortMultipartUploadCommand)).toBe(true);
  });

  it("surfaces an abort failure so the same upload id can be retried", async () => {
    let abortAttempts = 0;
    const client = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof AbortMultipartUploadCommand && ++abortAttempts === 1) {
          throw new Error("abort unavailable");
        }
        return {};
      })
    };
    const storage = createS3ObjectStorage(config, client);
    await expect(storage.abortAtomicUpload({ key: "private/key", uploadId: "upload-retry" }))
      .rejects.toThrow("abort unavailable");
    await expect(storage.abortAtomicUpload({ key: "private/key", uploadId: "upload-retry" }))
      .resolves.toBeUndefined();
    const aborts = client.send.mock.calls
      .map(([command]) => command)
      .filter((command): command is AbortMultipartUploadCommand => command instanceof AbortMultipartUploadCommand);
    expect(aborts.map((command) => command.input.UploadId)).toEqual(["upload-retry", "upload-retry"]);
  });
});
