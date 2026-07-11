export type BaaseRuntimeMode = "demo" | "pilot" | "production";
export type BaaseAuthMode = "local" | "account";
export type BaasePersistenceMode = "memory" | "postgres";
export type BaaseOperationalStore = "jsonb" | "relational";
export type BaaseStructuredAiProvider = "mock" | "openai";
export type BaaseTranscriptionProvider = "mock" | "deepgram";

export type BaaseS3Config = {
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

export type BaaseRuntimeConfig = {
  mode: BaaseRuntimeMode;
  auth: {
    mode: BaaseAuthMode;
    accountApiUrl: string | null;
  };
  persistence: BaasePersistenceMode;
  operationalStore: BaaseOperationalStore;
  demoSeedEnabled: boolean;
  ai: {
    structured: BaaseStructuredAiProvider;
    transcription: BaaseTranscriptionProvider;
  };
  objectStorage: {
    provider: "memory" | "s3";
    s3: BaaseS3Config | null;
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
  const operationalStore = readOperationalStore(env.BAASE_OPERATIONAL_STORE);
  const structured: BaaseStructuredAiProvider = env.OPENAI_API_KEY ? "openai" : "mock";
  const transcription: BaaseTranscriptionProvider = env.DEEPGRAM_API_KEY ? "deepgram" : "mock";
  const s3 = readS3Config(env);
  const demoSeedEnabled = env.BAASE_SEED_DEMO_DATA
    ? env.BAASE_SEED_DEMO_DATA !== "false"
    : persistence === "memory";
  const warnings = readRuntimeWarnings({
    mode, authMode, accountApiUrl, persistence, operationalStoreInput: env.BAASE_OPERATIONAL_STORE,
    structured, transcription, s3Configured: Boolean(s3)
  });

  return {
    mode,
    auth: {
      mode: authMode,
      accountApiUrl
    },
    persistence,
    operationalStore,
    demoSeedEnabled,
    ai: {
      structured,
      transcription
    },
    objectStorage: {
      provider: s3 ? "s3" : "memory",
      s3
    },
    ok: warnings.length === 0,
    warnings
  };
}

function readS3Config(env: RuntimeEnv): BaaseS3Config | null {
  const bucket = env.S3_BUCKET?.trim();
  const accessKeyId = (env.S3_ACCESS_KEY_ID ?? env.S3_ACCESS_KEY)?.trim();
  const secretAccessKey = (env.S3_SECRET_ACCESS_KEY ?? env.S3_SECRET_KEY)?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint: normalizeOptionalUrl(env.S3_ENDPOINT) ?? undefined,
    region: env.S3_REGION?.trim() || "us-east-1",
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true"
  };
}

function readOperationalStore(input: string | undefined): BaaseOperationalStore {
  return input === "relational" ? "relational" : "jsonb";
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
  operationalStoreInput: string | undefined;
  structured: BaaseStructuredAiProvider;
  transcription: BaaseTranscriptionProvider;
  s3Configured: boolean;
}) {
  const warnings: string[] = [];
  if (input.operationalStoreInput === "relational" && input.persistence !== "postgres") {
    warnings.push("BAASE_OPERATIONAL_STORE=relational requer DATABASE_URL.");
  }
  if (input.mode === "demo") return warnings;
  if (input.authMode === "account" && !input.accountApiUrl) {
    warnings.push("PRYMEIRA_ACCOUNT_API_URL ausente: auth real precisa validar acesso no Account Hub.");
  }
  if (input.mode === "production" && input.authMode === "local") {
    warnings.push("BAASE_AUTH_MODE=local não pode ser usado em produção.");
  }
  if (input.mode === "production" && !input.s3Configured) {
    warnings.push("S3_BUCKET, S3_ACCESS_KEY e S3_SECRET_KEY são obrigatórios para arquivos em produção.");
  }
  if (input.mode === "production"
    && input.operationalStoreInput !== "jsonb"
    && input.operationalStoreInput !== "relational") {
    warnings.push("BAASE_OPERATIONAL_STORE deve ser definido como jsonb ou relational em produção.");
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
