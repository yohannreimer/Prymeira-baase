export type ErrorWithCleanup = Error & { cleanupErrors?: unknown[] };

export function attachCleanupError(primary: unknown, cleanup: unknown) {
  if (primary instanceof Error) {
    const error = primary as ErrorWithCleanup;
    error.cleanupErrors = [...(error.cleanupErrors ?? []), cleanup];
  }
}
