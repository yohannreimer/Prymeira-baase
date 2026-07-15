import {
  CreateBucketCommand,
  GetBucketLifecycleConfigurationCommand,
  HeadBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  type LifecycleRule
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  BAASE_MULTIPART_LIFECYCLE_RULE_ID,
  createBaaseMultipartLifecycleRule
} from "./s3-lifecycle-policy";
import { bootstrapS3ObjectStorage } from "./s3-object-storage-bootstrap";

const config = {
  endpoint: "http://object-storage.test",
  region: "us-east-1",
  bucket: "private",
  accessKeyId: "test",
  secretAccessKey: "test",
  forcePathStyle: true,
  multipartCleanupMode: "lifecycle" as const
};

describe("S3 object storage bootstrap", () => {
  it("creates a missing MinIO bucket without lifecycle requests", async () => {
    const commands: unknown[] = [];
    const client = {
      send: vi.fn(async (command: unknown) => {
        commands.push(command);
        if (command instanceof HeadBucketCommand) {
          throw Object.assign(new Error("missing"), { name: "NoSuchBucket" });
        }
        if (command instanceof CreateBucketCommand) return {};
        throw new Error("unexpected command");
      })
    };

    await expect(bootstrapS3ObjectStorage({
      ...config,
      multipartCleanupMode: "minio-native"
    }, client)).resolves.toEqual({
      bucketCreated: true,
      lifecycleUpdated: false
    });
    expect(commands.filter((command) =>
      command instanceof GetBucketLifecycleConfigurationCommand
      || command instanceof PutBucketLifecycleConfigurationCommand)).toHaveLength(0);
  });

  it("is idempotent for an existing native MinIO bucket", async () => {
    const client = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof HeadBucketCommand) return {};
        throw new Error("unexpected command");
      })
    };
    const nativeConfig = { ...config, multipartCleanupMode: "minio-native" as const };

    await expect(bootstrapS3ObjectStorage(nativeConfig, client)).resolves.toEqual({
      bucketCreated: false,
      lifecycleUpdated: false
    });
    await expect(bootstrapS3ObjectStorage(nativeConfig, client)).resolves.toEqual({
      bucketCreated: false,
      lifecycleUpdated: false
    });
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it("creates a missing bucket and installs a missing lifecycle rule", async () => {
    let configuredRules: LifecycleRule[] | undefined;
    const client = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof HeadBucketCommand) {
          throw Object.assign(new Error("missing"), { $metadata: { httpStatusCode: 404 } });
        }
        if (command instanceof CreateBucketCommand) return {};
        if (command instanceof GetBucketLifecycleConfigurationCommand) {
          return { Rules: configuredRules };
        }
        if (command instanceof PutBucketLifecycleConfigurationCommand) {
          configuredRules = command.input.LifecycleConfiguration?.Rules;
          return {};
        }
        throw new Error("unexpected command");
      })
    };

    await expect(bootstrapS3ObjectStorage(config, client)).resolves.toEqual({
      bucketCreated: true,
      lifecycleUpdated: true
    });
    expect(configuredRules).toEqual([createBaaseMultipartLifecycleRule()]);
  });

  it("does not rewrite an existing safe lifecycle policy", async () => {
    const safeRule = createBaaseMultipartLifecycleRule();
    const client = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof HeadBucketCommand) return {};
        if (command instanceof GetBucketLifecycleConfigurationCommand) return { Rules: [safeRule] };
        throw new Error("unexpected command");
      })
    };

    await expect(bootstrapS3ObjectStorage(config, client)).resolves.toEqual({
      bucketCreated: false,
      lifecycleUpdated: false
    });
    expect(client.send.mock.calls.some(([command]) =>
      command instanceof PutBucketLifecycleConfigurationCommand)).toBe(false);
  });

  it("preserves foreign rules and replaces an unsafe managed rule", async () => {
    const foreignRule: LifecycleRule = {
      ID: "archive-old-objects",
      Status: "Enabled",
      Filter: { Prefix: "archive/" },
      Expiration: { Days: 90 }
    };
    const unsafeManagedRule: LifecycleRule = {
      ID: BAASE_MULTIPART_LIFECYCLE_RULE_ID,
      Status: "Disabled",
      Filter: { Prefix: "other/" },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 30 }
    };
    let configuredRules: LifecycleRule[] = [foreignRule, unsafeManagedRule];
    const client = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof HeadBucketCommand) return {};
        if (command instanceof GetBucketLifecycleConfigurationCommand) return { Rules: configuredRules };
        if (command instanceof PutBucketLifecycleConfigurationCommand) {
          configuredRules = command.input.LifecycleConfiguration?.Rules ?? [];
          return {};
        }
        throw new Error("unexpected command");
      })
    };

    await expect(bootstrapS3ObjectStorage(config, client)).resolves.toEqual({
      bucketCreated: false,
      lifecycleUpdated: true
    });
    expect(configuredRules).toEqual([foreignRule, createBaaseMultipartLifecycleRule()]);
    expect(configuredRules.filter((rule) => rule.ID === BAASE_MULTIPART_LIFECYCLE_RULE_ID))
      .toHaveLength(1);
  });

  it("fails when the lifecycle remains unsafe after writing", async () => {
    const client = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof HeadBucketCommand) return {};
        if (command instanceof GetBucketLifecycleConfigurationCommand) return { Rules: [] };
        if (command instanceof PutBucketLifecycleConfigurationCommand) return {};
        throw new Error("unexpected command");
      })
    };

    await expect(bootstrapS3ObjectStorage(config, client))
      .rejects.toThrow("STUDIO_STORAGE_MULTIPART_LIFECYCLE_REQUIRED");
  });

  it("is idempotent across two executions", async () => {
    let configuredRules: LifecycleRule[] = [];
    const client = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof HeadBucketCommand) return {};
        if (command instanceof GetBucketLifecycleConfigurationCommand) return { Rules: configuredRules };
        if (command instanceof PutBucketLifecycleConfigurationCommand) {
          configuredRules = command.input.LifecycleConfiguration?.Rules ?? [];
          return {};
        }
        throw new Error("unexpected command");
      })
    };

    await expect(bootstrapS3ObjectStorage(config, client)).resolves.toEqual({
      bucketCreated: false,
      lifecycleUpdated: true
    });
    await expect(bootstrapS3ObjectStorage(config, client)).resolves.toEqual({
      bucketCreated: false,
      lifecycleUpdated: false
    });
    expect(client.send.mock.calls.filter(([command]) =>
      command instanceof PutBucketLifecycleConfigurationCommand)).toHaveLength(1);
    expect(configuredRules.filter((rule) => rule.ID === BAASE_MULTIPART_LIFECYCLE_RULE_ID))
      .toHaveLength(1);
  });

  it("propagates AccessDenied without attempting bucket creation", async () => {
    const denied = Object.assign(new Error("denied"), { name: "AccessDenied" });
    const client = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof HeadBucketCommand) throw denied;
        throw new Error("unexpected command");
      })
    };

    await expect(bootstrapS3ObjectStorage(config, client)).rejects.toBe(denied);
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it("propagates AccessDenied while reading lifecycle without writing", async () => {
    const denied = Object.assign(new Error("denied"), { code: "AccessDenied" });
    const client = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof HeadBucketCommand) return {};
        if (command instanceof GetBucketLifecycleConfigurationCommand) throw denied;
        throw new Error("unexpected command");
      })
    };

    await expect(bootstrapS3ObjectStorage(config, client)).rejects.toBe(denied);
    expect(client.send.mock.calls.some(([command]) =>
      command instanceof PutBucketLifecycleConfigurationCommand)).toBe(false);
  });

  it("treats NoSuchLifecycleConfiguration as an empty policy", async () => {
    let lifecycleReads = 0;
    let configuredRules: LifecycleRule[] = [];
    const client = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof HeadBucketCommand) return {};
        if (command instanceof GetBucketLifecycleConfigurationCommand && lifecycleReads++ === 0) {
          throw Object.assign(new Error("missing lifecycle"), {
            Code: "NoSuchLifecycleConfiguration"
          });
        }
        if (command instanceof GetBucketLifecycleConfigurationCommand) return { Rules: configuredRules };
        if (command instanceof PutBucketLifecycleConfigurationCommand) {
          configuredRules = command.input.LifecycleConfiguration?.Rules ?? [];
          return {};
        }
        throw new Error("unexpected command");
      })
    };

    await expect(bootstrapS3ObjectStorage(config, client)).resolves.toEqual({
      bucketCreated: false,
      lifecycleUpdated: true
    });
    expect(configuredRules).toEqual([createBaaseMultipartLifecycleRule()]);
  });

  it("accepts an explicitly safe already-owned bucket creation race", async () => {
    let configuredRules: LifecycleRule[] = [];
    const client = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof HeadBucketCommand) {
          throw Object.assign(new Error("missing"), { name: "NotFound" });
        }
        if (command instanceof CreateBucketCommand) {
          throw Object.assign(new Error("won by another bootstrap"), {
            code: "BucketAlreadyOwnedByYou"
          });
        }
        if (command instanceof GetBucketLifecycleConfigurationCommand) {
          return { Rules: configuredRules };
        }
        if (command instanceof PutBucketLifecycleConfigurationCommand) {
          configuredRules = command.input.LifecycleConfiguration?.Rules ?? [];
          return {};
        }
        throw new Error("unexpected command");
      })
    };

    await expect(bootstrapS3ObjectStorage(config, client)).resolves.toEqual({
      bucketCreated: false,
      lifecycleUpdated: true
    });
  });

  it("propagates BucketAlreadyExists without accessing lifecycle", async () => {
    const collision = Object.assign(new Error("owned by another account"), {
      Code: "BucketAlreadyExists"
    });
    const client = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof HeadBucketCommand) {
          throw Object.assign(new Error("missing"), { name: "NoSuchBucket" });
        }
        if (command instanceof CreateBucketCommand) throw collision;
        throw new Error("unexpected lifecycle access");
      })
    };

    await expect(bootstrapS3ObjectStorage(config, client)).rejects.toBe(collision);
    expect(client.send).toHaveBeenCalledTimes(2);
    expect(client.send.mock.calls.some(([command]) =>
      command instanceof GetBucketLifecycleConfigurationCommand
      || command instanceof PutBucketLifecycleConfigurationCommand)).toBe(false);
  });
});
