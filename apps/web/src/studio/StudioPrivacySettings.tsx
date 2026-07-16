import { useEffect, useRef, useState } from "react";
import { studioRequest } from "./studio-api";

const DELETE_CONFIRMATION = "EXCLUIR MEU ESTÚDIO";

type StudioExportResponse = {
  export: {
    exportId: string;
    status: "pending" | "processing" | "ready" | "failed" | "expired";
    requestedAt: string;
    filename: string;
    sizeBytes: number | null;
    downloadUrl: string | null;
    expiresAt: string;
  };
};

type StudioDeletionResponse = {
  deletion: {
    requestId: string;
    status: "completed" | "reconciliation_pending";
    pendingObjectCount: number;
    cleanupContinues: boolean;
  };
};

export default function StudioPrivacySettings() {
  const [exported, setExported] = useState<StudioExportResponse["export"] | null>(null);
  const [exportState, setExportState] = useState<"idle" | "loading" | "error">("idle");
  const [confirmation, setConfirmation] = useState("");
  const [deleteState, setDeleteState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [pendingObjects, setPendingObjects] = useState(0);
  const [cleanupContinues, setCleanupContinues] = useState(false);
  const exportGenerationRef = useRef(0);
  const exportRequestRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    exportGenerationRef.current += 1;
    exportRequestRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!exported || (exported.status !== "pending" && exported.status !== "processing")) return;
    const controller = new AbortController();
    exportRequestRef.current?.abort();
    exportRequestRef.current = controller;
    const generation = exportGenerationRef.current;
    const exportId = exported.exportId;
    const timer = window.setTimeout(() => {
      void studioRequest<StudioExportResponse>(`/export/${encodeURIComponent(exportId)}`, { signal: controller.signal })
        .then((response) => {
          if (!controller.signal.aborted && generation === exportGenerationRef.current) setExported(response.export);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted && generation === exportGenerationRef.current && !isAbortError(error)) {
            setExported(null);
            setExportState("error");
          }
        });
    }, 1_200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (exportRequestRef.current === controller) exportRequestRef.current = null;
    };
  }, [exported]);

  async function prepareExport() {
    const generation = ++exportGenerationRef.current;
    exportRequestRef.current?.abort();
    const controller = new AbortController();
    exportRequestRef.current = controller;
    setExportState("loading");
    setExported(null);
    try {
      const response = await studioRequest<StudioExportResponse>("/export", { method: "POST", signal: controller.signal });
      if (controller.signal.aborted || generation !== exportGenerationRef.current) return;
      setExported(response.export);
      setExportState("idle");
    } catch (error) {
      if (!controller.signal.aborted && generation === exportGenerationRef.current && !isAbortError(error)) setExportState("error");
    } finally {
      if (exportRequestRef.current === controller) exportRequestRef.current = null;
    }
  }

  async function deleteStudio() {
    if (confirmation !== DELETE_CONFIRMATION) return;
    setDeleteState("loading");
    try {
      const response = await studioRequest<StudioDeletionResponse>("/data", {
        method: "DELETE",
        body: JSON.stringify({ confirmation })
      });
      setPendingObjects(response.deletion.pendingObjectCount);
      setCleanupContinues(response.deletion.cleanupContinues || response.deletion.status === "reconciliation_pending");
      setConfirmation("");
      setDeleteState("done");
    } catch {
      setDeleteState("error");
    }
  }

  return (
    <div className="studio-privacy">
      <header className="studio-content__heading">
        <p className="mono">Seus dados</p>
        <h2 className="serif">Privacidade do Estúdio</h2>
        <p>Você decide como levar consigo ou remover o conteúdo deste espaço privado.</p>
      </header>

      <section className="studio-privacy__section" aria-labelledby="studio-export-title">
        <div className="studio-privacy__copy">
          <span className="studio-privacy__icon"><i aria-hidden="true" className="ph-light ph-download-simple" /></span>
          <div>
            <h3 id="studio-export-title">Levar uma cópia</h3>
            <p>Reúna documentos, versões, estruturas, conversas, referências e arquivos originais em um único arquivo privado.</p>
            <small>Inclui documentos e metadados privados do Estúdio. O link fica disponível por 15 minutos e é criado somente para o seu perfil.</small>
          </div>
        </div>
        <div className="studio-privacy__action">
          <button type="button" onClick={() => void prepareExport()} disabled={exportState === "loading"}>
            {exportState === "loading" ? "Solicitando…" : exported ? "Gerar nova cópia" : "Preparar exportação"}
          </button>
          {exported ? <ExportStatusCard exported={exported} /> : null}
          {exportState === "error" ? <p className="studio-privacy__feedback studio-privacy__feedback--error" role="alert">Não foi possível preparar a cópia agora. Tente novamente.</p> : null}
        </div>
      </section>

      <section className="studio-privacy__section studio-privacy__section--danger" aria-labelledby="studio-delete-title">
        <div className="studio-privacy__copy">
          <span className="studio-privacy__icon"><i aria-hidden="true" className="ph-light ph-trash" /></span>
          <div>
            <h3 id="studio-delete-title">Excluir este espaço privado</h3>
            <p>A exclusão remove definitivamente pensamentos, documentos, versões, conversas, memória da IA e arquivos do Estúdio.</p>
            <small>Ela não apaga tarefas, rotinas, processos ou comunicados já criados na operação. Esses itens permanecem e passam a indicar “origem excluída”.</small>
          </div>
        </div>
        <div className="studio-privacy__danger-form">
          <label htmlFor="studio-delete-confirmation">
            Para continuar, digite <strong>{DELETE_CONFIRMATION}</strong>
          </label>
          <input
            id="studio-delete-confirmation"
            aria-label="Confirmação de exclusão"
            autoComplete="off"
            spellCheck={false}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <button
            type="button"
            disabled={confirmation !== DELETE_CONFIRMATION || deleteState === "loading"}
            onClick={() => void deleteStudio()}
          >
            {deleteState === "loading" ? "Excluindo…" : "Excluir meu Estúdio"}
          </button>
        </div>
        {deleteState === "done" ? (
          <p className="studio-privacy__deletion-status" role="status">
            Seu conteúdo privado foi removido. {cleanupContinues || pendingObjects > 0 ? "A limpeza segura dos arquivos restantes continuará em segundo plano." : "A limpeza foi concluída."}
          </p>
        ) : null}
        {deleteState === "error" ? <p className="studio-privacy__deletion-status studio-privacy__feedback--error" role="alert">Não foi possível confirmar o estado final agora. Atualize a página antes de tentar novamente; uma limpeza já iniciada continuará com segurança.</p> : null}
      </section>
    </div>
  );
}

function ExportStatusCard({ exported }: { exported: StudioExportResponse["export"] }) {
  const copy = exported.status === "pending"
    ? { title: "Sua cópia está na fila", body: "Ela será preparada em segundo plano. Você pode continuar usando o Estúdio." }
    : exported.status === "processing"
      ? { title: "Preparando sua cópia", body: "Estamos reunindo seus documentos, metadados e materiais privados." }
      : exported.status === "ready"
        ? { title: "Sua cópia está pronta", body: "O arquivo foi gerado apenas para o seu perfil." }
        : exported.status === "failed"
          ? { title: "Não conseguimos concluir sua cópia", body: "Nada foi removido. Você pode gerar uma nova cópia quando quiser." }
          : { title: "Esta cópia expirou", body: "O arquivo e o link temporário foram removidos com segurança." };
  const liveRole = exported.status === "failed" ? "alert" : "status";
  return <section
    className={`studio-export-card studio-export-card--${exported.status}`}
    role={liveRole}
    aria-live={exported.status === "failed" ? "assertive" : "polite"}
    aria-busy={exported.status === "pending" || exported.status === "processing"}
  >
    <div className="studio-export-card__state">
      <span aria-hidden="true" className="studio-export-card__mark"><i className={exportIcon(exported.status)} /></span>
      <div><strong>{copy.title}</strong><p>{copy.body}</p></div>
    </div>
    <dl>
      <div><dt>Solicitada</dt><dd>{formatDateTime(exported.requestedAt)}</dd></div>
      <div><dt>Arquivo</dt><dd>{exported.filename}</dd></div>
      {exported.sizeBytes !== null ? <div><dt>Tamanho</dt><dd>{formatBytes(exported.sizeBytes)}</dd></div> : null}
      {exported.status === "ready" ? <div><dt>Expira</dt><dd>{formatDateTime(exported.expiresAt)}</dd></div> : null}
    </dl>
    {exported.status === "ready" && exported.downloadUrl ? <a className="studio-export-card__download" href={exported.downloadUrl} rel="noreferrer">
      <i className="ph-light ph-download-simple" aria-hidden="true" /> Baixar cópia privada
    </a> : null}
  </section>;
}

function exportIcon(status: StudioExportResponse["export"]["status"]): string {
  if (status === "ready") return "ph-light ph-check";
  if (status === "failed") return "ph-light ph-warning-circle";
  if (status === "expired") return "ph-light ph-clock-counter-clockwise";
  return "ph-light ph-circle-notch studio-export-card__spinner";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Horário indisponível";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "Tamanho indisponível";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value / 1024)} KB`;
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value / 1024 ** 2)} MB`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
