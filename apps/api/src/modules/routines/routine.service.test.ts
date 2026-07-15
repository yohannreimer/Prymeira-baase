import { describe, expect, it } from "vitest";
import { createInMemoryRoutineRepository } from "./in-memory-routine.repository";
import { createRoutineService } from "./routine.service";

describe("routine service", () => {
  it("recovers manual tasks and routines by a caller-provided durable identity", async () => {
    const repository = createInMemoryRoutineRepository();
    let throwAfterTaskCreate = true;
    const service = createRoutineService({
      ...repository,
      async createTaskOccurrence(input) {
        const created = await repository.createTaskOccurrence(input);
        if (throwAfterTaskCreate) {
          throwAfterTaskCreate = false;
          throw new Error("lost response after commit");
        }
        return created;
      }
    });

    const task = await service.createManualTask("workspace_a", "profile_owner", {
      title: "Ação estratégica",
      dueDate: "2026-07-20"
    }, { resourceId: "task_studio_durable" });
    const repeatedTask = await createRoutineService(repository).createManualTask(
      "workspace_a", "profile_owner", { title: "Não sobrescrever", dueDate: "2026-07-21" },
      { resourceId: "task_studio_durable" }
    );
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Ritual operacional",
      taskTemplates: [{ title: "Revisar" }]
    }, { resourceId: "routine_studio_durable" });
    const repeatedRoutine = await createRoutineService(repository).createRoutine(
      "workspace_a", "profile_owner", { title: "Não duplicar", taskTemplates: [{ title: "Outra" }] },
      { resourceId: "routine_studio_durable" }
    );

    expect(task.id).toBe("task_studio_durable");
    expect(repeatedTask).toEqual(task);
    expect(routine.id).toBe("routine_studio_durable");
    expect(repeatedRoutine).toEqual(routine);
    await expect(repository.listTaskOccurrences("workspace_a")).resolves.toHaveLength(1);
    await expect(repository.listRoutines("workspace_a")).resolves.toHaveLength(1);
  });

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

  it("reports an attachment key only after reconciling its pending occurrence away", async () => {
    const service = createRoutineService(createInMemoryRoutineRepository());
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Abertura",
      frequency: "daily",
      taskTemplates: [{ title: "Portas" }, { title: "Caixa" }]
    });
    const [doors] = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    if (!doors) throw new Error("Expected generated task");
    await service.attachTaskEvidence("workspace_a", doors.id, "profile_owner", {
      attachment: { objectKey: "workspaces/workspace_a/task-evidence/doors.png", fileName: "doors.png", contentType: "image/png", sizeBytes: 8 }
    });
    await service.updateRoutine("workspace_a", routine.id, {
      title: "Abertura",
      frequency: "daily",
      taskTemplates: [{ id: routine.taskTemplates[1]!.id, title: "Caixa" }]
    });

    const reconciliation = await service.generateRoutineOccurrencesWithCleanup("workspace_a", routine.id, "2026-07-08");

    expect(reconciliation.tasks).toEqual([expect.objectContaining({ title: "Caixa" })]);
    expect(reconciliation.removedObjectKeys).toEqual(["workspaces/workspace_a/task-evidence/doors.png"]);
  });

  it("does not report an archived attachment key that remains referenced by persisted work", async () => {
    const service = createRoutineService(createInMemoryRoutineRepository());
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Abertura",
      frequency: "daily",
      taskTemplates: [{ title: "Portas" }, { title: "Caixa" }]
    });
    const [doors] = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    if (!doors) throw new Error("Expected generated task");
    const objectKey = "workspaces/workspace_a/task-evidence/shared.png";
    await service.attachTaskEvidence("workspace_a", doors.id, "profile_owner", {
      attachment: { objectKey, fileName: "shared.png", contentType: "image/png", sizeBytes: 8 }
    });
    const manual = await service.createManualTask("workspace_a", "profile_owner", { title: "Retido", dueDate: "2026-07-08" });
    await service.attachTaskEvidence("workspace_a", manual.id, "profile_owner", {
      attachment: { objectKey, fileName: "shared.png", contentType: "image/png", sizeBytes: 8 }
    });
    await service.updateRoutine("workspace_a", routine.id, {
      title: "Abertura",
      frequency: "daily",
      taskTemplates: [{ id: routine.taskTemplates[1]!.id, title: "Caixa" }]
    });

    const reconciliation = await service.generateRoutineOccurrencesWithCleanup("workspace_a", routine.id, "2026-07-08");

    expect(reconciliation.removedObjectKeys).toEqual([]);
    await expect(service.getTask("workspace_a", manual.id)).resolves.toMatchObject({ evidence: { attachment: { objectKey } } });
  });

  it("does not rewrite pending in-memory occurrences on a second unchanged generation", async () => {
    let tick = 0;
    const service = createRoutineService(createInMemoryRoutineRepository({
      now: () => `2026-07-08T00:00:00.${String(tick++).padStart(3, "0")}Z`
    }));
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Abertura", frequency: "daily", taskTemplates: [{ title: "Conferir caixa" }]
    });
    const [first] = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    const [second] = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");

    expect(second).toMatchObject({ id: first?.id, updatedAt: first?.updatedAt });
  });

  it("keeps submitted shared history on its own revision after a sibling refresh", async () => {
    const service = createRoutineService(createInMemoryRoutineRepository());
    const routine = await service.createRoutine("workspace_a", "profile_owner", {
      title: "Abertura", frequency: "daily", taskTemplates: [{ title: "Portas" }, { title: "Caixa" }]
    });
    const original = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    const historical = original.find((task) => task.title === "Portas");
    if (!historical) throw new Error("Expected shared task");
    await service.submitTask("workspace_a", historical.id, "profile_owner", {});
    const revised = await service.updateRoutine("workspace_a", routine.id, {
      title: "Abertura revisada", frequency: "daily",
      taskTemplates: routine.taskTemplates.map((template) => ({ id: template.id, title: template.title }))
    });

    const reconciled = await service.generateRoutineOccurrences("workspace_a", routine.id, "2026-07-08");
    expect(reconciled.find((task) => task.id === historical.id)).toMatchObject({
      title: "Portas", routineTitleSnapshot: "Abertura", routineRevisionSnapshot: historical.routineRevisionSnapshot
    });
    expect(reconciled.find((task) => task.id !== historical.id)).toMatchObject({
      routineTitleSnapshot: "Abertura revisada", routineRevisionSnapshot: revised.updatedAt
    });
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
      comment: "Caixa conferido."
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

  it("keeps legacy photo URLs while submitting a task", async () => {
    const repository = createInMemoryRoutineRepository();
    const service = createRoutineService(repository);
    const task = await service.createManualTask("workspace_a", "profile_owner", {
      title: "Conferir comprovante",
      dueDate: "2026-07-07",
      evidencePolicy: "photo_required"
    });

    // Legacy rows can contain a URL without an object-storage attachment.
    await repository.updateTaskOccurrence({
      ...task,
      evidence: { comment: null, photoUrl: "https://legacy.example/comprovante.jpg", attachment: null }
    });

    const submitted = await service.submitTask("workspace_a", task.id, "profile_owner", {});
    expect(submitted).toMatchObject({
      status: "completed",
      evidence: { comment: null, photoUrl: "https://legacy.example/comprovante.jpg", attachment: null }
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
