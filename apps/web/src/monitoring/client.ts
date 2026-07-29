import { sanitizeObservabilityEvent, type ObservabilityEvent } from "@prymeira/baase-shared";
import * as Sentry from "@sentry/react";
import { readWebMonitoringConfig, type WebMonitoringConfig } from "./config";

type MonitoringIntegration = { name: string };

type WebMonitoringOptions = {
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
  sendDefaultPii: false;
  autoSessionTracking: false;
  maxBreadcrumbs: 0;
  transportOptions: { bufferSize: 10 };
  integrations: <T extends MonitoringIntegration>(defaultIntegrations: T[]) => T[];
  beforeSend: (event: ObservabilityEvent) => ObservabilityEvent;
  beforeSendTransaction: (event: ObservabilityEvent) => ObservabilityEvent;
};

type WebMonitoringSdk = {
  init(options: WebMonitoringOptions): unknown;
};

let initialized = false;

export function initializeWebMonitoring(): boolean {
  if (initialized) return true;
  const config = readWebMonitoringConfig(import.meta.env);
  const enabled = initializeWebMonitoringWith(config, {
    init(options) {
      const {
        beforeSend,
        beforeSendTransaction,
        integrations,
        ...baseOptions
      } = options;
      Sentry.init({
        ...baseOptions,
        integrations(defaultIntegrations) {
          return integrations(defaultIntegrations);
        },
        beforeSend(event) {
          return beforeSend(event as unknown as ObservabilityEvent) as unknown as typeof event;
        },
        beforeSendTransaction(event) {
          return beforeSendTransaction(
            event as unknown as ObservabilityEvent
          ) as unknown as typeof event;
        }
      });
    }
  });
  if (enabled) initialized = true;
  return enabled;
}

export function initializeWebMonitoringWith(
  config: WebMonitoringConfig,
  sdk: WebMonitoringSdk
): boolean {
  if (!config.enabled || !config.dsn || !config.release) return false;
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
      integrations: excludeSessionIntegrations,
      beforeSend: sanitizeObservabilityEvent,
      beforeSendTransaction: sanitizeObservabilityEvent
    });
    return true;
  } catch {
    return false;
  }
}

function excludeSessionIntegrations<T extends MonitoringIntegration>(
  defaultIntegrations: T[]
): T[] {
  return defaultIntegrations.filter(
    ({ name }) => name !== "ProcessSession" && name !== "BrowserSession"
  );
}

export { Sentry as WebMonitoring };
