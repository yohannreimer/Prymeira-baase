import { useEffect, useState } from "react";
import { studioRequest } from "./studio-api";

const DELETE_CONFIRMATION = "EXCLUIR MEU ESTÚDIO";

type StudioExportResponse = {
  export: {
    exportId: string;
    status: "pending" | "processing" | "ready" | "failed" | "expired";
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

  useEffect(() => {
    if (!exported || (exported.status !== "pending" && exported.status !== "processing")) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void studioRequest<StudioExportResponse>(`/export/${encodeURIComponent(exported.exportId)}`)
        .then((response) => { if (!cancelled) setExported(response.export); })
        .catch(() => {
          if (!cancelled) {
            setExported(null);
            setExportState("error");
          }
        });
    }, 1_200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [exported]);

  async function prepareExport() {
    setExportState("loading");
    setExported(null);
    try {
      const response = await studioRequest<StudioExportResponse>("/export", { method: "POST" });
      setExported(response.export);
      setExportState("idle");
    } catch {
      setExportState("error");
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
            <small>O link fica disponível por 15 minutos e é criado somente para o seu perfil.</small>
          </div>
        </div>
        <div className="studio-privacy__action">
          <button type="button" onClick={() => void prepareExport()} disabled={exportState === "loading"}>
            {exportState === "loading" ? "Preparando…" : "Preparar exportação"}
          </button>
          {exported?.status === "ready" && exported.downloadUrl ? (
            <p className="studio-privacy__feedback" role="status">
              <a href={exported.downloadUrl} rel="noreferrer">Baixar arquivo privado</a>
              <span>Disponível até {formatTime(exported.expiresAt)}.</span>
            </p>
          ) : null}
          {exported?.status === "pending" || exported?.status === "processing" ? (
            <p className="studio-privacy__feedback" role="status">
              <span>Preparando sua cópia em segundo plano. Você pode continuar usando o Estúdio.</span>
            </p>
          ) : null}
          {exported?.status === "failed" ? <p className="studio-privacy__feedback studio-privacy__feedback--error" role="alert">A cópia não pôde ser concluída. Você pode solicitar outra.</p> : null}
          {exported?.status === "expired" ? <p className="studio-privacy__feedback" role="status">Esta cópia expirou e foi removida com segurança.</p> : null}
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

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "o horário indicado";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}
