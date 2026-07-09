import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BaaseAuthRoot } from "./auth";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <BaaseAuthRoot>
      <App />
    </BaaseAuthRoot>
  </StrictMode>
);
