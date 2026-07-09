import { describe, expect, it } from "vitest";
import { createNextProcessVersion, type ProcessVersion } from "./process-version";

describe("process versioning", () => {
  it("creates a new version number and preserves previous content", () => {
    const current: ProcessVersion = {
      version: 2,
      title: "Fechamento de caixa",
      body: "Conferir caixa e guardar comprovantes.",
      changeNote: "Adiciona comprovantes.",
      editorId: "user_1",
      createdAt: "2026-07-07T10:00:00.000Z"
    };

    const next = createNextProcessVersion(current, {
      body: "Conferir caixa, fotografar comprovantes e guardar envelope.",
      changeNote: "Exige foto dos comprovantes.",
      editorId: "user_2",
      createdAt: "2026-07-07T11:00:00.000Z"
    });

    expect(next).toEqual({
      version: 3,
      title: "Fechamento de caixa",
      body: "Conferir caixa, fotografar comprovantes e guardar envelope.",
      changeNote: "Exige foto dos comprovantes.",
      editorId: "user_2",
      createdAt: "2026-07-07T11:00:00.000Z",
      previous: current
    });
  });
});
