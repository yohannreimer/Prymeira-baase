import type { CompanyRepository } from "../company/company.types";
import type { ProcessRepository } from "../processes/process.types";
import type { RoutineRepository } from "../routines/routine.types";
import type { TrainingAssignment, TrainingRepository } from "../trainings/training.types";

export type ProactiveSuggestionSignal =
  | "area_without_routine"
  | "role_without_training"
  | "draft_process"
  | "approval_backlog"
  | "late_tasks";

export type ProactiveSuggestion = {
  id: string;
  signal: ProactiveSuggestionSignal;
  priority: "low" | "medium" | "high";
  title: string;
  reason: string;
  action: {
    type: "create_routine" | "create_training" | "review_process" | "review_approvals" | "review_routines";
    label: string;
    prompt: string;
    targetScreen: "rotinas" | "treinamentos" | "processos" | "painel-gestor";
  };
  target: {
    areaId?: string | null;
    roleTemplateId?: string | null;
    processId?: string | null;
    taskIds?: string[];
  };
};

export type ProactiveSuggestionContext = {
  companyRepository: CompanyRepository;
  processRepository: ProcessRepository;
  routineRepository: RoutineRepository;
  trainingRepository: TrainingRepository;
};

export async function buildProactiveSuggestions(
  workspaceId: string,
  context: ProactiveSuggestionContext
): Promise<ProactiveSuggestion[]> {
  const [areas, roleTemplates, processes, routines, trainings, assignments, tasks] = await Promise.all([
    context.companyRepository.listAreas(workspaceId),
    context.companyRepository.listRoleTemplates(workspaceId),
    context.processRepository.listProcesses(workspaceId),
    context.routineRepository.listRoutines(workspaceId),
    context.trainingRepository.listTrainings(workspaceId),
    context.trainingRepository.listTrainingAssignments(workspaceId),
    context.routineRepository.listTaskOccurrences(workspaceId)
  ]);

  const activeRoutines = routines.filter((routine) => routine.status === "active");
  const publishedTrainingIds = new Set(trainings.filter((training) => training.status === "published").map((training) => training.id));
  const activeAssignments = assignments.filter((assignment) => publishedTrainingIds.has(assignment.trainingId));
  const suggestions: ProactiveSuggestion[] = [];

  for (const area of areas) {
    const hasRoutine = activeRoutines.some((routine) => routine.areaId === area.id);
    if (hasRoutine) continue;
    suggestions.push({
      id: `area_without_routine_${area.id}`,
      signal: "area_without_routine",
      priority: "high",
      title: `${area.name} ainda não tem rotina ativa`,
      reason: "Áreas sem rotina dependem de memória, cobrança manual ou WhatsApp para manter execução.",
      action: {
        type: "create_routine",
        label: "Criar rotina com IA",
        prompt: `Criar uma rotina essencial para a área ${area.name}, com checklist diário, responsável, prazo e evidência quando fizer sentido.`,
        targetScreen: "rotinas"
      },
      target: { areaId: area.id }
    });
  }

  for (const roleTemplate of roleTemplates) {
    const hasTraining = roleHasTraining(roleTemplate.areaId, roleTemplate.id, activeAssignments);
    if (hasTraining) continue;
    suggestions.push({
      id: `role_without_training_${roleTemplate.id}`,
      signal: "role_without_training",
      priority: "medium",
      title: `Cargo ${roleTemplate.name} sem treinamento publicado`,
      reason: "Cargos sem treinamento tornam a execução dependente de orientação verbal do dono ou gestor.",
      action: {
        type: "create_training",
        label: "Gerar treinamento",
        prompt: `Criar um treinamento curto para o cargo ${roleTemplate.name}, com aula prática e quiz simples sobre o padrão esperado.`,
        targetScreen: "treinamentos"
      },
      target: {
        areaId: roleTemplate.areaId,
        roleTemplateId: roleTemplate.id
      }
    });
  }

  for (const process of processes.filter((item) => item.status === "draft")) {
    suggestions.push({
      id: `draft_process_${process.id}`,
      signal: "draft_process",
      priority: "medium",
      title: `Processo "${process.title}" ainda está em rascunho`,
      reason: "Processos em rascunho não chegam à equipe e mantêm o padrão fora da execução diária.",
      action: {
        type: "review_process",
        label: "Revisar processo",
        prompt: `Melhorar o processo "${process.title}" para publicação, deixando etapas claras, evidência e aprovação quando necessário.`,
        targetScreen: "processos"
      },
      target: { processId: process.id, areaId: process.areaId }
    });
  }

  const awaitingApproval = tasks.filter((task) => task.status === "awaiting_approval");
  if (awaitingApproval.length > 0) {
    suggestions.push({
      id: "approval_backlog",
      signal: "approval_backlog",
      priority: "high",
      title: `${awaitingApproval.length} tarefa(s) aguardando aprovação`,
      reason: "Aprovações paradas travam a rotina do funcionário e escondem gargalos de qualidade.",
      action: {
        type: "review_approvals",
        label: "Revisar aprovações",
        prompt: "Resumir evidências aguardando aprovação e sugerir quais precisam de devolução.",
        targetScreen: "painel-gestor"
      },
      target: { taskIds: awaitingApproval.map((task) => task.id) }
    });
  }

  const lateTasks = tasks.filter((task) => task.status === "late");
  if (lateTasks.length > 0) {
    suggestions.push({
      id: "late_tasks",
      signal: "late_tasks",
      priority: "high",
      title: `${lateTasks.length} tarefa(s) atrasada(s)`,
      reason: "Atrasos recorrentes indicam rotina mal definida, prazo irreal ou responsável sem clareza.",
      action: {
        type: "review_routines",
        label: "Revisar rotinas",
        prompt: "Analisar tarefas atrasadas e sugerir ajustes de checklist, prazo e evidência.",
        targetScreen: "rotinas"
      },
      target: { taskIds: lateTasks.map((task) => task.id) }
    });
  }

  return suggestions.sort(compareSuggestionPriority).slice(0, 8);
}

function roleHasTraining(areaId: string, roleTemplateId: string, assignments: TrainingAssignment[]) {
  return assignments.some((assignment) => {
    if (assignment.audience.type === "all") return true;
    if (assignment.audience.type === "area") return assignment.audience.areaId === areaId;
    if (assignment.audience.type === "role") return assignment.audience.roleTemplateId === roleTemplateId;
    return false;
  });
}

function compareSuggestionPriority(left: ProactiveSuggestion, right: ProactiveSuggestion) {
  const score = { high: 0, medium: 1, low: 2 };
  return score[left.priority] - score[right.priority] || left.title.localeCompare(right.title);
}
