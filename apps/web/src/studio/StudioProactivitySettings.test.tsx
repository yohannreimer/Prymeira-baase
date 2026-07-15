import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import StudioProactivitySettings, { type StudioProactivityClient } from "./StudioProactivitySettings";
import type { StudioProactivitySettings as Settings, StudioProactiveSignal } from "./studio.types";

const settings: Settings = {
  ritualReminder: false,
  staleGoal: false,
  recurringTheme: false,
  decisionReview: false,
  operationalChange: false,
  focusedContent: false,
  staleGoalAfterDays: 30,
  updatedAt: "2026-07-14T12:00:00.000Z"
};

const signal: StudioProactiveSignal = {
  id: "signal_a",
  type: "ritual_reminder",
  sourceId: "ritual_a",
  sourceScheduledFor: "2026-07-14T11:00:00.000Z",
  title: "Revisão semanal pronta para você",
  reason: "Este sinal apareceu porque você habilitou lembretes de ritual.",
  status: "active",
  nextReminderAt: "2026-07-14T12:00:00.000Z",
  createdAt: "2026-07-14T12:00:00.000Z",
  updatedAt: "2026-07-14T12:00:00.000Z",
  dismissedAt: null
};

describe("StudioProactivitySettings", () => {
  it("keeps every signal independent and explains why each one may appear", async () => {
    const user = userEvent.setup();
    let current = settings;
    const updateSettings = vi.fn(async (input: Partial<Settings>) => {
      current = { ...current, ...input };
      return current;
    });
    const client = clientFixture({ updateSettings });
    render(<StudioProactivitySettings client={client} />);

    await user.click(await screen.findByRole("button", { name: "Ajustar sinais" }));
    const ritual = screen.getByRole("switch", { name: "Lembrete de ritual" });
    const decision = screen.getByRole("switch", { name: "Revisão de decisão" });
    expect(ritual).not.toBeChecked();
    expect(decision).not.toBeChecked();
    expect(screen.getByText(/aparece quando um ritual ativo chega ao horário/i)).toBeInTheDocument();
    expect(screen.getByText(/aparece na data de revisão que você escolheu/i)).toBeInTheDocument();

    await user.click(ritual);
    expect(updateSettings).toHaveBeenCalledWith({ ritualReminder: true });
    expect(ritual).toBeChecked();
    expect(decision).not.toBeChecked();
  });

  it("renders at most one quiet signal and always lets the owner snooze or dismiss it", async () => {
    const user = userEvent.setup();
    const snoozeSignal = vi.fn(async () => ({ ...signal, nextReminderAt: "2026-07-15T12:00:00.000Z" }));
    const dismissSignal = vi.fn(async () => ({ ...signal, status: "dismissed" as const }));
    const client = clientFixture({ listSignals: async () => [signal, { ...signal, id: "signal_b" }], snoozeSignal, dismissSignal });
    render(<StudioProactivitySettings client={client} />);

    expect(await screen.findByText("Revisão semanal pronta para você")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText(signal.reason)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Adiar por um dia" }));
    expect(snoozeSignal).toHaveBeenCalledWith("signal_a", expect.any(String));
    expect(screen.queryByText(signal.title)).not.toBeInTheDocument();

    const secondClient = clientFixture({ listSignals: async () => [signal], dismissSignal });
    render(<StudioProactivitySettings client={secondClient} />);
    await user.click(await screen.findByRole("button", { name: "Dispensar sinal" }));
    expect(dismissSignal).toHaveBeenCalledWith("signal_a");
  });
});

function clientFixture(overrides: Partial<StudioProactivityClient> = {}): StudioProactivityClient {
  return {
    readSettings: async () => settings,
    updateSettings: async (input) => ({ ...settings, ...input }),
    listSignals: async () => [],
    snoozeSignal: async () => signal,
    dismissSignal: async () => signal,
    ...overrides
  };
}
