import { describe, expect, it, vi } from "vitest";
import {
  STUDIO_PROACTIVITY_DEFAULT_SETTINGS,
  createInMemoryStudioProactivityStore,
  createStudioProactivityService
} from "./studio-proactivity.service";

const now = new Date("2026-07-14T12:00:00.000Z");
const ownerA = { workspaceId: "workspace_a", ownerProfileId: "owner_a" };
const ownerB = { workspaceId: "workspace_a", ownerProfileId: "owner_b" };

describe("Studio proactivity service", () => {
  it("starts every signal disabled and updates each private toggle independently", async () => {
    const store = createInMemoryStudioProactivityStore({ now: () => now.toISOString() });
    const service = createStudioProactivityService({
      store,
      ritualService: { startSession: vi.fn() },
      now: () => now
    });

    await expect(service.readSettings(ownerA)).resolves.toMatchObject(STUDIO_PROACTIVITY_DEFAULT_SETTINGS);
    const updated = await service.updateSettings(ownerA, {
      ritualReminder: true,
      decisionReview: true
    });

    expect(updated).toMatchObject({
      ritualReminder: true,
      staleGoal: false,
      recurringTheme: false,
      decisionReview: true,
      operationalChange: false,
      focusedContent: false
    });
    await expect(service.readSettings(ownerB)).resolves.toMatchObject(STUDIO_PROACTIVITY_DEFAULT_SETTINGS);
  });

  it("prepares only due enabled rituals and a rerun does not duplicate sessions or signals", async () => {
    const store = createInMemoryStudioProactivityStore({
      now: () => now.toISOString(),
      dueRituals: [
        { ...ownerA, ritualId: "ritual_due", title: "Revisão semanal", scheduledFor: "2026-07-14T11:00:00.000Z" },
        { ...ownerA, ritualId: "ritual_future", title: "Revisão futura", scheduledFor: "2026-07-14T13:00:00.000Z" },
        { ...ownerB, ritualId: "ritual_disabled", title: "Outro dono", scheduledFor: "2026-07-14T10:00:00.000Z" }
      ]
    });
    const startSession = vi.fn(async (_scope: typeof ownerA, _ritualId: string) => ({ status: "ready" as const }));
    const service = createStudioProactivityService({ store, ritualService: { startSession }, now: () => now });
    await service.updateSettings(ownerA, { ritualReminder: true });

    await expect(service.runDuePreparations(now, 10)).resolves.toEqual({ claimed: 1, prepared: 1, failed: 0 });
    await expect(service.runDuePreparations(now, 10)).resolves.toEqual({ claimed: 0, prepared: 0, failed: 0 });

    expect(startSession).toHaveBeenCalledTimes(1);
    expect(startSession).toHaveBeenCalledWith(ownerA, "ritual_due");
    await expect(service.listSignals(ownerA, 10)).resolves.toEqual([
      expect.objectContaining({
        type: "ritual_reminder",
        sourceId: "ritual_due",
        title: "Revisão semanal pronta para você",
        reason: expect.stringContaining("lembretes de ritual"),
        status: "active"
      })
    ]);
    await expect(service.listSignals(ownerB, 10)).resolves.toEqual([]);
  });

  it("continues with the next owner when one preparation fails and retries after backoff", async () => {
    let current = new Date(now);
    const store = createInMemoryStudioProactivityStore({
      now: () => current.toISOString(),
      dueRituals: [
        { ...ownerA, ritualId: "ritual_broken", title: "Ritual A", scheduledFor: "2026-07-14T10:00:00.000Z" },
        { ...ownerB, ritualId: "ritual_ready", title: "Ritual B", scheduledFor: "2026-07-14T10:30:00.000Z" }
      ]
    });
    const startSession = vi.fn(async (_scope, ritualId: string) => {
      if (ritualId === "ritual_broken") throw new Error("provider unavailable");
      return { status: "ready" as const };
    });
    const service = createStudioProactivityService({ store, ritualService: { startSession }, now: () => current });
    await service.updateSettings(ownerA, { ritualReminder: true });
    await service.updateSettings(ownerB, { ritualReminder: true });

    await expect(service.runDuePreparations(current, 10)).resolves.toEqual({ claimed: 2, prepared: 1, failed: 1 });
    await expect(service.listSignals(ownerA, 10)).resolves.toEqual([]);
    await expect(service.listSignals(ownerB, 10)).resolves.toHaveLength(1);

    current = new Date("2026-07-14T12:01:00.000Z");
    await expect(service.runDuePreparations(current, 10)).resolves.toEqual({ claimed: 0, prepared: 0, failed: 0 });
    current = new Date("2026-07-14T12:06:00.000Z");
    await expect(service.runDuePreparations(current, 10)).resolves.toEqual({ claimed: 1, prepared: 0, failed: 1 });
  });

  it("gives each owner one ritual claim before consuming another owner's backlog", async () => {
    const store = createInMemoryStudioProactivityStore({
      now: () => now.toISOString(),
      dueRituals: [
        { ...ownerA, ritualId: "ritual_a1", title: "A1", scheduledFor: "2026-07-14T09:00:00.000Z" },
        { ...ownerA, ritualId: "ritual_a2", title: "A2", scheduledFor: "2026-07-14T09:01:00.000Z" },
        { ...ownerB, ritualId: "ritual_b1", title: "B1", scheduledFor: "2026-07-14T10:00:00.000Z" }
      ]
    });
    const startSession = vi.fn(async (_scope: typeof ownerA, _ritualId: string) => ({ status: "ready" as const }));
    const service = createStudioProactivityService({ store, ritualService: { startSession }, now: () => now });
    await service.updateSettings(ownerA, { ritualReminder: true });
    await service.updateSettings(ownerB, { ritualReminder: true });

    await expect(service.runDuePreparations(now, 2)).resolves.toEqual({ claimed: 2, prepared: 2, failed: 0 });
    expect(startSession.mock.calls.map(([scope]) => scope.ownerProfileId)).toEqual(["owner_a", "owner_b"]);
  });

  it("immediately invalidates active work and never reclaims failed work after its signal is disabled", async () => {
    let current = new Date(now);
    const store = createInMemoryStudioProactivityStore({
      now: () => current.toISOString(),
      dueRituals: [
        { ...ownerA, ritualId: "ritual_active", title: "Ativo", scheduledFor: "2026-07-14T10:00:00.000Z" },
        { ...ownerA, ritualId: "ritual_failed", title: "Falho", scheduledFor: "2026-07-14T10:01:00.000Z" }
      ]
    });
    const startSession = vi.fn(async (_scope, ritualId: string) => {
      if (ritualId === "ritual_failed") throw new Error("provider unavailable");
      return { status: "ready" as const };
    });
    const service = createStudioProactivityService({ store, ritualService: { startSession }, now: () => current });
    await service.updateSettings(ownerA, { ritualReminder: true });
    await service.runDuePreparations(current, 2);
    await service.runDuePreparations(current, 2);
    await expect(service.listSignals(ownerA, 10)).resolves.toHaveLength(1);

    await service.updateSettings(ownerA, { ritualReminder: false });
    await expect(service.listSignals(ownerA, 10)).resolves.toEqual([]);
    current = new Date("2026-07-14T13:00:00.000Z");
    await expect(service.runDuePreparations(current, 10)).resolves.toEqual({ claimed: 0, prepared: 0, failed: 0 });
    expect(startSession).toHaveBeenCalledTimes(2);
  });

  it("cannot publish a preparation that finishes after ritual reminders are disabled", async () => {
    let release!: () => void;
    const preparation = new Promise<void>((resolve) => { release = resolve; });
    const store = createInMemoryStudioProactivityStore({
      now: () => now.toISOString(),
      dueRituals: [
        { ...ownerA, ritualId: "ritual_in_flight", title: "Em preparo", scheduledFor: "2026-07-14T10:00:00.000Z" }
      ]
    });
    const startSession = vi.fn(async () => {
      await preparation;
      return { status: "ready" as const };
    });
    const service = createStudioProactivityService({ store, ritualService: { startSession }, now: () => now });
    await service.updateSettings(ownerA, { ritualReminder: true });

    const running = service.runDuePreparations(now, 1);
    await vi.waitFor(() => expect(startSession).toHaveBeenCalledTimes(1));
    await service.updateSettings(ownerA, { ritualReminder: false });
    release();

    await expect(running).resolves.toEqual({ claimed: 1, prepared: 0, failed: 0 });
    await expect(service.listSignals(ownerA, 10)).resolves.toEqual([]);
  });

  it("snoozes and dismisses only the owner's signal without changing ritual cadence", async () => {
    const dueRitual = {
      ...ownerA,
      ritualId: "ritual_due",
      title: "Revisão semanal",
      scheduledFor: "2026-07-14T11:00:00.000Z"
    };
    const store = createInMemoryStudioProactivityStore({
      now: () => now.toISOString(),
      dueRituals: [dueRitual]
    });
    const service = createStudioProactivityService({
      store,
      ritualService: { startSession: vi.fn(async () => ({ status: "ready" as const })) },
      now: () => now
    });
    await service.updateSettings(ownerA, { ritualReminder: true });
    await service.runDuePreparations(now, 10);
    const [signal] = await service.listSignals(ownerA, 10);

    await expect(service.snoozeSignal(ownerB, signal!.id, "2026-07-15T12:00:00.000Z"))
      .rejects.toThrow("STUDIO_PROACTIVE_SIGNAL_NOT_FOUND");
    const snoozed = await service.snoozeSignal(ownerA, signal!.id, "2026-07-15T12:00:00.000Z");
    expect(snoozed.nextReminderAt).toBe("2026-07-15T12:00:00.000Z");
    await expect(service.listSignals(ownerA, 10)).resolves.toEqual([]);
    expect(store.getDueRituals()).toEqual([dueRitual]);

    const dismissed = await service.dismissSignal(ownerA, signal!.id);
    expect(dismissed.status).toBe("dismissed");
    await expect(service.listSignals(ownerA, 10, new Date("2026-07-16T12:00:00.000Z"))).resolves.toEqual([]);
  });
});
