import {
  normalizeObservabilityPath,
  sanitizeObservabilityEvent,
  type ObservabilityEvent
} from "@prymeira/baase-shared";
import * as Sentry from "@sentry/node";
import type { ApiMonitoringConfig } from "./config";

export type UnexpectedErrorContext = {
  component: "http" | "startup" | "shutdown" | "maintenance";
  method?: string;
  route?: string;
  operation?: string;
};

type MonitoringTags = Record<string, string>;
type CaptureContext = { tags: MonitoringTags };

export type ApiMonitoringOptions = {
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
  sendDefaultPii: false;
  autoSessionTracking: false;
  maxBreadcrumbs: 0;
  transportOptions: { bufferSize: 10 };
  registerEsmLoaderHooks: true;
  beforeSend: (event: ObservabilityEvent) => ObservabilityEvent;
  beforeSendTransaction: (event: ObservabilityEvent) => ObservabilityEvent;
};

type ApiMonitoringSdk = {
  init?: (options: ApiMonitoringOptions) => unknown;
  captureException?: (error: unknown, context: CaptureContext) => unknown;
  flush?: (timeoutMs: number) => Promise<boolean> | boolean;
};

export function initializeApiMonitoringWith(
  config: ApiMonitoringConfig,
  sdk: ApiMonitoringSdk
): boolean {
  if (!config.enabled || !config.dsn || !config.release || !sdk.init) return false;
  try {
    sdk.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
      tracesSampleRate: config.tracesSampleRate,
      sendDefaultPii: false,
      autoSessionTracking: false,
      maxBreadcrumbs: 0,
      transportOptions: { bufferSize: 10 },
      registerEsmLoaderHooks: true,
      beforeSend: sanitizeObservabilityEvent,
      beforeSendTransaction: sanitizeObservabilityEvent
    });
    return true;
  } catch {
    return false;
  }
}

export function captureUnexpectedError(
  error: unknown,
  context: UnexpectedErrorContext
): void {
  captureUnexpectedErrorWith({
    captureException(capturedError, captureContext) {
      Sentry.captureException(capturedError, captureContext);
    }
  }, error, context);
}

export function captureUnexpectedErrorWith(
  sdk: ApiMonitoringSdk,
  error: unknown,
  context: UnexpectedErrorContext
): void {
  if (!sdk.captureException) return;
  const tags: MonitoringTags = { component: context.component };
  const method = sanitizeMethod(context.method);
  const route = sanitizeRoute(context.route);
  const operation = sanitizeOperation(context.operation);
  if (method) tags.method = method;
  if (route) tags.route = route;
  if (operation) tags.operation = operation;

  try {
    sdk.captureException(error, { tags });
  } catch {
    // Monitoring must never change application behavior.
  }
}

export function flushMonitoring(timeoutMs = 2000): Promise<boolean> {
  return flushMonitoringWith({ flush: Sentry.flush }, timeoutMs);
}

export async function flushMonitoringWith(
  sdk: ApiMonitoringSdk,
  timeoutMs = 2000
): Promise<boolean> {
  if (!sdk.flush) return false;
  const boundedTimeout = Math.min(Math.max(Number.isFinite(timeoutMs) ? timeoutMs : 2000, 0), 2000);
  try {
    return await sdk.flush(boundedTimeout);
  } catch {
    return false;
  }
}

function sanitizeMethod(value: string | undefined): string | null {
  const method = value?.trim().toUpperCase();
  return method && /^[A-Z]{1,16}$/.test(method) ? method : null;
}

function sanitizeRoute(value: string | undefined): string | null {
  if (!value) return null;
  const route = normalizeObservabilityPath(value);
  return route ? route.slice(0, 200) : null;
}

function sanitizeOperation(value: string | undefined): string | null {
  const operation = value?.trim().toLowerCase();
  return operation && /^[a-z0-9._-]{1,80}$/.test(operation) ? operation : null;
}
