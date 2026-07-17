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

export type ParsedProcessSopBody = {
  objective?: string;
  trigger?: string;
  operationalRule?: string;
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

function readLabeledValue(line: string, label: string) {
  const match = line.match(new RegExp(`^${label}:\\s*(.+)$`, "iu"));
  return match?.[1]?.trim() ?? null;
}

function isExecutionPolicyLine(line: string) {
  return /^Evid[eê]ncia:/iu.test(line) || /^Aprova[cç][aã]o:/iu.test(line);
}

function normalizedBodyLines(body: string) {
  return body
    .replace(/\r/gu, "")
    .replace(/\s+(\d+[.)]\s+)/gu, "\n$1")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseProcessSopBody(body: string | null | undefined): ParsedProcessSopBody {
  const parsed: ParsedProcessSopBody = { steps: [] };
  const fallbackSteps: ProcessSopStep[] = [];
  let currentStep: ProcessSopStep | null = null;
  let readingAttentionPoints = false;

  const commitCurrentStep = () => {
    if (!currentStep) return;
    currentStep.title = cleanText(currentStep.title);
    currentStep.instruction = cleanText(currentStep.instruction);
    currentStep.expectedResult = cleanText(currentStep.expectedResult) || undefined;
    currentStep.attentionPoints = cleanList(currentStep.attentionPoints);
    if (currentStep.title) parsed.steps.push(currentStep);
    currentStep = null;
  };

  for (const line of normalizedBodyLines(body ?? "")) {
    const objective = readLabeledValue(line, "Objetivo");
    if (objective) { parsed.objective = objective; continue; }

    const trigger = readLabeledValue(line, "Gatilho");
    if (trigger) { parsed.trigger = trigger; continue; }

    const rule = readLabeledValue(line, "Regra operacional");
    if (rule) { parsed.operationalRule = rule; continue; }

    if (/^Fluxo sugerido:?$/iu.test(line) || isExecutionPolicyLine(line)) {
      readingAttentionPoints = false;
      continue;
    }

    const step = /^(\d+)[.)]\s*(.+)$/u.exec(line);
    if (step?.[2]) {
      commitCurrentStep();
      currentStep = { title: step[2], instruction: "", attentionPoints: [] };
      readingAttentionPoints = false;
      continue;
    }

    const instruction = readLabeledValue(line, "Instrução");
    if (instruction && currentStep) {
      currentStep.instruction = instruction;
      readingAttentionPoints = false;
      continue;
    }

    const expectedResult = readLabeledValue(line, "Resultado esperado");
    if (expectedResult && currentStep) {
      currentStep.expectedResult = expectedResult;
      readingAttentionPoints = false;
      continue;
    }

    if (/^Pontos de aten[cç][aã]o:?$/iu.test(line) && currentStep) {
      readingAttentionPoints = true;
      continue;
    }

    if (readingAttentionPoints && currentStep) {
      currentStep.attentionPoints = [
        ...(currentStep.attentionPoints ?? []),
        line.replace(/^[-•]\s*/u, "").trim()
      ];
      continue;
    }

    if (currentStep) {
      currentStep.instruction = [currentStep.instruction, line].filter(Boolean).join(" ");
      continue;
    }

    fallbackSteps.push({ title: line.replace(/^[-•]\s*/u, ""), instruction: "", attentionPoints: [] });
  }

  commitCurrentStep();
  if (!parsed.steps.length) parsed.steps = fallbackSteps;
  return parsed;
}
