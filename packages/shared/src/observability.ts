export type ObservabilityEvent = Record<string, unknown>;

const topLevelPrimitiveKeys = [
  "event_id",
  "timestamp",
  "platform",
  "level",
  "logger",
  "server_name",
  "release",
  "environment",
  "dist",
  "start_timestamp"
] as const;

const safeTagKeys = ["product", "service", "component", "runtime"] as const;
const safeContextKeys = ["browser", "os", "runtime", "device", "trace"] as const;
const safeContextFieldKeys = new Set([
  "name",
  "version",
  "type",
  "model",
  "arch",
  "op",
  "status",
  "sampled"
]);

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const emailPattern = /^[^/\s@]+@[^/\s@]+\.[^/\s@]+$/;
const opaquePattern = /^[A-Za-z0-9_-]{25,}$/;

export function sanitizeObservabilityEvent(event: ObservabilityEvent): ObservabilityEvent {
  const sanitized: ObservabilityEvent = {};

  for (const key of topLevelPrimitiveKeys) {
    const value = event[key];
    if (isPrimitive(value)) sanitized[key] = sanitizePrimitive(value);
  }

  if (typeof event.message === "string") {
    sanitized.message = sanitizeDiagnosticString(event.message);
  }
  if (typeof event.transaction === "string") {
    sanitized.transaction = normalizeObservabilityPath(event.transaction);
  }

  const request = sanitizeRequest(event.request);
  if (request) sanitized.request = request;

  const contexts = sanitizeContexts(event.contexts);
  if (contexts) sanitized.contexts = contexts;

  const tags = sanitizeTags(event.tags);
  if (tags) sanitized.tags = tags;

  const exception = sanitizeException(event.exception);
  if (exception) sanitized.exception = exception;

  const spans = sanitizeSpans(event.spans);
  if (spans) sanitized.spans = spans;

  return sanitized;
}

export function normalizeObservabilityPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const methodAndUrl = trimmed.match(/^([A-Z]+)\s+(https?:\/\/\S+)$/i);
  const method = methodAndUrl?.[1];
  const absoluteUrl = methodAndUrl?.[2];
  if (method && absoluteUrl) {
    return `${method.toUpperCase()} ${sanitizeUrl(absoluteUrl)}`;
  }
  if (/^https?:\/\//i.test(trimmed)) return sanitizeUrl(trimmed);

  const withoutQuery = trimmed.split(/[?#]/, 1)[0] ?? "";
  return withoutQuery
    .split("/")
    .map((segment) => shouldRedactSegment(segment) ? ":id" : sanitizeDiagnosticString(segment))
    .join("/");
}

function sanitizeRequest(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const request: Record<string, unknown> = {};
  if (typeof value.method === "string") request.method = value.method.slice(0, 16).toUpperCase();
  if (typeof value.url === "string") request.url = sanitizeUrl(value.url);
  return Object.keys(request).length > 0 ? request : null;
}

function sanitizeContexts(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const contexts: Record<string, unknown> = {};
  for (const contextKey of safeContextKeys) {
    const context = value[contextKey];
    if (!isRecord(context)) continue;
    const safeContext: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(context)) {
      if (!safeContextFieldKeys.has(key) || !isPrimitive(field)) continue;
      safeContext[key] = sanitizePrimitive(field);
    }
    if (Object.keys(safeContext).length > 0) contexts[contextKey] = safeContext;
  }
  return Object.keys(contexts).length > 0 ? contexts : null;
}

function sanitizeTags(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const tags: Record<string, unknown> = {};
  for (const key of safeTagKeys) {
    const field = value[key];
    if (isPrimitive(field)) tags[key] = sanitizePrimitive(field);
  }
  return Object.keys(tags).length > 0 ? tags : null;
}

function sanitizeException(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !Array.isArray(value.values)) return null;
  const values = value.values.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const safe: Record<string, unknown> = {};
    if (typeof entry.type === "string") safe.type = sanitizeDiagnosticString(entry.type);
    if (typeof entry.value === "string") safe.value = sanitizeDiagnosticString(entry.value);
    const stacktrace = sanitizeStacktrace(entry.stacktrace);
    if (stacktrace) safe.stacktrace = stacktrace;
    return Object.keys(safe).length > 0 ? [safe] : [];
  });
  return values.length > 0 ? { values } : null;
}

function sanitizeStacktrace(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !Array.isArray(value.frames)) return null;
  const frames = value.frames.flatMap((frame) => {
    if (!isRecord(frame)) return [];
    const safe: Record<string, unknown> = {};
    for (const key of ["filename", "function", "module", "lineno", "colno", "in_app"]) {
      const field = frame[key];
      if (isPrimitive(field)) safe[key] = key === "filename" && typeof field === "string"
        ? sanitizeFileName(field)
        : sanitizePrimitive(field);
    }
    return Object.keys(safe).length > 0 ? [safe] : [];
  });
  return frames.length > 0 ? { frames } : null;
}

function sanitizeSpans(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null;
  const spans = value.flatMap((span) => {
    if (!isRecord(span)) return [];
    const safe: Record<string, unknown> = {};
    for (const key of ["op", "start_timestamp", "timestamp", "status"]) {
      const field = span[key];
      if (isPrimitive(field)) safe[key] = sanitizePrimitive(field);
    }
    if (typeof span.description === "string") {
      safe.description = normalizeObservabilityPath(span.description);
    }
    return Object.keys(safe).length > 0 ? [safe] : [];
  });
  return spans.length > 0 ? spans : null;
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${normalizeObservabilityPath(url.pathname)}`;
  } catch {
    return normalizeObservabilityPath(value);
  }
}

function sanitizeFileName(value: string): string {
  return (value.split(/[?#]/, 1)[0] ?? "").slice(0, 500);
}

function sanitizeDiagnosticString(value: string): string {
  return value
    .replace(/[^\s/@]+@[^\s/@]+\.[^\s/@]+/g, "[redacted]")
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{25,}\b/gi, "[redacted]")
    .slice(0, 500);
}

function shouldRedactSegment(segment: string): boolean {
  if (!segment) return false;
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return true;
  }
  return /^\d+$/.test(decoded)
    || uuidPattern.test(decoded)
    || ulidPattern.test(decoded)
    || emailPattern.test(decoded)
    || opaquePattern.test(decoded);
}

function sanitizePrimitive(value: string | number | boolean | null): string | number | boolean | null {
  return typeof value === "string" ? sanitizeDiagnosticString(value) : value;
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
