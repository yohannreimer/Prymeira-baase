import type { ReactNode } from "react";
import { WebMonitoring } from "./client";

type MonitoringFallbackProps = {
  onReload?: () => void;
};

export function MonitoringFallback({
  onReload = () => window.location.reload()
}: MonitoringFallbackProps) {
  return (
    <main
      role="alert"
      style={{
        alignItems: "center",
        background: "#f6f7f5",
        color: "#17211a",
        display: "flex",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "24px"
      }}
    >
      <section
        style={{
          background: "#ffffff",
          border: "1px solid #dfe5df",
          borderRadius: "16px",
          boxShadow: "0 18px 50px rgba(23, 33, 26, 0.08)",
          maxWidth: "480px",
          padding: "32px",
          width: "100%"
        }}
      >
        <h1 style={{ fontSize: "24px", lineHeight: 1.2, margin: "0 0 12px" }}>
          Não foi possível exibir esta tela.
        </h1>
        <p style={{ color: "#536058", lineHeight: 1.6, margin: "0 0 24px" }}>
          Recarregue a página. Se o problema continuar, tente novamente em alguns minutos.
        </p>
        <button
          type="button"
          onClick={onReload}
          style={{
            background: "#17211a",
            border: 0,
            borderRadius: "10px",
            color: "#ffffff",
            cursor: "pointer",
            font: "inherit",
            fontWeight: 600,
            padding: "12px 18px"
          }}
        >
          Recarregar página
        </button>
      </section>
    </main>
  );
}

export function MonitoringErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <WebMonitoring.ErrorBoundary
      fallback={() => <MonitoringFallback />}
      handled
      showDialog={false}
    >
      {children}
    </WebMonitoring.ErrorBoundary>
  );
}
