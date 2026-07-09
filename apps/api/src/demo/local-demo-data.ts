import type { CompanyProcess, ProcessVersionRecord } from "../modules/processes/process.types";
import type { CompanyRoutine, RoutineTaskTemplate, TaskOccurrence } from "../modules/routines/routine.types";
import type { Training } from "../modules/trainings/training.types";

const workspaceId = "workspace_a";
const createdAt = "2026-07-07T09:00:00.000Z";
const dueDate = "2026-07-07";

function processVersion(processId: string, title: string, body: string): ProcessVersionRecord {
  return {
    id: `version_${processId}_1`,
    processId,
    workspaceId,
    version: 1,
    title,
    body,
    changeNote: "Criacao inicial do demo local",
    editorProfileId: "profile_owner",
    createdAt
  };
}

function process(id: string, title: string, summary: string, areaId: string | null, status: CompanyProcess["status"]): CompanyProcess {
  const currentVersion = processVersion(id, title, summary);
  return {
    id,
    workspaceId,
    areaId,
    title,
    summary,
    status,
    ownerProfileId: "profile_owner",
    currentVersion,
    versions: [currentVersion],
    createdByProfileId: "profile_owner",
    publishedAt: status === "published" ? createdAt : null,
    archivedAt: null,
    createdAt,
    updatedAt: createdAt
  };
}

function template(
  routineId: string,
  index: number,
  title: string,
  evidencePolicy: RoutineTaskTemplate["evidencePolicy"] = "optional"
): RoutineTaskTemplate {
  return {
    id: `template_${routineId}_${index}`,
    routineId,
    workspaceId,
    title,
    processId: null,
    assigneeProfileId: "profile_employee",
    approvalMode: evidencePolicy === "optional" ? "direct" : "approval_required",
    evidencePolicy,
    sortOrder: index
  };
}

function routine(id: string, title: string, areaId: string | null, taskTitles: string[]): CompanyRoutine {
  return {
    id,
    workspaceId,
    areaId,
    title,
    status: "active",
    createdByProfileId: "profile_owner",
    taskTemplates: taskTitles.map((titleText, index) => template(id, index + 1, titleText, index === 0 ? "photo_or_comment_required" : "optional")),
    createdAt,
    updatedAt: createdAt
  };
}

function task(id: string, routineId: string, templateId: string, title: string, status: TaskOccurrence["status"], evidencePolicy: TaskOccurrence["evidencePolicy"]): TaskOccurrence {
  return {
    id,
    workspaceId,
    routineId,
    taskTemplateId: templateId,
    title,
    processId: null,
    assigneeProfileId: "profile_employee",
    approvalMode: evidencePolicy === "optional" ? "direct" : "approval_required",
    evidencePolicy,
    status,
    dueDate,
    evidence: status === "completed" ? { comment: "Concluido no demo local.", photoUrl: null } : null,
    submittedByProfileId: status === "completed" ? "profile_employee" : null,
    submittedAt: status === "completed" ? "2026-07-07T10:10:00.000Z" : null,
    reviewedByProfileId: null,
    reviewedAt: null,
    reviewComment: null,
    createdAt,
    updatedAt: createdAt
  };
}

export function createLocalDemoProcesses(): CompanyProcess[] {
  return [
    process("process_1", "Onboarding de cliente novo", "Do fechamento ao kickoff, com acessos, pasta, board e responsavel definidos.", "Atendimento", "published"),
    process("process_2", "Aprovacao de pecas", "Fluxo de revisao, aprovacao dupla e registro de evidencia antes do envio ao cliente.", "Criacao", "published"),
    process("process_3", "Fechamento de campanha", "Checklist de encerramento, relatorio final, aprendizados e proximas acoes.", "Midia", "published"),
    process("process_4", "Conciliacao financeira", "Conferencia semanal de entradas, saidas e pendencias de pagamento.", "Financeiro", "draft")
  ];
}

export function createLocalDemoRoutines(): CompanyRoutine[] {
  return [
    routine("routine_1", "Abertura do dia - Social", "Criacao", [
      "Enviar pecas finais - campanha Loja Vitta",
      "Atualizar board do cliente Cafe Aurora",
      "Revisar copy do anuncio - Loja Vitta",
      "Publicar carrossel - Cafe Aurora"
    ]),
    routine("routine_2", "Relatorio semanal de midia", "Midia", ["Conferir KPIs", "Registrar aprendizados", "Enviar resumo para atendimento"]),
    routine("routine_3", "Conciliacao financeira", "Financeiro", ["Conferir entradas", "Marcar pendencias", "Enviar fechamento"])
  ];
}

export function createLocalDemoTasks(): TaskOccurrence[] {
  return [
    task("task_1", "routine_1", "template_routine_1_1", "Enviar pecas finais - campanha Loja Vitta", "pending", "photo_or_comment_required"),
    task("task_2", "routine_1", "template_routine_1_2", "Atualizar board do cliente Cafe Aurora", "completed", "optional"),
    task("task_3", "routine_1", "template_routine_1_3", "Revisar copy do anuncio - Loja Vitta", "pending", "optional"),
    task("task_4", "routine_1", "template_routine_1_4", "Publicar carrossel - Cafe Aurora", "pending", "photo_or_comment_required")
  ];
}

export function createLocalDemoTrainings(): Training[] {
  return [
    {
      id: "training_1",
      workspaceId,
      title: "Padrao de aprovacao de pecas",
      description: "Aula curta, PDF e quiz para garantir que a equipe siga o fluxo novo.",
      status: "published",
      source: { type: "material", processId: null, title: "Guia de aprovacao.pdf" },
      audience: { type: "all" },
      dueDate: null,
      materials: [
        { id: "material_training_1_1", trainingId: "training_1", workspaceId, kind: "pdf", title: "Guia de aprovacao.pdf", body: null, url: null, sortOrder: 1 },
        { id: "material_training_1_2", trainingId: "training_1", workspaceId, kind: "lesson", title: "Video curto - aprovacao dupla", body: "Como submeter, marcar o responsavel e aguardar o ok.", url: null, sortOrder: 2 }
      ],
      quizQuestions: [
        {
          id: "question_training_1_1",
          trainingId: "training_1",
          workspaceId,
          prompt: "Voce terminou uma peca para o cliente. Qual e o caminho certo?",
          options: [
            { id: "a", label: "Enviar direto ao cliente para ganhar tempo" },
            { id: "b", label: "Subir no Baase, marcar o responsavel e aguardar aprovacao" },
            { id: "c", label: "Publicar e avisar a equipe depois" }
          ],
          correctOptionId: "b",
          explanation: "O Baase precisa registrar a aprovacao antes do envio.",
          sortOrder: 1
        }
      ],
      createdByProfileId: "profile_owner",
      publishedAt: createdAt,
      archivedAt: null,
      createdAt,
      updatedAt: createdAt
    },
    {
      id: "training_2",
      workspaceId,
      title: "Tom de voz da marca",
      description: "Padrao rapido para revisar legendas e copies antes da publicacao.",
      status: "published",
      source: { type: "manual", processId: null, title: null },
      audience: { type: "all" },
      dueDate: null,
      materials: [{ id: "material_training_2_1", trainingId: "training_2", workspaceId, kind: "lesson", title: "Resumo do tom de voz", body: "Clareza, consistencia e exemplos aprovados.", url: null, sortOrder: 1 }],
      quizQuestions: [],
      createdByProfileId: "profile_owner",
      publishedAt: createdAt,
      archivedAt: null,
      createdAt,
      updatedAt: createdAt
    }
  ];
}
