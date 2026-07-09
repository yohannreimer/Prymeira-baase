import type { OperationalTemplate, TemplateKind, TemplateSummary } from "./template.types";

export const curatedTemplates: OperationalTemplate[] = [
  {
    id: "process_client_onboarding",
    title: "Onboarding de cliente novo",
    description: "Organiza a virada entre venda, kickoff, coleta de acessos e início da entrega.",
    segment: "marketing_agency",
    area: "Atendimento",
    kind: "process",
    category: "Atendimento",
    tag: "12 etapas",
    icon: "ph-handshake",
    suggestedUse: "Use quando cada cliente entra de um jeito e o time perde informações no início do contrato.",
    adaptPrompt: "Adapte este onboarding para o ticket médio, serviços vendidos, canais de atendimento e SLA da empresa.",
    content: {
      title: "Onboarding de cliente novo",
      summary: "Entrada padronizada de cliente para reduzir retrabalho e acelerar o primeiro ciclo de entrega.",
      areaId: null,
      body: [
        "# Objetivo",
        "Garantir que todo cliente novo entre com contexto, acessos e expectativas alinhadas antes da primeira entrega.",
        "",
        "# Etapas",
        "1. Registrar fechamento no CRM e conferir escopo vendido.",
        "2. Criar pasta do cliente e checklist interno de implantação.",
        "3. Coletar acessos de contas, ferramentas, pastas e canais aprovados.",
        "4. Validar contatos decisores, aprovadores e canal principal de comunicação.",
        "5. Enviar formulário de briefing inicial com prazo definido.",
        "6. Revisar briefing e marcar pendências antes do kickoff.",
        "7. Fazer kickoff interno com vendas, atendimento e operação.",
        "8. Preparar pauta do kickoff com próximos passos e responsabilidades.",
        "9. Realizar kickoff com o cliente e registrar decisões.",
        "10. Atualizar cronograma da primeira entrega.",
        "11. Confirmar responsáveis internos e datas críticas.",
        "12. Enviar resumo final para cliente e equipe.",
        "",
        "# Critério de pronto",
        "Cliente com escopo, acessos, briefing, cronograma e responsáveis registrados no Baase."
      ].join("\n")
    }
  },
  {
    id: "process_proposal_followup",
    title: "Follow-up de proposta",
    description: "Cria uma cadência simples para proposta enviada não morrer sem próximo passo.",
    segment: "marketing_agency",
    area: "Vendas",
    kind: "process",
    category: "Vendas",
    tag: "7 dias",
    icon: "ph-trend-up",
    suggestedUse: "Use quando o dono ou vendedor precisa padronizar contatos após envio de proposta.",
    adaptPrompt: "Adapte a cadência para o ciclo de vendas, objeções comuns e canais preferidos da empresa.",
    content: {
      title: "Follow-up de proposta",
      summary: "Cadência de contato para propostas enviadas com próximo passo claro.",
      areaId: null,
      body: [
        "# Objetivo",
        "Aumentar resposta e fechamento de propostas sem pressão desorganizada.",
        "",
        "# Etapas",
        "1. Registrar proposta enviada com valor, escopo, decisor e data de validade.",
        "2. Enviar mensagem de confirmação no mesmo dia com resumo do próximo passo.",
        "3. Fazer contato no D+1 perguntando se houve dúvida sobre escopo ou investimento.",
        "4. Fazer contato no D+3 reforçando benefício central e removendo uma objeção provável.",
        "5. Fazer contato no D+5 com caso, prova ou comparação de cenário.",
        "6. Fazer fechamento no D+7 com opção de avançar, pausar ou encerrar oportunidade.",
        "7. Atualizar motivo de perda, ganho ou próxima reunião no CRM.",
        "",
        "# Critério de pronto",
        "Toda proposta tem status, próximo passo, data e aprendizado registrado."
      ].join("\n")
    }
  },
  {
    id: "process_service_delivery_handoff",
    title: "Passagem de venda para entrega",
    description: "Evita que promessas comerciais se percam entre vendedor, gestor e operação.",
    segment: "general_ops",
    area: "Operação",
    kind: "process",
    category: "Operação",
    tag: "Handoff",
    icon: "ph-arrows-left-right",
    suggestedUse: "Use quando há ruído entre o que foi vendido e o que o time precisa executar.",
    adaptPrompt: "Adapte a passagem para os produtos, responsáveis, ferramentas e campos obrigatórios da empresa.",
    content: {
      title: "Passagem de venda para entrega",
      summary: "Transferência organizada do contexto comercial para a equipe de execução.",
      areaId: null,
      body: [
        "# Objetivo",
        "Fazer a equipe entregar exatamente o que foi vendido, com contexto suficiente e sem depender da memória do dono.",
        "",
        "# Etapas",
        "1. Conferir contrato, proposta e promessas adicionais feitas na venda.",
        "2. Registrar objetivo do cliente, dores, urgências e restrições.",
        "3. Marcar riscos de escopo antes do início.",
        "4. Definir dono interno da entrega.",
        "5. Transferir materiais, contatos e datas importantes.",
        "6. Fazer reunião curta de handoff antes do kickoff externo.",
        "7. Registrar pendências e responsáveis.",
        "",
        "# Critério de pronto",
        "Operação consegue iniciar sem perguntar ao vendedor ou ao dono o que deve ser feito."
      ].join("\n")
    }
  },
  {
    id: "routine_daily_social",
    title: "Abertura do dia — Social",
    description: "Checklist diário para operação de social começar com calendário, pendências e aprovações sob controle.",
    segment: "marketing_agency",
    area: "Operação",
    kind: "routine",
    category: "Operação",
    tag: "Diária",
    icon: "ph-sun",
    suggestedUse: "Use para times que acordam apagando incêndio e esquecem aprovações ou publicações do dia.",
    adaptPrompt: "Adapte esta rotina para a quantidade de clientes, canais, responsáveis e horários de publicação.",
    content: {
      title: "Abertura do dia — Social",
      areaId: null,
      taskTemplates: [
        {
          title: "Conferir calendário editorial",
          approvalMode: "direct",
          evidencePolicy: "optional"
        },
        {
          title: "Checar posts do dia e status de aprovação",
          approvalMode: "direct",
          evidencePolicy: "comment_required"
        },
        {
          title: "Listar pendências que bloqueiam publicação",
          approvalMode: "approval_required",
          evidencePolicy: "photo_or_comment_required"
        },
        {
          title: "Avisar atendimento sobre riscos do dia",
          approvalMode: "direct",
          evidencePolicy: "optional"
        }
      ]
    }
  },
  {
    id: "routine_finance_reconciliation",
    title: "Fechamento financeiro semanal",
    description: "Rotina para conciliar recebimentos, cobranças e pendências antes que o mês vire um caos.",
    segment: "general_ops",
    area: "Financeiro",
    kind: "routine",
    category: "Financeiro",
    tag: "Semanal",
    icon: "ph-wallet",
    suggestedUse: "Use quando recebíveis, cobranças e vencimentos ficam espalhados em planilhas e conversas.",
    adaptPrompt: "Adapte esta rotina para meios de pagamento, dia de fechamento, responsáveis e política de cobrança.",
    content: {
      title: "Fechamento financeiro semanal",
      areaId: null,
      taskTemplates: [
        {
          title: "Conciliar recebimentos da semana",
          approvalMode: "direct",
          evidencePolicy: "comment_required"
        },
        {
          title: "Atualizar cobranças em aberto",
          approvalMode: "direct",
          evidencePolicy: "optional"
        },
        {
          title: "Separar clientes com risco de atraso",
          approvalMode: "approval_required",
          evidencePolicy: "photo_or_comment_required"
        },
        {
          title: "Enviar resumo financeiro para o dono",
          approvalMode: "approval_required",
          evidencePolicy: "comment_required"
        }
      ]
    }
  },
  {
    id: "routine_service_quality_check",
    title: "Revisão de qualidade da entrega",
    description: "Checklist para gestor revisar entregas críticas antes de irem para cliente.",
    segment: "local_services",
    area: "Gestão",
    kind: "routine",
    category: "Gestão",
    tag: "Por entrega",
    icon: "ph-check-circle",
    suggestedUse: "Use quando a empresa depende de aprovação do dono para tudo ficar bom.",
    adaptPrompt: "Adapte a rotina para os critérios de qualidade, evidências e alçadas de aprovação da operação.",
    content: {
      title: "Revisão de qualidade da entrega",
      areaId: null,
      taskTemplates: [
        {
          title: "Validar se a entrega segue o briefing",
          approvalMode: "direct",
          evidencePolicy: "comment_required"
        },
        {
          title: "Conferir checklist técnico da área",
          approvalMode: "direct",
          evidencePolicy: "optional"
        },
        {
          title: "Anexar evidência visual da entrega",
          approvalMode: "approval_required",
          evidencePolicy: "photo_required"
        },
        {
          title: "Registrar correções antes do envio",
          approvalMode: "approval_required",
          evidencePolicy: "comment_required"
        }
      ]
    }
  },
  {
    id: "training_evidence_standard",
    title: "Como registrar evidências",
    description: "Treinamento curto para funcionário saber quando comentar, fotografar e pedir aprovação.",
    segment: "marketing_agency",
    area: "Gestão",
    kind: "training",
    category: "Gestão",
    tag: "+ quiz",
    icon: "ph-graduation-cap",
    suggestedUse: "Use antes de ativar rotinas com foto, comentário e aprovação.",
    adaptPrompt: "Adapte o treinamento para os tipos de evidência aceitos, exemplos reais e tom interno da empresa.",
    content: {
      title: "Como registrar evidências",
      description: "Padrão mínimo para provar execução de tarefas sem poluir o processo principal.",
      materials: [
        {
          kind: "lesson",
          title: "Aula curta",
          body: [
            "Evidência é o registro simples que mostra que uma tarefa foi executada com contexto suficiente para revisão.",
            "Use comentário quando a tarefa precisa de explicação, decisão ou pendência.",
            "Use foto quando o resultado visual, local físico, tela ou documento ajuda o gestor a validar.",
            "Quando a tarefa exige aprovação, conclua somente depois de anexar a evidência pedida."
          ].join("\n")
        },
        {
          kind: "pdf",
          title: "Guia rápido de evidências",
          body: "Checklist interno: clareza, contexto, resultado, pendência e próximo passo."
        }
      ],
      quizQuestions: [
        {
          prompt: "Quando uma evidência em foto é mais útil?",
          options: [
            { id: "a", label: "Quando o resultado visual precisa ser validado" },
            { id: "b", label: "Quando não quero escrever comentário" },
            { id: "c", label: "Sempre, mesmo sem necessidade" }
          ],
          correctOptionId: "a",
          explanation: "Foto deve ajudar a validar resultado, ambiente, tela ou documento."
        },
        {
          prompt: "O que um bom comentário de evidência precisa ter?",
          options: [
            { id: "a", label: "Só um ok" },
            { id: "b", label: "Contexto, resultado e pendência quando existir" },
            { id: "c", label: "Uma mensagem longa sem padrão" }
          ],
          correctOptionId: "b",
          explanation: "O comentário deve ser curto, mas precisa dar contexto para revisão."
        }
      ]
    }
  },
  {
    id: "training_first_manager",
    title: "Primeiro dia do gestor",
    description: "Alinha o gestor sobre rotina, aprovações, devoluções e acompanhamento do time.",
    segment: "general_ops",
    area: "Gestão",
    kind: "training",
    category: "Gestão",
    tag: "Gestor",
    icon: "ph-user-focus",
    suggestedUse: "Use quando uma pessoa vira líder operacional e precisa tirar peso do dono.",
    adaptPrompt: "Adapte para as áreas que o gestor cuida, autonomia de aprovação e rituais de acompanhamento.",
    content: {
      title: "Primeiro dia do gestor",
      description: "Como acompanhar execução sem microgerenciar.",
      materials: [
        {
          kind: "lesson",
          title: "O papel do gestor no Baase",
          body: "O gestor mantém rotinas vivas, aprova o que exige critério e devolve tarefas com orientação clara."
        },
        {
          kind: "lesson",
          title: "Como devolver uma tarefa",
          body: "Devolva quando a evidência não prova execução, quando falta padrão ou quando existe pendência não registrada."
        }
      ],
      quizQuestions: [
        {
          prompt: "Quando o gestor deve devolver uma execução?",
          options: [
            { id: "a", label: "Quando faltou evidência ou padrão" },
            { id: "b", label: "Sempre que quiser refazer tudo" },
            { id: "c", label: "Nunca, só o dono pode revisar" }
          ],
          correctOptionId: "a",
          explanation: "A devolução deve corrigir falta de padrão, evidência ou contexto."
        }
      ]
    }
  },
  {
    id: "training_customer_tone",
    title: "Tom de atendimento ao cliente",
    description: "Treina respostas claras, calmas e responsáveis para conversas sensíveis com cliente.",
    segment: "marketing_agency",
    area: "Atendimento",
    kind: "training",
    category: "Atendimento",
    tag: "Cliente",
    icon: "ph-chats-circle",
    suggestedUse: "Use quando a qualidade do atendimento depende muito de intuição individual.",
    adaptPrompt: "Adapte exemplos, termos proibidos, promessas permitidas e tom desejado para a marca.",
    content: {
      title: "Tom de atendimento ao cliente",
      description: "Padrão de comunicação para manter clareza e confiança.",
      materials: [
        {
          kind: "lesson",
          title: "Regra de resposta",
          body: "Toda resposta deve reconhecer o ponto do cliente, explicar o próximo passo e deixar prazo ou responsável claro."
        },
        {
          kind: "lesson",
          title: "O que evitar",
          body: "Evite prometer prazo sem validar, culpar outra área ou responder de forma defensiva."
        }
      ],
      quizQuestions: [
        {
          prompt: "Qual resposta é mais alinhada ao padrão?",
          options: [
            { id: "a", label: "Vou verificar com o time e te retorno hoje até 17h." },
            { id: "b", label: "Acho que está tudo certo." },
            { id: "c", label: "Isso não é comigo." }
          ],
          correctOptionId: "a",
          explanation: "A melhor resposta define ação, responsável implícito e prazo."
        }
      ]
    }
  }
];

export function summarizeTemplate(template: OperationalTemplate): TemplateSummary {
  return {
    id: template.id,
    title: template.title,
    description: template.description,
    segment: template.segment,
    area: template.area,
    kind: template.kind,
    category: template.category,
    tag: template.tag,
    icon: template.icon,
    adaptPrompt: template.adaptPrompt
  };
}

export function listTemplates(filters: { segment?: string; area?: string; kind?: TemplateKind }) {
  return curatedTemplates
    .filter((template) => !filters.segment || template.segment === filters.segment)
    .filter((template) => !filters.area || template.area === filters.area)
    .filter((template) => !filters.kind || template.kind === filters.kind)
    .map(summarizeTemplate);
}

export function findTemplate(id: string) {
  return curatedTemplates.find((template) => template.id === id) ?? null;
}

export function readTemplateFilters() {
  return {
    segments: unique(curatedTemplates.map((template) => template.segment)),
    areas: unique(curatedTemplates.map((template) => template.area)),
    kinds: ["process", "routine", "training"] satisfies TemplateKind[]
  };
}

function unique<T extends string>(items: T[]) {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

