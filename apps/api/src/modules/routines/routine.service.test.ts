import { describe, expect, it } from "vitest";
import { createInMemoryRoutineRepository } from "./in-memory-routine.repository";
import { createRoutineService } from "./routine.service";

describe("routine service", () => {
  it.each([undefined, [], ["mon", "tue"] as const])(
    "rejects weekly routines unless exactly one weekday is supplied: %j",
    async (weekdays) => {
      const service = createRoutineService(createInMemoryRoutineRepository());
      await expect(service.createRoutine("workspace_a", "profile_owner", {
        title: "Semanal",
        frequency: "weekly",
        weekdays: weekdays ? [...weekdays] : undefined,
        taskTemplates: [{ title: "Executar" }]
      })).rejects.toThrow("ROUTINE_WEEKLY_WEEKDAY_INVALID");
    }
  );

  it("accepts a weekly routine with exactly one weekday", async () => {
    const service = createRoutineService(createInMemoryRoutineRepository());
    await expect(service.createRoutine("workspace_a", "profile_owner", {
      title: "Semanal",
      frequency: "weekly",
      weekdays: ["mon"],
      taskTemplates: [{ title: "Executar" }]
    })).resolves.toMatchObject({ frequency: "weekly", weekdays: ["mon"] });
  });

  it("preserves step identities across id-less removal and reorder updates", async () => {
    const service = createRoutineService(createInMemoryRoutineRepository());
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Abertura",
      taskTemplates: [{ title: "Portas" }, { title: "Luzes" }, { title: "Caixa" }]
    });
    const ids = Object.fromEntries(routine.taskTemplates.map((step) => [step.title, step.id]));

    const updated = await service.updateRoutine("workspace_a", routine.id, {
      title: "Abertura",
      taskTemplates: [{ title: "Caixa" }, { title: "Portas" }]
    });

    expect(updated.taskTemplates.map((step) => [step.title, step.id])).toEqual([
      ["Caixa", ids.Caixa],
      ["Portas", ids.Portas]
    ]);
    expect(updated.taskTemplates.map((step) => step.id)).not.toContain(ids.Luzes);
  });

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

    const tasks = await service.listTodayTasks("workspace_a", "2026-07-07");
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

    const [reconciled] = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    const [repeated] = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    expect(repeated?.updatedAt).toBe(reconciled?.updatedAt);
    const saturdayTasks = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-11");

    const tasks = await service.listTodayTasks("workspace_a", "2026-07-08");
    const petersonTasks = tasks.filter((task) => task.assigneeProfileId === "person_peterson");
    const andreTasks = tasks.filter((task) => task.assigneeProfileId === "person_andre");

    expect(saturdayTasks).toHaveLength(0);
    expect(tasks).toHaveLength(2);
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

  it("refreshes a pending occurrence once after a routine revision", async () => {
    const service = createRoutineService(createInMemoryRoutineRepository());
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Organizar abertura",
      frequency: "daily",
      assigneeProfileIds: ["profile_employee"],
      executionMode: "individual",
      dueHint: "Até 09:00",
      taskTemplates: [{ title: "Conferir caixa" }]
    });
    const [original] = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    if (!original) throw new Error("Expected generated task");
    await service.updateTaskChecklist("workspace_a", original.id, "profile_employee", {
      checklistItems: [{ title: "Conferir caixa", done: true }]
    });

    await service.updateRoutine("workspace_a", routine.id, {
      title: "Organizar abertura revisada",
      frequency: "daily",
      assigneeProfileIds: ["profile_employee"],
      executionMode: "individual",
      dueHint: "Até 10:00",
      taskTemplates: [
        { id: routine.taskTemplates[0]!.id, title: "Conferir caixa" },
        { title: "Registrar ajustes" }
      ]
    });
    await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");

    const tasks = await service.listTodayTasks("workspace_a", "2026-07-08");
    expect(tasks).toEqual([
      expect.objectContaining({
        id: original.id,
        title: "Organizar abertura revisada",
        dueHint: "Até 10:00",
        checklistItems: [
          { title: "Conferir caixa", done: false },
          { title: "Registrar ajustes", done: false }
        ]
      })
    ]);
  });

  it("preserves submitted task history from later edits and deletion", async () => {
    const service = createRoutineService(createInMemoryRoutineRepository());
    const task = await service.createManualTask("workspace_a", "profile_owner", {
      title: "Conferir caixa",
      dueDate: "2026-07-08"
    });
    await service.submitTask("workspace_a", task.id, "profile_owner", {});

    await expect(service.updateTaskChecklist("workspace_a", task.id, "profile_owner", {
      checklistItems: [{ title: "Conferir caixa", done: true }]
    })).rejects.toThrow("TASK_NOT_PENDING");
    await expect(service.deleteTask("workspace_a", task.id)).rejects.toThrow("TASK_NOT_PENDING");
    await expect(service.getTask("workspace_a", task.id)).resolves.toMatchObject({ status: "completed" });
  });

  it("returns shared tasks without profile filtering", async () => {
    const service = createRoutineService(createInMemoryRoutineRepository());
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Conferir equipe",
      frequency: "daily",
      executionMode: "shared",
      taskTemplates: [{ title: "Conferir equipe" }]
    });

    await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    const tasks = await service.listTodayTasks("workspace_a", "2026-07-08");

    expect(tasks).toEqual([
      expect.objectContaining({ assigneeProfileId: null, title: "Conferir equipe" })
    ]);
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

    const [task] = await service.listTodayTasks("workspace_a", "2026-07-07");
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
    const [task] = await service.listTodayTasks("workspace_a", "2026-07-07");
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
    const [task] = await service.listTodayTasks("workspace_a", "2026-07-07");
    if (!task) throw new Error("Expected generated task");

    const submitted = await service.submitTask("workspace_a", task.id, "profile_employee", {
      comment: "Contato respondido."
    });

    expect(submitted.status).toBe("awaiting_approval");
  });
});
