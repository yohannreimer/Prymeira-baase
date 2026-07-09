export type ProcessSopStep = {
  title: string;
  instruction: string;
  expectedResult?: string | null;
  attentionPoints?: string[];
};

export type ProcessSopDocument = {
  objective: string;
  trigger: string;
  operationalRule?: string | null;
  steps: ProcessSopStep[];
};

function cleanText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function cleanList(values: string[] | null | undefined) {
  return (values ?? []).map(cleanText).filter(Boolean);
}

export function formatProcessSopBody(document: ProcessSopDocument) {
  const objective = cleanText(document.objective);
  const trigger = cleanText(document.trigger);
  const operationalRule = cleanText(document.operationalRule);
  const steps = document.steps.map((step) => ({
    title: cleanText(step.title),
    instruction: cleanText(step.instruction),
    expectedResult: cleanText(step.expectedResult),
    attentionPoints: cleanList(step.attentionPoints)
  })).filter((step) => step.title && step.instruction);

  const header = [
    objective ? `Objetivo: ${objective}` : "",
    trigger ? `Gatilho: ${trigger}` : "",
    operationalRule ? `Regra operacional: ${operationalRule}` : ""
  ].filter(Boolean);

  const stepBlocks = steps.map((step, index) => {
    const lines = [
      `${index + 1}. ${step.title}`,
      `Instrução: ${step.instruction}`
    ];

    if (step.expectedResult) lines.push(`Resultado esperado: ${step.expectedResult}`);
    if (step.attentionPoints.length) {
      lines.push("Pontos de atenção:");
      step.attentionPoints.forEach((point) => lines.push(`- ${point}`));
    }

    return lines.join("\n");
  });

  return [header.join("\n"), ...stepBlocks].filter(Boolean).join("\n\n");
}

export function defaultProcessSopBody(title: string) {
  return formatProcessSopBody({
    objective: `Executar ${cleanText(title) || "este processo"} com clareza e registro suficiente para a equipe repetir o padrão.`,
    trigger: "Sempre que este fluxo operacional for iniciado.",
    operationalRule: "Nenhum passo crítico deve depender somente de memória, conversa informal ou WhatsApp.",
    steps: [
      {
        title: "Confirmar o gatilho do processo",
        instruction: "Verifique por que o processo está sendo iniciado, quem está envolvido e qual resultado precisa ser entregue.",
        expectedResult: "Contexto, responsável e resultado esperado ficam claros antes da execução."
      },
      {
        title: "Executar as etapas principais",
        instruction: "Siga o roteiro combinado, registre dúvidas no local correto e não pule conferências essenciais.",
        expectedResult: "O trabalho avança dentro do padrão operacional definido."
      },
      {
        title: "Registrar conclusão e pendências",
        instruction: "Ao terminar, registre o que foi concluído, o que ficou pendente e qual é o próximo passo.",
        expectedResult: "A equipe consegue entender o status do processo sem depender de conversa solta."
      }
    ]
  });
}
