export type ApiMonitoringConfig = {
  enabled: boolean;
  dsn: string | null;
  environment: string;
  release: string | null;
  tracesSampleRate: number;
};

type MonitoringEnvironment = Record<string, string | undefined>;

export function readApiMonitoringConfig(
  env: MonitoringEnvironment
): ApiMonitoringConfig {
  const dsn = trimToNull(env.SENTRY_DSN);
  const environment = trimToNull(env.SENTRY_ENVIRONMENT) ?? "production";
  const release = trimToNull(env.SENTRY_RELEASE);
  const sample = readSampleRate(env.SENTRY_TRACES_SAMPLE_RATE);
  const enabled = env.NODE_ENV?.trim() === "production"
    && isValidDsn(dsn)
    && release !== null
    && sample.valid;

  return {
    enabled,
    dsn,
    environment,
    release,
    tracesSampleRate: sample.value
  };
}

function readSampleRate(value: string | undefined): {
  valid: boolean;
  value: number;
} {
  if (value === undefined) return { valid: true, value: 0.01 };
  if (value.trim() === "") return { valid: false, value: 0 };
  const parsed = Number(value);
  return {
    valid: Number.isFinite(parsed) && parsed >= 0 && parsed <= 1,
    value: Number.isFinite(parsed) ? parsed : 0
  };
}

function isValidDsn(value: string | null): value is string {
  if (!value) return false;
  try {
    const dsn = new URL(value);
    const projectParts = dsn.pathname.split("/").filter(Boolean);
    return dsn.protocol === "https:"
      && dsn.username.length > 0
      && projectParts.length === 1
      && /^\d+$/.test(projectParts[0] ?? "");
  } catch {
    return false;
  }
}

function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
