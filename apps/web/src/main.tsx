import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BaaseAuthRoot } from "./auth";
import { initializeWebMonitoring } from "./monitoring/client";
import { MonitoringErrorBoundary } from "./monitoring/MonitoringErrorBoundary";

initializeWebMonitoring();
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <MonitoringErrorBoundary>
      <BaaseAuthRoot>
        <App />
      </BaaseAuthRoot>
    </MonitoringErrorBoundary>
  </StrictMode>
);
