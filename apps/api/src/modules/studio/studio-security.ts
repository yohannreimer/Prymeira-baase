import type { AiTaskKind } from "../ai/ai.types";
import type { StudioOwnerScope } from "./studio.types";

const MAX_EDITOR_JSON_BYTES = 512_000;
const MAX_EDITOR_JSON_DEPTH = 32;
const MAX_EDITOR_JSON_NODES = 20_000;
const MAX_EDITOR_JSON_KEYS = 20_000;
const MAX_EDITOR_OBJECT_KEYS = 500;
const MAX_EDITOR_ARRAY_LENGTH = 2_000;
const MAX_ASSISTANT_CONTEXT_BYTES = 128_000;
const MAX_ASSISTANT_CONTEXT_DEPTH = 24;
const MAX_ASSISTANT_CONTEXT_NODES = 20_000;
const FORBIDDEN_EDITOR_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export type StudioOwnerRequestLimiter = {
  take(scope: StudioOwnerScope): void;
};

export function createStudioOwnerRequestLimiter(options: {
  maxRequests?: number;
  windowMs?: number;
  now?: () => number;
} = {}): StudioOwnerRequestLimiter {
  const maxRequests = boundedInteger(options.maxRequests, 12, 1, 1_000);
  const windowMs = boundedInteger(options.windowMs, 60_000, 1_000, 60 * 60_000);
  const now = options.now ?? Date.now;
  const windows = new Map<string, { startedAt: number; count: number }>();
  return {
    take(scope) {
      const timestamp = now();
      if (!Number.isFinite(timestamp)) throw new Error("STUDIO_SECURITY_CLOCK_INVALID");
      const key = `${scope.workspaceId}\u0000${scope.ownerProfileId}`;
      const current = windows.get(key);
      if (!current || timestamp - current.startedAt >= windowMs || timestamp < current.startedAt) {
        windows.set(key, { startedAt: timestamp, count: 1 });
        pruneExpiredWindows(windows, timestamp, windowMs);
        return;
      }
      if (current.count >= maxRequests) throw new Error("STUDIO_OWNER_RATE_LIMITED");
      current.count += 1;
    }
  };
}

export function assertStudioEditorJson(value: unknown): void {
  assertBoundedJson(value, {
    code: "STUDIO_EDITOR_JSON_INVALID",
    maxBytes: MAX_EDITOR_JSON_BYTES,
    maxDepth: MAX_EDITOR_JSON_DEPTH,
    maxNodes: MAX_EDITOR_JSON_NODES,
    maxKeys: MAX_EDITOR_JSON_KEYS,
    maxObjectKeys: MAX_EDITOR_OBJECT_KEYS,
    maxArrayLength: MAX_EDITOR_ARRAY_LENGTH,
    rejectDangerousKeys: true
  });
}

export function assertStudioAssistantContext(value: unknown): void {
  assertBoundedJson(value, {
    code: "STUDIO_ASSISTANT_CONTEXT_LIMIT",
    maxBytes: MAX_ASSISTANT_CONTEXT_BYTES,
    maxDepth: MAX_ASSISTANT_CONTEXT_DEPTH,
    maxNodes: MAX_ASSISTANT_CONTEXT_NODES,
    maxKeys: MAX_ASSISTANT_CONTEXT_NODES,
    maxObjectKeys: 1_000,
    maxArrayLength: 4_000,
    rejectDangerousKeys: true
  });
}

export function studioAllowedTools(input: {
  agentKey: "owner_studio_companion";
  taskKind: AiTaskKind;
  allowExternalResearch: boolean;
}): readonly "web_search"[] {
  if (!input.allowExternalResearch) return [];
  if (input.agentKey !== "owner_studio_companion" || input.taskKind !== "studio_external_research") {
    throw new Error("STUDIO_TOOL_NOT_ALLOWED");
  }
  return ["web_search"];
}

function assertBoundedJson(root: unknown, limits: {
  code: string;
  maxBytes: number;
  maxDepth: number;
  maxNodes: number;
  maxKeys: number;
  maxObjectKeys: number;
  maxArrayLength: number;
  rejectDangerousKeys: boolean;
}) {
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let nodes = 0;
  let keys = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > limits.maxNodes || current.depth > limits.maxDepth) throw new Error(limits.code);
    const value = current.value;
    if (value === null || typeof value === "string" || typeof value === "boolean") continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error(limits.code);
      continue;
    }
    if (typeof value !== "object" || seen.has(value)) throw new Error(limits.code);
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > limits.maxArrayLength) throw new Error(limits.code);
      for (const entry of value) stack.push({ value: entry, depth: current.depth + 1 });
      continue;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(limits.code);
    const entries = Object.entries(value);
    keys += entries.length;
    if (entries.length > limits.maxObjectKeys || keys > limits.maxKeys) throw new Error(limits.code);
    for (const [key, entry] of entries) {
      if (limits.rejectDangerousKeys && FORBIDDEN_EDITOR_KEYS.has(key)) throw new Error(limits.code);
      stack.push({ value: entry, depth: current.depth + 1 });
    }
  }
  let serialized: string | undefined;
  try { serialized = JSON.stringify(root); }
  catch { throw new Error(limits.code); }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > limits.maxBytes) {
    throw new Error(limits.code);
  }
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < min || candidate > max) throw new Error("STUDIO_SECURITY_LIMIT_INVALID");
  return candidate;
}

function pruneExpiredWindows(
  windows: Map<string, { startedAt: number; count: number }>,
  timestamp: number,
  windowMs: number
) {
  if (windows.size < 10_000) return;
  for (const [key, value] of windows) {
    if (timestamp - value.startedAt >= windowMs) windows.delete(key);
    if (windows.size < 8_000) break;
  }
}
