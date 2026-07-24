import * as Sentry from "@sentry/node";
import { readApiMonitoringConfig } from "./config";
import {
  initializeApiMonitoringWith,
  type ApiMonitoringOptions
} from "./reporter";

const config = readApiMonitoringConfig(process.env);

export const apiMonitoringEnabled = initializeApiMonitoringWith(config, {
  init(options: ApiMonitoringOptions) {
    const { beforeSend, beforeSendTransaction, ...baseOptions } = options;
    Sentry.init({
      ...baseOptions,
      beforeSend(event) {
        return beforeSend(event as unknown as Record<string, unknown>) as unknown as typeof event;
      },
      beforeSendTransaction(event) {
        return beforeSendTransaction(
          event as unknown as Record<string, unknown>
        ) as unknown as typeof event;
      }
    });
  }
});
