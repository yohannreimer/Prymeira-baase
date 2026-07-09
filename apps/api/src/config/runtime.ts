export type BaaseRuntimeMode = "demo" | "pilot" | "production";
export type BaaseAuthMode = "local" | "account";
export type BaasePersistenceMode = "memory" | "postgres";
export type BaaseStructuredAiProvider = "mock" | "openai";
export type BaaseTranscriptionProvider = "mock" | "deepgram";

export type BaaseRuntimeConfig = {
  mode: BaaseRuntimeMode;
  auth: {
    mode: BaaseAuthMode;
    accountApiUrl: string | null;
  };
  persistence: BaasePersistenceMode;
  demoSeedEnabled: boolean;
  ai: {
    structured: BaaseStructuredAiProvider;
    transcription: BaaseTranscriptionProvider;
  };
  ok: boolean;
  warnings: string[];
};

type RuntimeEnv = Record<string, string | undefined>;

export function readRuntimeConfig(env: RuntimeEnv): BaaseRuntimeConfig {
  const mode = readRuntimeMode(env.BAASE_RUNTIME_MODE);
  const authMode = readAuthMode(env.BAASE_AUTH_MODE, mode);
  const accountApiUrl = normalizeOptionalUrl(env.PRYMEIRA_ACCOUNT_API_URL);
  const persistence: BaasePersistenceMode = env.DATABASE_URL ? "postgres" : "memory";
  const structured: BaaseStructuredAiProvider = env.OPENAI_API_KEY ? "openai" : "mock";
  const transcription: BaaseTranscriptionProvider = env.DEEPGRAM_API_KEY ? "deepgram" : "mock";
  const demoSeedEnabled = env.BAASE_SEED_DEMO_DATA
    ? env.BAASE_SEED_DEMO_DATA !== "false"
    : persistence === "memory";
  const warnings = readRuntimeWarnings({ mode, authMode, accountApiUrl, persistence, structured, transcription });

  return {
    mode,
    auth: {
      mode: authMode,
      accountApiUrl
    },
    persistence,
    demoSeedEnabled,
    ai: {
      structured,
      transcription
    },
    ok: warnings.length === 0,
    warnings
  };
}

function readRuntimeMode(input: string | undefined): BaaseRuntimeMode {
  if (input === "pilot" || input === "production") return input;
  return "demo";
}

function readAuthMode(input: string | undefined, mode: BaaseRuntimeMode): BaaseAuthMode {
  if (input === "local" || input === "account") return input;
  return mode === "production" ? "account" : "local";
}

function normalizeOptionalUrl(input: string | undefined) {
  const value = input?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

function readRuntimeWarnings(input: {
  mode: BaaseRuntimeMode;
  authMode: BaaseAuthMode;
  accountApiUrl: string | null;
  persistence: BaasePersistenceMode;
  structured: BaaseStructuredAiProvider;
  transcription: BaaseTranscriptionProvider;
}) {
  if (input.mode === "demo") return [];

  const warnings: string[] = [];
  if (input.authMode === "account" && !input.accountApiUrl) {
    warnings.push("PRYMEIRA_ACCOUNT_API_URL ausente: auth real precisa validar acesso no Account Hub.");
  }
  if (input.mode === "production" && input.authMode === "local") {
    warnings.push("BAASE_AUTH_MODE=local não pode ser usado em produção.");
  }
  if (input.persistence !== "postgres") {
    warnings.push("DATABASE_URL ausente: o modo piloto precisa persistir dados em Postgres.");
  }
  if (input.structured !== "openai") {
    warnings.push("OPENAI_API_KEY ausente: sugestoes estruturadas vao usar mock.");
  }
  if (input.transcription !== "deepgram") {
    warnings.push("DEEPGRAM_API_KEY ausente: transcricao de audio vai usar mock.");
  }
  return warnings;
}
