import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bootstrapS3ObjectStorage: vi.fn()
}));

vi.mock("../storage/s3-object-storage-bootstrap", () => ({
  bootstrapS3ObjectStorage: mocks.bootstrapS3ObjectStorage
}));

import { runObjectStorageBootstrap } from "./bootstrap-object-storage";

const storageEnvKeys = [
  "BAASE_RUNTIME_MODE",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "S3_FORCE_PATH_STYLE",
  "S3_MULTIPART_CLEANUP_MODE"
] as const;
const originalEnv = Object.fromEntries(storageEnvKeys.map((key) => [key, process.env[key]]));

describe("object storage bootstrap job", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.bootstrapS3ObjectStorage.mockReset();
    for (const key of storageEnvKeys) delete process.env[key];
  });

  afterEach(() => {
    for (const key of storageEnvKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("passes the native MinIO cleanup mode to bootstrap", async () => {
    Object.assign(process.env, {
      BAASE_RUNTIME_MODE: "production",
      S3_ENDPOINT: "http://minio:9000",
      S3_REGION: "us-east-1",
      S3_BUCKET: "prymeira-baase",
      S3_ACCESS_KEY: "minio-user",
      S3_SECRET_KEY: "minio-secret",
      S3_FORCE_PATH_STYLE: "true",
      S3_MULTIPART_CLEANUP_MODE: "minio-native"
    });
    mocks.bootstrapS3ObjectStorage.mockResolvedValue({
      bucketCreated: false,
      lifecycleUpdated: false
    });
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(runObjectStorageBootstrap()).resolves.toEqual({
      bucketCreated: false,
      lifecycleUpdated: false
    });
    expect(mocks.bootstrapS3ObjectStorage).toHaveBeenCalledWith({
      endpoint: "http://minio:9000",
      region: "us-east-1",
      bucket: "prymeira-baase",
      accessKeyId: "minio-user",
      secretAccessKey: "minio-secret",
      forcePathStyle: true,
      multipartCleanupMode: "minio-native"
    });
  });
});
