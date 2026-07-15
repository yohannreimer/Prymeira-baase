import { useEffect, useState } from "react";
import {
  dismissStudioProactiveSignal,
  getStudioProactivitySettings,
  listStudioProactiveSignals,
  snoozeStudioProactiveSignal,
  updateStudioProactivitySettings
} from "./studio-api";
import type { StudioProactivitySettings as Settings, StudioProactiveSignal } from "./studio.types";
import "./studio-proactivity.css";

export type StudioProactivityClient = {
  readSettings(signal?: AbortSignal): Promise<Settings>;
  updateSettings(input: Partial<Settings>): Promise<Settings>;
  listSignals(): Promise<StudioProactiveSignal[]>;
  snoozeSignal(signalId: string, until: string): Promise<StudioProactiveSignal>;
  dismissSignal(signalId: string): Promise<StudioProactiveSignal>;
};

const defaultClient: StudioProactivityClient = {
  readSettings: (signal) => getStudioProactivitySettings(fetch, signal),
  updateSettings: (input) => updateStudioProactivitySettings(input),
  listSignals: () => listStudioProactiveSignals(1),
  snoozeSignal: (signalId, until) => snoozeStudioProactiveSignal(signalId, until),
  dismissSignal: (signalId) => dismissStudioProactiveSignal(signalId)
};

const choices: Array<{
  key: keyof Pick<Settings, "ritualReminder" | "staleGoal" | "recurringTheme" | "decisionReview" | "operationalChange" | "focusedContent">;
  label: string;
  explanation: string;
}> = [
  { key: "ritualReminder", label: "Lembrete de ritual", explanation: "Aparece quando um ritual ativo chega ao horário que você configurou." },
  { key: "staleGoal", label: "Meta sem atualização", explanation: "Aparece quando uma meta escolhida por você passa um período sem novas evidências." },
  { key: "recurringTheme", label: "Tema recorrente", explanation: "Aparece quando um assunto volta em diferentes capturas e pode merecer atenção." },
  { key: "decisionReview", label: "Revisão de decisão", explanation: "Aparece na data de revisão que você escolheu ao registrar a decisão." },
  { key: "operationalChange", label: "Mudança relacionada", explanation: "Aparece quando uma mudança operacional se conecta a uma meta ou plano seu." },
  { key: "focusedContent", label: "Retomar conteúdo em foco", explanation: "Aparece como convite para revisitar algo que você decidiu manter por perto." }
];

export default function StudioProactivitySettings({ client = defaultClient }: { client?: StudioProactivityClient }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [signals, setSignals] = useState<StudioProactiveSignal[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([client.readSettings(controller.signal), client.listSignals()])
      .then(([nextSettings, nextSignals]) => {
        if (controller.signal.aborted) return;
        setSettings(nextSettings);
        setSignals(nextSignals.slice(0, 1));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Não foi possível carregar seus sinais agora.");
      });
    return () => controller.abort();
  }, [client]);

  async function toggle(key: typeof choices[number]["key"]) {
    if (!settings || busy) return;
    setBusy(key);
    setError(null);
    try {
      setSettings(await client.updateSettings({ [key]: !settings[key] }));
    } catch {
      setError("Essa preferência não pôde ser salva. Tente novamente.");
    } finally {
      setBusy(null);
    }
  }

  async function snooze(signal: StudioProactiveSignal) {
    if (busy) return;
    setBusy(signal.id);
    setError(null);
    try {
      const until = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
      await client.snoozeSignal(signal.id, until);
      setSignals([]);
    } catch {
      setError("Não foi possível adiar este sinal agora.");
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(signal: StudioProactiveSignal) {
    if (busy) return;
    setBusy(signal.id);
    setError(null);
    try {
      await client.dismissSignal(signal.id);
      setSignals([]);
    } catch {
      setError("Não foi possível dispensar este sinal agora.");
    } finally {
      setBusy(null);
    }
  }

  if (!settings && error) return null;
  const signal = signals[0];

  return (
    <aside className="studio-proactivity" aria-label="Sinais tranquilos">
      {signal ? (
        <article className="studio-proactivity__signal">
          <span className="studio-proactivity__icon" aria-hidden="true"><i className="ph-light ph-sparkle" /></span>
          <div className="studio-proactivity__signal-copy">
            <p className="mono">Um convite, sem urgência</p>
            <strong>{signal.title}</strong>
            <span>{signal.reason}</span>
          </div>
          <div className="studio-proactivity__signal-actions">
            <button type="button" disabled={busy === signal.id} onClick={() => void snooze(signal)}>Adiar por um dia</button>
            <button type="button" disabled={busy === signal.id} onClick={() => void dismiss(signal)}>Dispensar sinal</button>
          </div>
        </article>
      ) : null}

      {settings ? (
        <div className="studio-proactivity__settings">
          <button
            className="studio-proactivity__disclosure"
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <span><i aria-hidden="true" className="ph-light ph-sliders-horizontal" /> Ajustar sinais</span>
            <i aria-hidden="true" className={`ph-light ${open ? "ph-caret-up" : "ph-caret-down"}`} />
          </button>
          {open ? (
            <div className="studio-proactivity__panel">
              <header><p className="mono">No seu ritmo</p><h3>O Estúdio só chama quando você permitir.</h3><span>Todos os sinais começam desligados. Eles nunca viram tarefas nem criam cobrança.</span></header>
              <div className="studio-proactivity__choices">
                {choices.map((choice) => (
                  <div className="studio-proactivity__choice" key={choice.key}>
                    <label>
                      <span><strong>{choice.label}</strong><small>{choice.explanation}</small></span>
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label={choice.label}
                        checked={settings[choice.key]}
                        disabled={busy !== null}
                        onChange={() => void toggle(choice.key)}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {settings && error ? <p className="studio-proactivity__error" role="alert">{error}</p> : null}
    </aside>
  );
}
