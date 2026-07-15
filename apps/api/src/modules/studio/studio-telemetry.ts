import { channel } from "node:diagnostics_channel";
import type { AiTaskKind } from "../ai/ai.types";
import type { StudioAssetKind, StudioCaptureMode, StudioStructureKind } from "./studio.types";

export type StudioTelemetryEvent =
  | {
      name: "studio_capture_created";
      workspaceId: string;
      ownerProfileId: string;
      documentId: string;
      mode: StudioCaptureMode;
      assetCount: number;
    }
  | {
      name: "studio_asset_received";
      workspaceId: string;
      ownerProfileId: string;
      documentId: string;
      assetId: string;
      modality: StudioAssetKind;
      sizeBytes: number;
      status: "accepted" | "replayed";
    }
  | {
      name: "studio_ai_run_finished";
      workspaceId: string;
      ownerProfileId: string;
      aiRunId: string;
      taskKind: AiTaskKind;
      status: "completed" | "failed" | "cancelled";
      latencyMs: number;
      citationCount: number;
      model: string;
    }
  | {
      name: "studio_suggestion_decided";
      workspaceId: string;
      ownerProfileId: string;
      suggestionId: string;
      kind: StudioStructureKind | "text" | "operation";
      decision: "accepted" | "dismissed";
    };

export type StudioTelemetrySink = (event: StudioTelemetryEvent) => void;

const studioTelemetryChannel = channel("baase.studio.telemetry");

const publishRawStudioTelemetry: StudioTelemetrySink = (event) => {
  studioTelemetryChannel.publish(event);
};

/**
 * Projects every event onto a closed schema before it reaches an observer.
 * Unknown keys are dropped even when an untyped caller crosses the boundary.
 */
export function safeStudioTelemetrySink(
  sink: StudioTelemetrySink = publishRawStudioTelemetry
): StudioTelemetrySink {
  return (event) => {
    try {
      sink(redactStudioSensitiveFields(projectStudioTelemetryEvent(event)) as StudioTelemetryEvent);
    } catch {
      // Observability is best effort and must never break private product flows.
    }
  };
}

export const publishStudioTelemetry = safeStudioTelemetrySink(publishRawStudioTelemetry);

export function redactStudioSensitiveFields(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>(), 0);
}

function projectStudioTelemetryEvent(raw: StudioTelemetryEvent): StudioTelemetryEvent {
  switch (raw.name) {
    case "studio_capture_created":
      return {
        name: raw.name,
        workspaceId: requiredString(raw.workspaceId),
        ownerProfileId: requiredString(raw.ownerProfileId),
        documentId: requiredString(raw.documentId),
        mode: raw.mode,
        assetCount: safeCount(raw.assetCount)
      };
    case "studio_asset_received":
      return {
        name: raw.name,
        workspaceId: requiredString(raw.workspaceId),
        ownerProfileId: requiredString(raw.ownerProfileId),
        documentId: requiredString(raw.documentId),
        assetId: requiredString(raw.assetId),
        modality: raw.modality,
        sizeBytes: safeCount(raw.sizeBytes),
        status: raw.status
      };
    case "studio_ai_run_finished":
      return {
        name: raw.name,
        workspaceId: requiredString(raw.workspaceId),
        ownerProfileId: requiredString(raw.ownerProfileId),
        aiRunId: requiredString(raw.aiRunId),
        taskKind: raw.taskKind,
        status: raw.status,
        latencyMs: safeCount(raw.latencyMs),
        citationCount: safeCount(raw.citationCount),
        model: requiredString(raw.model)
      };
    case "studio_suggestion_decided":
      return {
        name: raw.name,
        workspaceId: requiredString(raw.workspaceId),
        ownerProfileId: requiredString(raw.ownerProfileId),
        suggestionId: requiredString(raw.suggestionId),
        kind: raw.kind,
        decision: raw.decision
      };
  }
}

function requiredString(value: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 240) {
    throw new Error("STUDIO_TELEMETRY_EVENT_INVALID");
  }
  return value;
}

function safeCount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("STUDIO_TELEMETRY_EVENT_INVALID");
  return value;
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > 12) return "[REDACTED]";
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value !== "object") return "[REDACTED]";
  if (seen.has(value)) return "[REDACTED]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 500).map((entry) => redactValue(entry, seen, depth + 1));
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 500)) {
    output[key] = isSensitiveKey(key) ? "[REDACTED]" : redactValue(entry, seen, depth + 1);
  }
  return output;
}

function isSensitiveKey(key: string) {
  const normalized = key.replace(/[^a-z]/giu, "").toLowerCase();
  return normalized === "body"
    || normalized === "bodyjson"
    || normalized === "bodytext"
    || normalized === "transcript"
    || normalized === "prompt"
    || normalized === "extractedtext"
    || normalized === "message"
    || normalized === "messagecontent"
    || normalized === "content"
    || normalized === "selectedtextcontext"
    || normalized === "input"
    || normalized === "output";
}
