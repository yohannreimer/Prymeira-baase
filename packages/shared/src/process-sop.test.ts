import { describe, expect, it } from "vitest";
import { formatProcessSopBody, parseProcessSopBody } from "./process-sop";

describe("process SOP body", () => {
  it("parses the canonical operational structure", () => {
    const parsed = parseProcessSopBody(`Objetivo: Padronizar vendas
Gatilho: Novo prospect
Regra operacional: Registrar tudo

1. Abrir registro
Instrução: Cadastre o prospect.
Resultado esperado: Registro criado.
Pontos de atenção:
- Não deixar no WhatsApp.

2. Definir retorno
Instrução: Registre data e responsável.`);

    expect(parsed).toMatchObject({
      objective: "Padronizar vendas",
      trigger: "Novo prospect",
      operationalRule: "Registrar tudo"
    });
    expect(parsed.steps.map((step) => step.title)).toEqual(["Abrir registro", "Definir retorno"]);
    expect(parsed.steps[0]).toMatchObject({
      instruction: "Cadastre o prospect.",
      expectedResult: "Registro criado.",
      attentionPoints: ["Não deixar no WhatsApp."]
    });
  });

  it("round-trips the canonical formatter without copying step numbers into titles", () => {
    const body = formatProcessSopBody({
      objective: "Entregar com clareza",
      trigger: "Novo pedido",
      operationalRule: "Registrar a conclusão",
      steps: [
        { title: "Preparar", instruction: "Separe os materiais." },
        { title: "Concluir", instruction: "Registre a entrega.", expectedResult: "Entrega registrada." }
      ]
    });

    expect(parseProcessSopBody(body).steps).toEqual([
      { title: "Preparar", instruction: "Separe os materiais.", attentionPoints: [] },
      { title: "Concluir", instruction: "Registre a entrega.", expectedResult: "Entrega registrada.", attentionPoints: [] }
    ]);
  });

  it("keeps unlabelled legacy lines available as steps", () => {
    expect(parseProcessSopBody("Conferir dados\nConfirmar responsável").steps).toEqual([
      { title: "Conferir dados", instruction: "", attentionPoints: [] },
      { title: "Confirmar responsável", instruction: "", attentionPoints: [] }
    ]);
  });

  it("ignores execution policy lines outside the SOP narrative", () => {
    const parsed = parseProcessSopBody("1. Revisar\nInstrução: Confira tudo.\nEvidência: Anexo obrigatório\nAprovação: Gestor");
    expect(parsed.steps).toEqual([{ title: "Revisar", instruction: "Confira tudo.", attentionPoints: [] }]);
  });
});
