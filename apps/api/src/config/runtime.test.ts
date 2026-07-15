import { describe, expect, it } from "vitest";
import { readRuntimeConfig } from "./runtime";

describe("runtime config", () => {
  it("uses memory and mock providers by default for local demo mode", () => {
    const config = readRuntimeConfig({});

    expect(config).toMatchObject({
      mode: "demo",
      auth: {
        mode: "local",
        accountApiUrl: null
      },
      persistence: "memory",
      operationalStore: "jsonb",
      demoSeedEnabled: true,
      ai: {
        structured: "mock",
        transcription: "mock"
      },
      objectStorage: {
        provider: "memory",
        s3: null
      },
      ok: true,
      warnings: []
    });
  });

  it("uses postgres, OpenAI, and Deepgram when pilot env is complete", () => {
    const config = readRuntimeConfig({
      BAASE_RUNTIME_MODE: "pilot",
      BAASE_AUTH_MODE: "account",
      PRYMEIRA_ACCOUNT_API_URL: "https://hub.prymeiradigital.com.br/api",
      DATABASE_URL: "postgres://baase:baase@localhost:5432/baase",
      BAASE_OPERATIONAL_STORE: "relational",
      OPENAI_API_KEY: "sk-test",
      DEEPGRAM_API_KEY: "dg-test"
    });

    expect(config).toMatchObject({
      mode: "pilot",
      auth: {
        mode: "account",
        accountApiUrl: "https://hub.prymeiradigital.com.br/api"
      },
      persistence: "postgres",
      operationalStore: "relational",
      demoSeedEnabled: false,
      ai: {
        structured: "openai",
        transcription: "deepgram"
      },
      objectStorage: {
        provider: "memory",
        s3: null
      },
      ok: true,
      warnings: []
    });
  });

  it("reports actionable warnings when pilot mode is missing real dependencies", () => {
    const config = readRuntimeConfig({
      BAASE_RUNTIME_MODE: "pilot",
      BAASE_AUTH_MODE: "account"
    });

    expect(config.ok).toBe(false);
    expect(config.warnings).toEqual([
      "PRYMEIRA_ACCOUNT_API_URL ausente: auth real precisa validar acesso no Account Hub.",
      "DATABASE_URL ausente: o modo piloto precisa persistir dados em Postgres.",
      "OPENAI_API_KEY ausente: sugestoes estruturadas vao usar mock.",
      "DEEPGRAM_API_KEY ausente: transcricao de audio vai usar mock."
    ]);
  });

  it("keeps jsonb as the safe pilot fallback", () => {
    const config = readRuntimeConfig({ BAASE_RUNTIME_MODE: "pilot" });
    expect(config.operationalStore).toBe("jsonb");
  });

  it.each([undefined, "invalid"])("rejects %s operational store in production", (value) => {
    const config = readRuntimeConfig({
      BAASE_RUNTIME_MODE: "production",
      BAASE_OPERATIONAL_STORE: value
    });
    expect(config.ok).toBe(false);
    expect(config.operationalStore).toBe("jsonb");
    expect(config.warnings).toContain(
      "BAASE_OPERATIONAL_STORE deve ser definido como jsonb ou relational em produção."
    );
  });

  it("does not select relational storage without a database", () => {
    const config = readRuntimeConfig({ BAASE_OPERATIONAL_STORE: "relational" });
    expect(config.operationalStore).toBe("relational");
    expect(config.persistence).toBe("memory");
    expect(config.ok).toBe(false);
    expect(config.warnings).toContain("BAASE_OPERATIONAL_STORE=relational requer DATABASE_URL.");
  });

  it("does not allow production to fall back to memory before the S3 lifecycle startup check", () => {
    const config = readRuntimeConfig({
      BAASE_RUNTIME_MODE: "production",
      BAASE_AUTH_MODE: "account",
      PRYMEIRA_ACCOUNT_API_URL: "https://hub.prymeiradigital.com.br/api",
      DATABASE_URL: "postgres://baase:baase@localhost:5432/baase",
      BAASE_OPERATIONAL_STORE: "relational",
      OPENAI_API_KEY: "sk-test",
      DEEPGRAM_API_KEY: "dg-test"
    });
    expect(config.objectStorage).toEqual({ provider: "memory", s3: null });
    expect(config.ok).toBe(false);
    expect(config.warnings).toContain(
      "S3_BUCKET, S3_ACCESS_KEY e S3_SECRET_KEY são obrigatórios para arquivos em produção."
    );
  });

  it("reads a path-style S3-compatible configuration for MinIO", () => {
    const config = readRuntimeConfig({
      S3_ENDPOINT: "http://minio:9000",
      S3_REGION: "us-east-1",
      S3_BUCKET: "prymeira-baase",
      S3_ACCESS_KEY: "minio-user",
      S3_SECRET_KEY: "minio-secret",
      S3_FORCE_PATH_STYLE: "true"
    });

    expect(config.objectStorage).toEqual({
      provider: "s3",
      s3: {
        endpoint: "http://minio:9000",
        region: "us-east-1",
        bucket: "prymeira-baase",
        accessKeyId: "minio-user",
        secretAccessKey: "minio-secret",
        forcePathStyle: true,
        multipartCleanupMode: "lifecycle"
      }
    });
  });

  it("reads the native multipart cleanup mode for MinIO", () => {
    const config = readRuntimeConfig({
      S3_BUCKET: "prymeira-baase",
      S3_ACCESS_KEY: "minio-user",
      S3_SECRET_KEY: "minio-secret",
      S3_MULTIPART_CLEANUP_MODE: "minio-native"
    });

    expect(config.objectStorage.s3?.multipartCleanupMode).toBe("minio-native");
    expect(config.warnings).not.toContain(
      "S3_MULTIPART_CLEANUP_MODE deve ser lifecycle ou minio-native."
    );
  });

  it.each(["disabled", ""])("rejects the explicit multipart cleanup mode %j", (value) => {
    const config = readRuntimeConfig({
      S3_BUCKET: "prymeira-baase",
      S3_ACCESS_KEY: "minio-user",
      S3_SECRET_KEY: "minio-secret",
      S3_MULTIPART_CLEANUP_MODE: value
    });

    expect(config.ok).toBe(false);
    expect(config.warnings).toContain(
      "S3_MULTIPART_CLEANUP_MODE deve ser lifecycle ou minio-native."
    );
  });

  it("warns when the Studio is enabled without durable data, real AI, or vector capability", () => {
    const config = readRuntimeConfig({ BAASE_STUDIO_ENABLED: "true" });

    expect(config.ok).toBe(false);
    expect(config.studio).toEqual({ enabled: true, vectorConfigured: false });
    expect(config.warnings).toEqual(expect.arrayContaining([
      "BAASE Studio habilitado requer persistência durável em Postgres.",
      "BAASE Studio habilitado requer um provider real de IA.",
      "BAASE Studio habilitado requer capacidade vetorial configurada."
    ]));
  });

  it("reports Studio readiness when all private intelligence prerequisites are configured", () => {
    const config = readRuntimeConfig({
      BAASE_STUDIO_ENABLED: "true",
      BAASE_STUDIO_VECTOR_ENABLED: "true",
      DATABASE_URL: "postgres://baase:baase@localhost:5432/baase",
      OPENAI_API_KEY: "sk-test"
    });

    expect(config.studio).toEqual({ enabled: true, vectorConfigured: true });
    expect(config.warnings).not.toEqual(expect.arrayContaining([
      expect.stringContaining("Studio habilitado")
    ]));
  });
});
