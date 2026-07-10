import { createHash } from "node:crypto";

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | {
  [key: string]: CanonicalValue;
};

function canonicalize(value: unknown): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Deterministic ID input must contain finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  throw new Error(`Unsupported deterministic ID input type: ${typeof value}`);
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function deterministicBackfillId(prefix: string, identity: Record<string, unknown>) {
  const digest = createHash("sha256")
    .update(canonicalJson({ prefix, identity }))
    .digest("hex")
    .slice(0, 32);
  return `${prefix}_${digest}`;
}
