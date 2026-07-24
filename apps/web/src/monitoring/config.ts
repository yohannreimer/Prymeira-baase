export type WebMonitoringConfig = {
  enabled: boolean;
  dsn: string | null;
  environment: string;
  release: string | null;
  tracesSampleRate: number;
};

type EnvRecord = Record<string, string | undefined>;

export function readWebMonitoringConfig(
  buildEnv: EnvRecord,
  runtimeEnv: EnvRecord = readRuntimeConfig(),
  isProductionBuild = import.meta.env.PROD
): WebMonitoringConfig {
  const env = { ...buildEnv, ...runtimeEnv };
  const dsnValue = normalizeOptional(env.VITE_GLITCHTIP_DSN);
  const dsn = dsnValue && isValidDsn(dsnValue) ? dsnValue : null;
  const release = normalizeOptional(env.VITE_BAASE_RELEASE);
  const environment = normalizeOptional(env.VITE_BAASE_ENVIRONMENT)
    ?? (isProductionBuild ? "production" : "development");
  const sampleValue = normalizeOptional(env.VITE_GLITCHTIP_TRACES_SAMPLE_RATE);
  const tracesSampleRate = sampleValue === null
    ? (isProductionBuild ? 0.01 : 0)
    : Number(sampleValue);
  const validSampleRate = Number.isFinite(tracesSampleRate)
    && tracesSampleRate >= 0
    && tracesSampleRate <= 1;

  return {
    enabled: isProductionBuild && dsn !== null && release !== null && validSampleRate,
    dsn,
    environment,
    release,
    tracesSampleRate: validSampleRate ? tracesSampleRate : 0
  };
}

function readRuntimeConfig(): EnvRecord {
  if (typeof window === "undefined") return {};
  return window.__BAASE_RUNTIME_CONFIG__ ?? {};
}

function normalizeOptional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isValidDsn(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && Boolean(url.username)
      && /^\/\d+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}
