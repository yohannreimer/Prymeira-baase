import { describe, expect, it } from "vitest";
import { createInMemoryRoutineRepository } from "./in-memory-routine.repository";
import { createRoutineService } from "./routine.service";

describe("routine service", () => {
  it("creates routines with executable task templates", async () => {
    const service = createRoutineService(createInMemoryRoutineRepository());

    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Abertura da loja",
      areaId: "area_operacao",
      taskTemplates: [
        {
          title: "Ligar equipamentos",
          processId: "process_1",
          assigneeProfileId: "profile_employee",
          dueHint: "Hoje 17:00",
          approvalMode: "direct",
          evidencePolicy: "optional"
        }
      ]
    });

    expect(routine).toMatchObject({
      workspaceId: "workspace_a",
      title: "Abertura da loja",
      createdByProfileId: "profile_owner",
      taskTemplates: [
        {
          title: "Ligar equipamentos",
          processId: "process_1",
          assigneeProfileId: "profile_employee",
          dueHint: "Hoje 17:00",
          approvalMode: "direct",
          evidencePolicy: "optional",
          sortOrder: 1
        }
      ]
    });
  });

  it("generates today's occurrences once per routine template", async () => {
    const service = createRoutineService(createInMemoryRoutineRepository());
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Rotina diária",
      taskTemplates: [
        {
          title: "Conferir agenda",
          assigneeProfileId: "profile_employee"
        },
        {
          title: "Organizar recepção",
          assigneeProfileId: "profile_employee"
        }
      ]
    });

    await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-07");
    await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-07");

    const tasks = await service.listTodayTasks("workspace_a", "profile_employee", "2026-07-07");
    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.status)).toEqual(["pending", "pending"]);
  });

  it("generates one routine execution per responsible person with the routine checklist", async () => {
    const service = createRoutineService(createInMemoryRoutineRepository());
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Organizar orquestrador",
      areaId: "area_tecnica",
      frequency: "daily",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      dueHint: "Até 09:00",
      assigneeProfileIds: ["person_peterson", "person_andre"],
      executionMode: "individual",
      evidencePolicy: "optional",
      approvalMode: "direct",
      taskTemplates: [
        { title: "Atualizar demandas de ontem" },
        { title: "Planejar demandas de hoje" }
      ]
    } as any);

    await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    const saturdayTasks = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-11");

    const petersonTasks = await service.listTodayTasks("workspace_a", "person_peterson", "2026-07-08");
    const andreTasks = await service.listTodayTasks("workspace_a", "person_andre", "2026-07-08");

    expect(saturdayTasks).toHaveLength(0);
    expect(petersonTasks).toHaveLength(1);
    expect(andreTasks).toHaveLength(1);
    expect(petersonTasks[0]).toMatchObject({
      title: "Organizar orquestrador",
      assigneeProfileId: "person_peterson",
      dueHint: "Até 09:00",
      evidencePolicy: "optional",
      approvalMode: "direct",
      checklistItems: [
        { title: "Atualizar demandas de ontem", done: false },
        { title: "Planejar demandas de hoje", done: false }
      ]
    });
    expect(andreTasks[0]).toMatchObject({
      title: "Organizar orquestrador",
      assigneeProfileId: "person_andre"
    });
  });

  it("keeps routine due hints as task metadata instead of title text", async () => {
    const service = createRoutineService(createInMemoryRoutineRepository());
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Rotina diária",
      taskTemplates: [
        {
          title: "Conferir agenda",
          assigneeProfileId: "profile_employee",
          dueHint: "Hoje 17:00"
        }
      ]
    });

    await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-07");

    const [task] = await service.listTodayTasks("workspace_a", "profile_employee", "2026-07-07");
    expect(task).toMatchObject({
      title: "Conferir agenda",
      dueHint: "Hoje 17:00",
      dueDate: "2026-07-07"
    });
  });

  it("submits direct tasks as completed when evidence rules are satisfied", async () => {
    const service = createRoutineService(createInMemoryRoutineRepository());
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Fechamento",
      taskTemplates: [
        {
          title: "Fotografar caixa",
          assigneeProfileId: "profile_employee",
          evidencePolicy: "photo_or_comment_required",
          approvalMode: "direct"
        }
      ]
    });
    await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-07");
    const [task] = await service.listTodayTasks("workspace_a", "profile_employee", "2026-07-07");
    if (!task) throw new Error("Expected generated task");

    const submitted = await service.submitTask("workspace_a", task.id, "profile_employee", {
      comment: "Caixa conferido.",
      photoUrl: null
    });

    expect(submitted).toMatchObject({
      status: "completed",
      submittedByProfileId: "profile_employee",
      evidence: {
        comment: "Caixa conferido.",
        photoUrl: null
      }
    });
  });

  it("moves approval tasks to awaiting approval after submission", async () => {
    const service = createRoutineService(createInMemoryRoutineRepository());
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Atendimento",
      taskTemplates: [
        {
          title: "Responder primeiro contato",
          assigneeProfileId: "profile_employee",
          approvalMode: "approval_required"
        }
      ]
    });
    await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-07");
    const [task] = await service.listTodayTasks("workspace_a", "profile_employee", "2026-07-07");
    if (!task) throw new Error("Expected generated task");

    const submitted = await service.submitTask("workspace_a", task.id, "profile_employee", {
      comment: "Contato respondido."
    });

    expect(submitted.status).toBe("awaiting_approval");
  });
});
