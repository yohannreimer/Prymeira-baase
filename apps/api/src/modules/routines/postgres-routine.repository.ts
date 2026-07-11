import type { CompanyRoutine, RoutineRepository, RoutineTaskTemplate, TaskChecklistItem, TaskOccurrence } from "./routine.types";
import { audit, generatedId, inTransaction, iso, type OperationalClient, type OperationalPool } from "../../db/operational-repository-support";

type RoutineRow = { id:string;workspace_id:string;area_id:string|null;title:string;status:"active"|"archived";frequency:CompanyRoutine["frequency"];weekdays:string[];execution_mode:CompanyRoutine["executionMode"];approval_mode:CompanyRoutine["approvalMode"];evidence_policy:CompanyRoutine["evidencePolicy"];due_hint:string|null;created_by_profile_id:string;created_at:string|Date;updated_at:string|Date };
type StepRow = { id:string;workspace_id:string;routine_id:string;title:string;process_id:string|null;due_hint:string|null;approval_mode:RoutineTaskTemplate["approvalMode"];evidence_policy:RoutineTaskTemplate["evidencePolicy"];sort_order:number };
type AssignmentRow = { routine_id:string;routine_step_id:string|null;profile_id:string|null };
type TaskRow = { id:string;workspace_id:string;origin:TaskOccurrence["origin"];routine_id:string|null;routine_step_id:string|null;area_id:string|null;process_id:string|null;assignee_profile_id:string|null;audience_key:string|null;title:string;area_name_snapshot:string|null;routine_title_snapshot:string|null;step_title_snapshot:string;due_hint:string|null;approval_mode:TaskOccurrence["approvalMode"];evidence_policy:TaskOccurrence["evidencePolicy"];status:TaskOccurrence["status"];due_date:string|Date;submitted_by_profile_id:string|null;submitted_at:string|Date|null;reviewed_by_profile_id:string|null;reviewed_at:string|Date|null;review_comment:string|null;created_at:string|Date;updated_at:string|Date };
type ChecklistRow = { task_occurrence_id:string;title:string;is_completed:boolean;sort_order:number };
type EvidenceRow = { task_occurrence_id:string;kind:"comment"|"photo";comment:string|null;photo_url:string|null;created_at:string|Date };

async function hydrateRoutines(db: Pick<OperationalPool,"query">|Pick<OperationalClient,"query">, rows: RoutineRow[]) {
  if (!rows.length) return [];
  const workspaceId=rows[0]!.workspace_id, ids=rows.map(row=>row.id);
  const [stepsResult, assignmentsResult]=await Promise.all([
    db.query<StepRow>("SELECT * FROM routine_steps WHERE workspace_id=$1 AND routine_id=ANY($2::text[]) AND archived_at IS NULL ORDER BY sort_order",[workspaceId,ids]),
    db.query<AssignmentRow>("SELECT routine_id,routine_step_id,profile_id FROM routine_assignments WHERE workspace_id=$1 AND routine_id=ANY($2::text[]) AND profile_id IS NOT NULL",[workspaceId,ids])
  ]);
  return rows.map((row):CompanyRoutine=>{
    const assignments=assignmentsResult.rows.filter(item=>item.routine_id===row.id);
    const taskTemplates=stepsResult.rows.filter(step=>step.routine_id===row.id).map((step):RoutineTaskTemplate=>({
      id:step.id,routineId:step.routine_id,workspaceId:step.workspace_id,title:step.title,processId:step.process_id,
      assigneeProfileId:assignments.find(item=>item.routine_step_id===step.id)?.profile_id??null,dueHint:step.due_hint,
      approvalMode:step.approval_mode,evidencePolicy:step.evidence_policy,sortOrder:step.sort_order
    }));
    return { id:row.id,workspaceId:row.workspace_id,areaId:row.area_id,title:row.title,status:row.status,
      frequency:row.frequency,weekdays:row.weekdays as CompanyRoutine["weekdays"],dueHint:row.due_hint,
      assigneeProfileIds:assignments.filter(item=>item.routine_step_id===null).map(item=>item.profile_id!),
      executionMode:row.execution_mode,approvalMode:row.approval_mode,evidencePolicy:row.evidence_policy,
      createdByProfileId:row.created_by_profile_id,taskTemplates,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at) };
  });
}

async function hydrateTasks(db: Pick<OperationalPool,"query">|Pick<OperationalClient,"query">, rows:TaskRow[]) {
  if (!rows.length) return [];
  const workspaceId=rows[0]!.workspace_id,ids=rows.map(row=>row.id);
  const [checkResult,evidenceResult]=await Promise.all([
    db.query<ChecklistRow>("SELECT task_occurrence_id,title,is_completed,sort_order FROM task_checklist_items WHERE workspace_id=$1 AND task_occurrence_id=ANY($2::text[]) ORDER BY sort_order",[workspaceId,ids]),
    db.query<EvidenceRow>("SELECT task_occurrence_id,kind,comment,photo_url,created_at FROM task_evidence WHERE workspace_id=$1 AND task_occurrence_id=ANY($2::text[]) ORDER BY created_at DESC,id DESC",[workspaceId,ids])
  ]);
  return rows.map((row):TaskOccurrence=>{
    const evidenceRows=evidenceResult.rows.filter(item=>item.task_occurrence_id===row.id);
    const comment=evidenceRows.find(item=>item.kind==="comment")?.comment??null;
    const photoUrl=evidenceRows.find(item=>item.kind==="photo")?.photo_url??null;
    const dueDate=row.due_date instanceof Date ? row.due_date.toISOString().slice(0,10) : String(row.due_date).slice(0,10);
    return { id:row.id,workspaceId:row.workspace_id,origin:row.origin,routineId:row.routine_id,
      taskTemplateId:row.routine_step_id,title:row.title,areaId:row.area_id,processId:row.process_id,
      assigneeProfileId:row.assignee_profile_id,dueHint:row.due_hint,approvalMode:row.approval_mode,
      evidencePolicy:row.evidence_policy,status:row.status,dueDate,evidence:comment||photoUrl?{comment,photoUrl}:null,
      checklistItems:checkResult.rows.filter(item=>item.task_occurrence_id===row.id).map(item=>({title:item.title,done:item.is_completed})),
      areaNameSnapshot:row.area_name_snapshot,routineTitleSnapshot:row.routine_title_snapshot,stepTitleSnapshot:row.step_title_snapshot,
      submittedByProfileId:row.submitted_by_profile_id,submittedAt:row.submitted_at?iso(row.submitted_at):null,
      reviewedByProfileId:row.reviewed_by_profile_id,reviewedAt:row.reviewed_at?iso(row.reviewed_at):null,
      reviewComment:row.review_comment,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at) };
  });
}

export function createPostgresRoutineRepository(db:OperationalPool):RoutineRepository {
  return {
    async listRoutines(workspaceId){const r=await db.query<RoutineRow>("SELECT * FROM routines WHERE workspace_id=$1 AND archived_at IS NULL ORDER BY created_at,id",[workspaceId]);return hydrateRoutines(db,r.rows);},
    async findRoutine(workspaceId,routineId){const r=await db.query<RoutineRow>("SELECT * FROM routines WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",[workspaceId,routineId]);return (await hydrateRoutines(db,r.rows))[0]??null;},
    async createRoutine(input){return inTransaction(db,async client=>{
      const id=generatedId("routine");
      await client.query(`INSERT INTO routines (id,workspace_id,area_id,title,status,frequency,weekdays,month_day,execution_mode,approval_mode,evidence_policy,due_hint,created_by_profile_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[id,input.workspaceId,input.areaId,input.title,input.status,input.frequency??"daily",input.weekdays??[],input.frequency==="monthly"?1:null,input.executionMode??"shared",input.approvalMode??"direct",input.evidencePolicy??"optional",input.dueHint??null,input.createdByProfileId]);
      for(const template of input.taskTemplates) await insertStepAndAssignment(client,id,{...template,id:template.id.replace("__routine__",id),routineId:id});
      await replaceGeneralAssignments(client,input.workspaceId,id,input.assigneeProfileIds??[]);
      await audit(client,input.workspaceId,"routine",id,"create",input.createdByProfileId);
      const row=await client.query<RoutineRow>("SELECT * FROM routines WHERE workspace_id=$1 AND id=$2",[input.workspaceId,id]);
      return (await hydrateRoutines(client,row.rows))[0]!;
    });},
    async updateRoutine(routine){return inTransaction(db,async client=>{
      const result=await client.query<RoutineRow>(`UPDATE routines SET area_id=$3,title=$4,status=$5,frequency=$6,weekdays=$7,month_day=$8,execution_mode=$9,approval_mode=$10,evidence_policy=$11,due_hint=$12,archived_at=CASE WHEN $5='archived' THEN COALESCE(archived_at,NOW()) ELSE archived_at END,updated_at=NOW()
        WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL RETURNING *`,[routine.workspaceId,routine.id,routine.areaId,routine.title,routine.status,routine.frequency??"daily",routine.weekdays??[],routine.frequency==="monthly"?1:null,routine.executionMode??"shared",routine.approvalMode??"direct",routine.evidencePolicy??"optional",routine.dueHint??null]);
      if(!result.rows[0])throw new Error("ROUTINE_NOT_FOUND");
      const activeIds=routine.taskTemplates.map(item=>item.id);
      await client.query("UPDATE routine_steps SET archived_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND routine_id=$2 AND archived_at IS NULL AND NOT (id=ANY($3::text[]))",[routine.workspaceId,routine.id,activeIds]);
      for(const template of routine.taskTemplates) await upsertStepAndAssignment(client,template);
      await replaceGeneralAssignments(client,routine.workspaceId,routine.id,routine.assigneeProfileIds??[]);
      await audit(client,routine.workspaceId,"routine",routine.id,routine.status==="archived"?"archive":"update",routine.createdByProfileId);
      return (await hydrateRoutines(client,result.rows))[0]!;
    });},
    async deleteRoutine(workspaceId,routineId){await inTransaction(db,async client=>{await client.query("UPDATE routines SET status='archived',archived_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",[workspaceId,routineId]);await audit(client,workspaceId,"routine",routineId,"archive");});},
    async listTaskOccurrences(workspaceId,filters={}){const params:unknown[]=[workspaceId];let sql="SELECT * FROM task_occurrences WHERE workspace_id=$1 AND archived_at IS NULL";if(filters.dueDate){params.push(filters.dueDate);sql+=` AND due_date=$${params.length}`;}if(filters.profileId){params.push(filters.profileId);sql+=` AND (assignee_profile_id IS NULL OR assignee_profile_id=$${params.length})`;}sql+=" ORDER BY created_at,id";const r=await db.query<TaskRow>(sql,params);return hydrateTasks(db,r.rows);},
    async findTaskOccurrence(workspaceId,taskId){const r=await db.query<TaskRow>("SELECT * FROM task_occurrences WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",[workspaceId,taskId]);return (await hydrateTasks(db,r.rows))[0]??null;},
    async findTaskOccurrenceForTemplate(workspaceId,routineId,taskTemplateId,dueDate){
      const individualPrefix=`${routineId}__execution__`;
      const r=taskTemplateId.startsWith(individualPrefix)
        ? await db.query<TaskRow>("SELECT * FROM task_occurrences WHERE workspace_id=$1 AND routine_id=$2 AND due_date=$3 AND audience_key=$4 AND archived_at IS NULL",[workspaceId,routineId,dueDate,taskTemplateId.slice(individualPrefix.length)])
        : await db.query<TaskRow>("SELECT * FROM task_occurrences WHERE workspace_id=$1 AND routine_id=$2 AND routine_step_id=$3 AND due_date=$4 AND archived_at IS NULL",[workspaceId,routineId,taskTemplateId,dueDate]);
      return (await hydrateTasks(db,r.rows))[0]??null;
    },
    async createTaskOccurrence(input){return inTransaction(db,async client=>createOrReuseTask(client,input));},
    async updateTaskOccurrence(task){return inTransaction(db,async client=>{
      const result=await client.query<TaskRow>(`UPDATE task_occurrences SET title=$3,area_id=$4,process_id=$5,assignee_profile_id=$6,due_hint=$7,approval_mode=$8,evidence_policy=$9,status=$10,due_date=$11,submitted_by_profile_id=$12,submitted_at=$13,reviewed_by_profile_id=$14,reviewed_at=$15,review_comment=$16,completed_at=CASE WHEN $10='completed' THEN COALESCE(completed_at,NOW()) ELSE completed_at END,updated_at=NOW()
        WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL RETURNING *`,[task.workspaceId,task.id,task.title,task.areaId??null,task.processId,task.assigneeProfileId,task.dueHint??null,task.approvalMode,task.evidencePolicy,task.status,task.dueDate,task.submittedByProfileId,task.submittedAt,task.reviewedByProfileId,task.reviewedAt,task.reviewComment]);
      if(!result.rows[0])throw new Error("TASK_NOT_FOUND");
      await replaceChecklist(client,task.workspaceId,task.id,task.checklistItems??[]);
      await appendEvidence(client,task);
      await audit(client,task.workspaceId,"task_occurrence",task.id,"update",task.submittedByProfileId??task.reviewedByProfileId);
      return (await hydrateTasks(client,result.rows))[0]!;
    });},
    async deleteTaskOccurrence(workspaceId,taskId){await inTransaction(db,async client=>{await client.query("UPDATE task_occurrences SET archived_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",[workspaceId,taskId]);await audit(client,workspaceId,"task_occurrence",taskId,"archive");});}
  };
}

async function insertStepAndAssignment(client:OperationalClient,routineId:string,step:RoutineTaskTemplate){await client.query(`INSERT INTO routine_steps (id,workspace_id,routine_id,title,process_id,due_hint,approval_mode,evidence_policy,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[step.id,step.workspaceId,routineId,step.title,step.processId,step.dueHint??null,step.approvalMode,step.evidencePolicy,step.sortOrder]);if(step.assigneeProfileId)await client.query(`INSERT INTO routine_assignments (id,workspace_id,routine_id,routine_step_id,profile_id) VALUES ($1,$2,$3,$4,$5)`,[generatedId("assignment"),step.workspaceId,routineId,step.id,step.assigneeProfileId]);}
async function upsertStepAndAssignment(client:OperationalClient,step:RoutineTaskTemplate){await client.query(`INSERT INTO routine_steps (id,workspace_id,routine_id,title,process_id,due_hint,approval_mode,evidence_policy,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (workspace_id,id) DO UPDATE SET title=EXCLUDED.title,process_id=EXCLUDED.process_id,due_hint=EXCLUDED.due_hint,approval_mode=EXCLUDED.approval_mode,evidence_policy=EXCLUDED.evidence_policy,sort_order=EXCLUDED.sort_order,archived_at=NULL,updated_at=NOW()`,[step.id,step.workspaceId,step.routineId,step.title,step.processId,step.dueHint??null,step.approvalMode,step.evidencePolicy,step.sortOrder]);await client.query("DELETE FROM routine_assignments WHERE workspace_id=$1 AND routine_id=$2 AND routine_step_id=$3",[step.workspaceId,step.routineId,step.id]);if(step.assigneeProfileId)await client.query(`INSERT INTO routine_assignments (id,workspace_id,routine_id,routine_step_id,profile_id) VALUES ($1,$2,$3,$4,$5)`,[generatedId("assignment"),step.workspaceId,step.routineId,step.id,step.assigneeProfileId]);}
async function replaceGeneralAssignments(client:OperationalClient,workspaceId:string,routineId:string,ids:string[]){await client.query("DELETE FROM routine_assignments WHERE workspace_id=$1 AND routine_id=$2 AND routine_step_id IS NULL",[workspaceId,routineId]);for(const id of ids)await client.query(`INSERT INTO routine_assignments (id,workspace_id,routine_id,profile_id) VALUES ($1,$2,$3,$4)`,[generatedId("assignment"),workspaceId,routineId,id]);}

async function createOrReuseTask(client:OperationalClient,input:Omit<TaskOccurrence,"id"|"createdAt"|"updatedAt">){
  let stepId=input.taskTemplateId,audienceKey:string|null=null,areaName:string|null=null,routineTitle:string|null=null,stepTitle=input.title;
  if(input.origin==="routine"&&input.routineId){const routine=await client.query<RoutineRow>("SELECT * FROM routines WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",[input.workspaceId,input.routineId]);if(!routine.rows[0])throw new Error("ROUTINE_NOT_FOUND");routineTitle=routine.rows[0].title;audienceKey=input.assigneeProfileId??"shared";const area= input.areaId ? await client.query<{name:string}>("SELECT name FROM areas WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",[input.workspaceId,input.areaId]):{rows:[]};areaName=area.rows[0]?.name??null;if(stepId?.includes("__execution__")){const first=await client.query<StepRow>("SELECT * FROM routine_steps WHERE workspace_id=$1 AND routine_id=$2 AND archived_at IS NULL ORDER BY sort_order LIMIT 1",[input.workspaceId,input.routineId]);stepId=first.rows[0]?.id??null;stepTitle=input.title;}}
  let parentId:string|null=null;if(input.origin==="routine"&&input.routineId){parentId=generatedId("routine_occurrence");const parent=await client.query<{id:string}>(`INSERT INTO routine_occurrences (id,workspace_id,routine_id,due_date,audience_key,area_name_snapshot,routine_title_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (workspace_id,routine_id,due_date,audience_key) DO UPDATE SET id=routine_occurrences.id RETURNING id`,[parentId,input.workspaceId,input.routineId,input.dueDate,audienceKey,areaName,routineTitle]);parentId=parent.rows[0]!.id;}
  if(input.origin==="routine"&&input.routineId){const existing=await client.query<TaskRow>("SELECT * FROM task_occurrences WHERE workspace_id=$1 AND routine_id=$2 AND routine_step_id=$3 AND due_date=$4 AND audience_key=$5 AND archived_at IS NULL",[input.workspaceId,input.routineId,stepId,input.dueDate,audienceKey]);if(existing.rows[0])return (await hydrateTasks(client,existing.rows))[0]!;}
  const id=generatedId("task");const inserted=await client.query<TaskRow>(`INSERT INTO task_occurrences (id,workspace_id,origin,routine_id,routine_step_id,area_id,process_id,assignee_profile_id,audience_key,title,area_name_snapshot,routine_title_snapshot,step_title_snapshot,due_hint,approval_mode,evidence_policy,status,due_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,[id,input.workspaceId,input.origin,input.routineId,stepId,input.areaId??null,input.processId,input.assigneeProfileId,audienceKey,input.title,areaName,routineTitle,stepTitle,input.dueHint??null,input.approvalMode,input.evidencePolicy,input.status,input.dueDate]);
  const taskId=inserted.rows[0]!.id;await replaceChecklist(client,input.workspaceId,taskId,input.checklistItems??[]);await audit(client,input.workspaceId,"task_occurrence",taskId,"create",input.submittedByProfileId,{routineOccurrenceId:parentId});return (await hydrateTasks(client,inserted.rows))[0]!;
}
async function replaceChecklist(client:OperationalClient,workspaceId:string,taskId:string,items:TaskChecklistItem[]){for(const [index,item] of items.entries())await client.query(`INSERT INTO task_checklist_items (id,workspace_id,task_occurrence_id,title,sort_order,is_completed) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (workspace_id,task_occurrence_id,sort_order) DO UPDATE SET title=EXCLUDED.title,is_completed=EXCLUDED.is_completed,updated_at=NOW()`,[generatedId("checklist"),workspaceId,taskId,item.title,index+1,item.done]);await client.query("DELETE FROM task_checklist_items WHERE workspace_id=$1 AND task_occurrence_id=$2 AND sort_order>$3",[workspaceId,taskId,items.length]);}
async function appendEvidence(client:OperationalClient,task:TaskOccurrence){
  const latest=await client.query<EvidenceRow>("SELECT task_occurrence_id,kind,comment,photo_url,created_at FROM task_evidence WHERE workspace_id=$1 AND task_occurrence_id=$2 ORDER BY created_at DESC,id DESC",[task.workspaceId,task.id]);
  const latestComment=latest.rows.find(item=>item.kind==="comment")?.comment??null;
  const latestPhoto=latest.rows.find(item=>item.kind==="photo")?.photo_url??null;
  if(task.evidence?.comment&&task.evidence.comment!==latestComment)await client.query(`INSERT INTO task_evidence (id,workspace_id,task_occurrence_id,profile_id,kind,comment) VALUES ($1,$2,$3,$4,'comment',$5)`,[generatedId("evidence"),task.workspaceId,task.id,task.submittedByProfileId??task.reviewedByProfileId??"system",task.evidence.comment]);
  if(task.evidence?.photoUrl&&task.evidence.photoUrl!==latestPhoto)await client.query(`INSERT INTO task_evidence (id,workspace_id,task_occurrence_id,profile_id,kind,photo_url) VALUES ($1,$2,$3,$4,'photo',$5)`,[generatedId("evidence"),task.workspaceId,task.id,task.submittedByProfileId??task.reviewedByProfileId??"system",task.evidence.photoUrl]);
}
