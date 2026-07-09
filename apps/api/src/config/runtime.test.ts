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
      demoSeedEnabled: true,
      ai: {
        structured: "mock",
        transcription: "mock"
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
      demoSeedEnabled: false,
      ai: {
        structured: "openai",
        transcription: "deepgram"
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
});
