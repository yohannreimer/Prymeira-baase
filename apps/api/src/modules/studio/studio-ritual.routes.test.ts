import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app";
import { createMockAiProvider } from "../ai/providers/mock-ai.provider";
import { registerStudioRoutes } from "./studio.routes";
import type { StudioService } from "./studio.types";
import type { StudioRitualService } from "./studio-ritual.service";

const owner = {
  "x-baase-workspace-id": "workspace_a", "x-baase-role": "owner", "x-baase-profile-id": "owner_a"
};
const now = "2026-07-13T12:00:00.000Z";

async function setup() {
  let ritualId = "";
  const provider = createMockAiProvider({ structuredOutput: {
    facts: [], inferences: [], gaps: [], citations: [],
    proposal: {
      get ritual_id() { return ritualId; }, title: "Revisão", intent: "Refletir",
      agenda: [{ prompt: "O que mudou?", purpose: "Entender" }], preparation_notes: [], suggested_duration_minutes: 20
    }
  } });
  const app = buildApp({ aiProvider: provider, now: () => new Date("2026-07-13T12:00:00.000Z") });
  const document = (await app.inject({ method: "POST", url: "/studio/documents", headers: owner,
    payload: { title: "Ritual", body_json: {}, body_text: "Revisão", capture_mode: "text" } })).json().document;
  const ritual = (await app.inject({ method: "POST", url: `/studio/documents/${document.id}/structures`, headers: owner,
    payload: { kind: "ritual", properties_json: { intention: "Refletir", guide_questions: ["O que mudou?"] } } })).json().structure;
  ritualId = ritual.id;
  return { app, ritual };
}

describe("Studio ritual routes", () => {
  it("starts, lists, partially answers, and finishes a ritual session", async () => {
    const { app, ritual } = await setup();
    const started = await app.inject({ method: "POST", url: `/studio/rituals/${ritual.id}/sessions`, headers: owner });
    expect(started.statusCode).toBe(201);
    expect(started.json().session.status).toBe("ready");
    const session = started.json().session;
    const partial = await app.inject({ method: "PATCH", url: `/studio/ritual-sessions/${session.id}`, headers: owner,
      payload: { expected_revision: session.revision, answers: { "O que mudou?": "Crescemos." } } });
    expect(partial.statusCode).toBe(200);
    expect(partial.json().session.status).toBe("in_progress");
    const finished = await app.inject({ method: "POST", url: `/studio/ritual-sessions/${session.id}/finish`, headers: owner,
      payload: { expected_revision: partial.json().session.revision, answers: {}, request_synthesis: false } });
    expect(finished.statusCode).toBe(200);
    expect(finished.json().session.status).toBe("completed");
    const listed = await app.inject({ method: "GET", url: `/studio/rituals/${ritual.id}/sessions?limit=10`, headers: owner });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().sessions).toHaveLength(1);
  });

  it("returns private not-found responses and rejects non-owner access", async () => {
    const { app, ritual } = await setup();
    const otherOwner = { ...owner, "x-baase-profile-id": "owner_b" };
    expect((await app.inject({ method: "POST", url: `/studio/rituals/${ritual.id}/sessions`, headers: otherOwner })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/studio/rituals/${ritual.id}/sessions`, headers: { ...owner, "x-baase-role": "manager" } })).statusCode).toBe(403);
  });

  it("creates a request-owned AbortSignal for preparation and synthesis routes", async () => {
    const app = Fastify();
    const session = {
      id: "session_a", ritualId: "ritual_a", workspaceId: "workspace_a", ownerProfileId: "owner_a",
      status: "completed", revision: 1, contextJson: null, preparationJson: null, answersJson: {},
      synthesisJson: null, prepareAiRunId: null, synthesisAiRunId: null,
      preparationToken: null, preparationLeaseExpiresAt: null,
      synthesisToken: null, synthesisLeaseExpiresAt: null, synthesisFailureCode: null,
      failureCode: null, createdAt: now, updatedAt: now, completedAt: now
    } as const;
    const startSession = vi.fn(async (_scope, _ritualId, input) => {
      expect(input?.signal).toBeInstanceOf(AbortSignal);
      return session as never;
    });
    const finishSession = vi.fn(async (_scope, _sessionId, input) => {
      expect(input.signal).toBeInstanceOf(AbortSignal);
      return session as never;
    });
    await registerStudioRoutes(app, {} as StudioService, undefined, {
      startSession, finishSession,
      listSessions: vi.fn(), updateSession: vi.fn()
    } as unknown as StudioRitualService);
    expect((await app.inject({ method: "POST", url: "/studio/rituals/ritual_a/sessions", headers: owner })).statusCode).toBe(201);
    expect((await app.inject({
      method: "POST", url: "/studio/ritual-sessions/session_a/finish", headers: owner,
      payload: { expected_revision: 1, answers: {}, request_synthesis: true }
    })).statusCode).toBe(200);
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(finishSession).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
