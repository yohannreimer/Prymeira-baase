import type { CompanyRoutine, RoutineRepository, RoutineTaskTemplate, TaskChecklistItem, TaskOccurrence } from "./routine.types";
import { normalizeRoutineRecurrence } from "./routine-recurrence";
import { audit, generatedId, lockActiveAreaReference, lockWorkspaceOperationalMutation, withOperationalTransaction, iso, type OperationalClient, type OperationalPool } from "../../db/operational-repository-support";

type RoutineRow = { id:string;workspace_id:string;area_id:string|null;title:string;status:"active"|"archived";frequency:CompanyRoutine["frequency"];weekdays:string[];execution_mode:CompanyRoutine["executionMode"];approval_mode:CompanyRoutine["approvalMode"];evidence_policy:CompanyRoutine["evidencePolicy"];due_hint:string|null;created_by_profile_id:string;created_at:string|Date;updated_at:string|Date };
type StepRow = { id:string;workspace_id:string;routine_id:string;title:string;process_id:string|null;due_hint:string|null;approval_mode:RoutineTaskTemplate["approvalMode"];evidence_policy:RoutineTaskTemplate["evidencePolicy"];sort_order:number };
type AssignmentRow = { routine_id:string;routine_step_id:string|null;profile_id:string|null };
type TaskRow = { id:string;workspace_id:string;origin:TaskOccurrence["origin"];routine_id:string|null;routine_step_id:string|null;source_template_key:string|null;area_id:string|null;process_id:string|null;assignee_profile_id:string|null;audience_key:string|null;title:string;area_name_snapshot:string|null;routine_title_snapshot:string|null;step_title_snapshot:string;routine_revision_snapshot:string|Date|null;due_hint:string|null;approval_mode:TaskOccurrence["approvalMode"];evidence_policy:TaskOccurrence["evidencePolicy"];status:TaskOccurrence["status"];due_date:string|Date;submitted_by_profile_id:string|null;submitted_at:string|Date|null;reviewed_by_profile_id:string|null;reviewed_at:string|Date|null;review_comment:string|null;created_at:string|Date;updated_at:string|Date };
type ChecklistRow = { task_occurrence_id:string;title:string;is_completed:boolean;sort_order:number };
type EvidenceRow = { task_occurrence_id:string;kind:"comment"|"photo";comment:string|null;photo_url:string|null;object_key:string|null;file_name:string|null;content_type:string|null;size_bytes:number|null;created_at:string|Date };
type ParentRow = { routine_id:string;due_date:string|Date;audience_key:string;area_name_snapshot:string|null;routine_title_snapshot:string;routine_updated_at_snapshot:string|Date|null };

async function hydrateRoutines(db: Pick<OperationalPool,"query">|Pick<OperationalClient,"query">, rows: RoutineRow[]) {
  if (!rows.length) return [];
  const workspaceId=rows[0]!.workspace_id, ids=rows.map(row=>row.id);
  const stepsResult=await db.query<StepRow>("SELECT * FROM routine_steps WHERE workspace_id=$1 AND routine_id=ANY($2::text[]) AND archived_at IS NULL ORDER BY sort_order",[workspaceId,ids]);
  const assignmentsResult=await db.query<AssignmentRow>("SELECT routine_id,routine_step_id,profile_id FROM routine_assignments WHERE workspace_id=$1 AND routine_id=ANY($2::text[]) AND profile_id IS NOT NULL",[workspaceId,ids]);
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
  const checkResult=await db.query<ChecklistRow>("SELECT task_occurrence_id,title,is_completed,sort_order FROM task_checklist_items WHERE workspace_id=$1 AND task_occurrence_id=ANY($2::text[]) ORDER BY sort_order",[workspaceId,ids]);
  const evidenceResult=await db.query<EvidenceRow>("SELECT task_occurrence_id,kind,comment,photo_url,object_key,file_name,content_type,size_bytes,created_at FROM task_evidence WHERE workspace_id=$1 AND task_occurrence_id=ANY($2::text[]) AND archived_at IS NULL ORDER BY created_at DESC,id DESC",[workspaceId,ids]);
  return rows.map((row):TaskOccurrence=>{
    const evidenceRows=evidenceResult.rows.filter(item=>item.task_occurrence_id===row.id);
    const comment=evidenceRows.find(item=>item.kind==="comment")?.comment??null;
    const attachmentRow=evidenceRows.find(item=>item.kind==="photo"&&item.object_key&&item.file_name&&item.content_type&&item.size_bytes!==null);
    const photoUrl=evidenceRows.find(item=>item.kind==="photo"&&!item.object_key)?.photo_url??null;
    const attachment=attachmentRow?{objectKey:attachmentRow.object_key!,fileName:attachmentRow.file_name!,contentType:attachmentRow.content_type!,sizeBytes:attachmentRow.size_bytes!}:null;
    const dueDate=dateOnly(row.due_date);
    return { id:row.id,workspaceId:row.workspace_id,origin:row.origin,routineId:row.routine_id,
      taskTemplateId:row.source_template_key??row.routine_step_id,title:row.title,areaId:row.area_id,processId:row.process_id,
      assigneeProfileId:row.assignee_profile_id,dueHint:row.due_hint,approvalMode:row.approval_mode,
      evidencePolicy:row.evidence_policy,status:row.status,dueDate,evidence:comment||photoUrl||attachment?{comment,photoUrl,attachment}:null,
      checklistItems:checkResult.rows.filter(item=>item.task_occurrence_id===row.id).map(item=>({title:item.title,done:item.is_completed})),
      areaNameSnapshot:row.area_name_snapshot,routineTitleSnapshot:row.routine_title_snapshot,stepTitleSnapshot:row.step_title_snapshot,
      routineRevisionSnapshot:row.routine_revision_snapshot?iso(row.routine_revision_snapshot):null,
      submittedByProfileId:row.submitted_by_profile_id,submittedAt:row.submitted_at?iso(row.submitted_at):null,
      reviewedByProfileId:row.reviewed_by_profile_id,reviewedAt:row.reviewed_at?iso(row.reviewed_at):null,
      reviewComment:row.review_comment,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at) };
  });
}

function dateOnly(value:string|Date){return value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);}

export function createPostgresRoutineRepository(db:OperationalPool):RoutineRepository {
  return {
    async listRoutines(workspaceId,filters={}){const params:unknown[]=[workspaceId];let sql="SELECT * FROM routines WHERE workspace_id=$1 AND archived_at IS NULL ORDER BY created_at,id";if(filters.limit){params.push(filters.limit);sql+=` LIMIT $${params.length}`;}const r=await db.query<RoutineRow>(sql,params);return hydrateRoutines(db,r.rows);},
    async findRoutine(workspaceId,routineId){const r=await db.query<RoutineRow>("SELECT * FROM routines WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",[workspaceId,routineId]);return (await hydrateRoutines(db,r.rows))[0]??null;},
    async createRoutine(input){return withOperationalTransaction(db,async client=>{
      await lockWorkspaceOperationalMutation(client,input.workspaceId);
      await lockActiveAreaReference(client,input.workspaceId,input.areaId);
      const id=input.id??generatedId("routine");
      const recurrence=normalizeRoutineRecurrence(input);
      await client.query(`INSERT INTO routines (id,workspace_id,area_id,title,status,frequency,weekdays,month_day,execution_mode,approval_mode,evidence_policy,due_hint,created_by_profile_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[id,input.workspaceId,input.areaId,input.title,input.status,recurrence.frequency,recurrence.weekdays,recurrence.frequency==="monthly"?1:null,input.executionMode??"shared",input.approvalMode??"direct",input.evidencePolicy??"optional",input.dueHint??null,input.createdByProfileId]);
      for(const template of input.taskTemplates) await insertStepAndAssignment(client,id,{...template,id:template.id.replace("__routine__",id),routineId:id});
      await replaceGeneralAssignments(client,input.workspaceId,id,input.assigneeProfileIds??[]);
      await audit(client,input.workspaceId,"routine",id,"create",input.createdByProfileId);
      const row=await client.query<RoutineRow>("SELECT * FROM routines WHERE workspace_id=$1 AND id=$2",[input.workspaceId,id]);
      return (await hydrateRoutines(client,row.rows))[0]!;
    });},
    async updateRoutine(routine){return withOperationalTransaction(db,async client=>{
      await lockWorkspaceOperationalMutation(client,routine.workspaceId);
      await lockActiveAreaReference(client,routine.workspaceId,routine.areaId);
      const persisted=await client.query<RoutineRow>("SELECT * FROM routines WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE",[routine.workspaceId,routine.id]);
      if(!persisted.rows[0])throw new Error("ROUTINE_NOT_FOUND");
      if(iso(persisted.rows[0].updated_at)!==routine.updatedAt)throw new Error("ROUTINE_STALE");
      const recurrence=normalizeRoutineRecurrence(routine);
      const result=await client.query<RoutineRow>(`UPDATE routines SET area_id=$3,title=$4,status=$5,frequency=$6,weekdays=$7,month_day=$8,execution_mode=$9,approval_mode=$10,evidence_policy=$11,due_hint=$12,archived_at=CASE WHEN $5='archived' THEN COALESCE(archived_at,NOW()) ELSE archived_at END,updated_at=GREATEST(NOW(),updated_at+INTERVAL '1 millisecond')
        WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL RETURNING *`,[routine.workspaceId,routine.id,routine.areaId,routine.title,routine.status,recurrence.frequency,recurrence.weekdays,recurrence.frequency==="monthly"?1:null,routine.executionMode??"shared",routine.approvalMode??"direct",routine.evidencePolicy??"optional",routine.dueHint??null]);
      if(!result.rows[0])throw new Error("ROUTINE_NOT_FOUND");
      const activeIds=routine.taskTemplates.map(item=>item.id);
      const ownedSteps=await client.query<{id:string;routine_id:string}>("SELECT id,routine_id FROM routine_steps WHERE workspace_id=$1 AND id=ANY($2::text[])",[routine.workspaceId,activeIds]);
      if(ownedSteps.rows.some(step=>step.routine_id!==routine.id))throw new Error("ROUTINE_TASK_ID_INVALID");
      await client.query("UPDATE routine_steps SET sort_order=sort_order+1000000,updated_at=NOW() WHERE workspace_id=$1 AND routine_id=$2 AND archived_at IS NULL",[routine.workspaceId,routine.id]);
      await client.query("UPDATE routine_steps SET archived_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND routine_id=$2 AND archived_at IS NULL AND NOT (id=ANY($3::text[]))",[routine.workspaceId,routine.id,activeIds]);
      for(const template of routine.taskTemplates) await upsertStepAndAssignment(client,template);
      await replaceGeneralAssignments(client,routine.workspaceId,routine.id,routine.assigneeProfileIds??[]);
      await audit(client,routine.workspaceId,"routine",routine.id,routine.status==="archived"?"archive":"update",routine.createdByProfileId);
      return (await hydrateRoutines(client,result.rows))[0]!;
    });},
    async deleteRoutine(workspaceId,routineId){await withOperationalTransaction(db,async client=>{await lockWorkspaceOperationalMutation(client,workspaceId);await client.query("UPDATE routines SET status='archived',archived_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",[workspaceId,routineId]);await audit(client,workspaceId,"routine",routineId,"archive");});},
    async listTaskOccurrences(workspaceId,filters={}){const params:unknown[]=[workspaceId];let sql="SELECT * FROM task_occurrences WHERE workspace_id=$1 AND archived_at IS NULL";if(filters.dueDate){params.push(filters.dueDate);sql+=` AND due_date=$${params.length}`;}if(filters.assigneeProfileIds?.length){params.push(filters.assigneeProfileIds);sql+=` AND assignee_profile_id=ANY($${params.length}::text[])`;}if(filters.operationalFrom&&filters.operationalTo){params.push(filters.operationalFrom,filters.operationalTo);const from=`$${params.length-1}`;const to=`$${params.length}`;sql+=` AND (due_date BETWEEN ${from} AND ${to} OR (status='completed' AND (COALESCE(reviewed_at,submitted_at,updated_at) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${from}::date AND ${to}::date) OR (reviewed_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${from}::date AND ${to}::date)`;}sql+=" ORDER BY created_at,id";if(filters.limit){params.push(filters.limit);sql+=` LIMIT $${params.length}`;}const r=await db.query<TaskRow>(sql,params);return hydrateTasks(db,r.rows);},
    async findTaskOccurrence(workspaceId,taskId){const r=await db.query<TaskRow>("SELECT * FROM task_occurrences WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",[workspaceId,taskId]);return (await hydrateTasks(db,r.rows))[0]??null;},
    async findTaskOccurrenceForTemplate(workspaceId,routineId,taskTemplateId,dueDate){
      const individualPrefix=`${routineId}__execution__`;
      const r=taskTemplateId.startsWith(individualPrefix)
        ? await db.query<TaskRow>("SELECT * FROM task_occurrences WHERE workspace_id=$1 AND routine_id=$2 AND due_date=$3 AND audience_key=$4 AND archived_at IS NULL",[workspaceId,routineId,dueDate,taskTemplateId.slice(individualPrefix.length)])
        : await db.query<TaskRow>("SELECT * FROM task_occurrences WHERE workspace_id=$1 AND routine_id=$2 AND routine_step_id=$3 AND due_date=$4 AND archived_at IS NULL",[workspaceId,routineId,taskTemplateId,dueDate]);
      return (await hydrateTasks(db,r.rows))[0]??null;
    },
    async createTaskOccurrence(input){return withOperationalTransaction(db,async client=>{await lockWorkspaceOperationalMutation(client,input.workspaceId);return createOrReuseTask(client,input);});},
    async reconcileRoutineOccurrences(routine,dueDate,desired){return withOperationalTransaction(db,async client=>{
      await lockWorkspaceOperationalMutation(client,routine.workspaceId);
      const persistedRoutine=await client.query<RoutineRow>("SELECT * FROM routines WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE",[routine.workspaceId,routine.id]);
      if(!persistedRoutine.rows[0])throw new Error("ROUTINE_NOT_FOUND");
      if(iso(persistedRoutine.rows[0].updated_at)!==routine.updatedAt)throw new Error("ROUTINE_STALE");

      const persisted=await client.query<TaskRow>("SELECT * FROM task_occurrences WHERE workspace_id=$1 AND routine_id=$2 AND due_date=$3 AND archived_at IS NULL FOR UPDATE",[routine.workspaceId,routine.id,dueDate]);
      const existingByKey=new Map(persisted.rows.map(task=>[routineOccurrenceKey(task.source_template_key??task.routine_step_id,task.assignee_profile_id),task]));
      const desiredByKey=new Map(desired.map(task=>[routineOccurrenceKey(task.taskTemplateId,task.assigneeProfileId),task]));
      const changedAudiences=new Set<string>();
      const evidence=await client.query<{task_occurrence_id:string;object_key:string}>("SELECT task_occurrence_id,object_key FROM task_evidence WHERE workspace_id=$1 AND task_occurrence_id=ANY($2::text[]) AND object_key IS NOT NULL AND archived_at IS NULL",[routine.workspaceId,persisted.rows.map(task=>task.id)]);
      const objectKeyByTaskId=new Map(evidence.rows.map(item=>[item.task_occurrence_id,item.object_key]));
      const removedObjectKeys=new Set<string>();

      for(const [key,input] of desiredByKey){
        const existing=existingByKey.get(key);
        if(!existing){await createOrReuseTask(client,input);changedAudiences.add(input.assigneeProfileId??"shared");continue;}
        if(existing.status!=="pending"||existing.submitted_at!==null)continue;
        if(await reconcilePendingRoutineTask(client,existing,input,persistedRoutine.rows[0])) {
          changedAudiences.add(input.assigneeProfileId??"shared");
        }
      }
      for(const [key,task] of existingByKey){
        if(desiredByKey.has(key)||task.status!=="pending"||task.submitted_at!==null)continue;
        const archived=await client.query<{id:string}>("UPDATE task_occurrences SET archived_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL AND status='pending' AND submitted_at IS NULL RETURNING id",[routine.workspaceId,task.id]);
        if(archived.rows[0]){changedAudiences.add(task.audience_key??"shared");const objectKey=objectKeyByTaskId.get(task.id);if(objectKey)removedObjectKeys.add(objectKey);await audit(client,routine.workspaceId,"task_occurrence",task.id,"archive");}
      }
      for(const audienceKey of changedAudiences){
        const sample=desired.find(task=>(task.assigneeProfileId??"shared")===audienceKey);
        const areaId=sample?.areaId??routine.areaId;
        const area=areaId?await client.query<{name:string}>("SELECT name FROM areas WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",[routine.workspaceId,areaId]):{rows:[]};
        const parent=await client.query<ParentRow>("SELECT routine_id,due_date,audience_key,area_name_snapshot,routine_title_snapshot,routine_updated_at_snapshot FROM routine_occurrences WHERE workspace_id=$1 AND routine_id=$2 AND due_date=$3 AND audience_key=$4",[routine.workspaceId,routine.id,dueDate,audienceKey]);
        if(!parent.rows[0]){
          await client.query("INSERT INTO routine_occurrences (id,workspace_id,routine_id,due_date,audience_key,area_name_snapshot,routine_title_snapshot,routine_updated_at_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",[generatedId("routine_occurrence"),routine.workspaceId,routine.id,dueDate,audienceKey,area.rows[0]?.name??null,persistedRoutine.rows[0].title,routine.updatedAt]);
        } else if(parent.rows[0].area_name_snapshot!==(area.rows[0]?.name??null)
          || parent.rows[0].routine_title_snapshot!==persistedRoutine.rows[0].title
          || (parent.rows[0].routine_updated_at_snapshot?iso(parent.rows[0].routine_updated_at_snapshot):null)!==routine.updatedAt) {
          await client.query("UPDATE routine_occurrences SET area_name_snapshot=$5,routine_title_snapshot=$6,routine_updated_at_snapshot=$7 WHERE workspace_id=$1 AND routine_id=$2 AND due_date=$3 AND audience_key=$4",[routine.workspaceId,routine.id,dueDate,audienceKey,area.rows[0]?.name??null,persistedRoutine.rows[0].title,routine.updatedAt]);
        }
      }
      const result=await client.query<TaskRow>("SELECT * FROM task_occurrences WHERE workspace_id=$1 AND routine_id=$2 AND due_date=$3 AND archived_at IS NULL ORDER BY created_at,id",[routine.workspaceId,routine.id,dueDate]);
      const referenced=removedObjectKeys.size?await client.query<{object_key:string}>("SELECT DISTINCT evidence.object_key FROM task_evidence evidence JOIN task_occurrences task ON task.workspace_id=evidence.workspace_id AND task.id=evidence.task_occurrence_id WHERE evidence.workspace_id=$1 AND evidence.object_key=ANY($2::text[]) AND evidence.archived_at IS NULL AND task.archived_at IS NULL",[routine.workspaceId,[...removedObjectKeys]]):{rows:[]};
      const referencedObjectKeys=new Set(referenced.rows.map(item=>item.object_key));
      return {tasks:await hydrateTasks(client,result.rows),removedObjectKeys:[...removedObjectKeys].filter(objectKey=>!referencedObjectKeys.has(objectKey))};
    });},
    async updateTaskOccurrence(task){return withOperationalTransaction(db,async client=>{
      await lockWorkspaceOperationalMutation(client,task.workspaceId);
      const persisted=await client.query<TaskRow>("SELECT * FROM task_occurrences WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE",[task.workspaceId,task.id]);
      if(!persisted.rows[0])throw new Error("TASK_NOT_FOUND");
      if(iso(persisted.rows[0].updated_at)!==task.updatedAt)throw new Error("TASK_OCCURRENCE_STALE");
      if((persisted.rows[0].area_id??null)!==(task.areaId??null))await lockActiveAreaReference(client,task.workspaceId,task.areaId);
      const result=await client.query<TaskRow>(`UPDATE task_occurrences SET title=$3,area_id=$4,process_id=$5,assignee_profile_id=$6,due_hint=$7,approval_mode=$8,evidence_policy=$9,status=$10,due_date=$11,submitted_by_profile_id=$12,submitted_at=$13,reviewed_by_profile_id=$14,reviewed_at=$15,review_comment=$16,completed_at=CASE WHEN $10='completed' THEN COALESCE(completed_at,NOW()) ELSE completed_at END,updated_at=GREATEST(NOW(),updated_at+INTERVAL '1 millisecond')
        WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL RETURNING *`,[task.workspaceId,task.id,task.title,task.areaId??null,task.processId,task.assigneeProfileId,task.dueHint??null,task.approvalMode,task.evidencePolicy,task.status,task.dueDate,task.submittedByProfileId,task.submittedAt,task.reviewedByProfileId,task.reviewedAt,task.reviewComment]);
      await replaceChecklist(client,task.workspaceId,task.id,task.checklistItems??[]);
      await replaceEvidence(client,task);
      const attribution=taskAuditAttribution(persisted.rows[0],task);
      await audit(client,task.workspaceId,"task_occurrence",task.id,attribution.action,attribution.actorProfileId);
      return (await hydrateTasks(client,result.rows))[0]!;
    });},
    async deleteTaskOccurrence(workspaceId,taskId){return withOperationalTransaction(db,async client=>{await lockWorkspaceOperationalMutation(client,workspaceId);const result=await client.query<{id:string}>("UPDATE task_occurrences SET archived_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL AND status='pending' AND submitted_at IS NULL RETURNING id",[workspaceId,taskId]);if(!result.rows[0])return false;await audit(client,workspaceId,"task_occurrence",taskId,"archive");return true;});}
  };
}

async function insertStepAndAssignment(client:OperationalClient,routineId:string,step:RoutineTaskTemplate){await client.query(`INSERT INTO routine_steps (id,workspace_id,routine_id,title,process_id,due_hint,approval_mode,evidence_policy,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[step.id,step.workspaceId,routineId,step.title,step.processId,step.dueHint??null,step.approvalMode,step.evidencePolicy,step.sortOrder]);if(step.assigneeProfileId)await client.query(`INSERT INTO routine_assignments (id,workspace_id,routine_id,routine_step_id,profile_id) VALUES ($1,$2,$3,$4,$5)`,[generatedId("assignment"),step.workspaceId,routineId,step.id,step.assigneeProfileId]);}
async function upsertStepAndAssignment(client:OperationalClient,step:RoutineTaskTemplate){await client.query(`INSERT INTO routine_steps (id,workspace_id,routine_id,title,process_id,due_hint,approval_mode,evidence_policy,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (workspace_id,id) DO UPDATE SET title=EXCLUDED.title,process_id=EXCLUDED.process_id,due_hint=EXCLUDED.due_hint,approval_mode=EXCLUDED.approval_mode,evidence_policy=EXCLUDED.evidence_policy,sort_order=EXCLUDED.sort_order,archived_at=NULL,updated_at=NOW()`,[step.id,step.workspaceId,step.routineId,step.title,step.processId,step.dueHint??null,step.approvalMode,step.evidencePolicy,step.sortOrder]);await client.query("DELETE FROM routine_assignments WHERE workspace_id=$1 AND routine_id=$2 AND routine_step_id=$3",[step.workspaceId,step.routineId,step.id]);if(step.assigneeProfileId)await client.query(`INSERT INTO routine_assignments (id,workspace_id,routine_id,routine_step_id,profile_id) VALUES ($1,$2,$3,$4,$5)`,[generatedId("assignment"),step.workspaceId,step.routineId,step.id,step.assigneeProfileId]);}
async function replaceGeneralAssignments(client:OperationalClient,workspaceId:string,routineId:string,ids:string[]){await client.query("DELETE FROM routine_assignments WHERE workspace_id=$1 AND routine_id=$2 AND routine_step_id IS NULL",[workspaceId,routineId]);for(const id of ids)await client.query(`INSERT INTO routine_assignments (id,workspace_id,routine_id,profile_id) VALUES ($1,$2,$3,$4)`,[generatedId("assignment"),workspaceId,routineId,id]);}

async function createOrReuseTask(client:OperationalClient,input:Omit<TaskOccurrence,"id"|"createdAt"|"updatedAt">&{id?:string}){
  await lockActiveAreaReference(client,input.workspaceId,input.areaId);
  const origin=input.origin??(input.routineId?"routine":"manual");
  const sourceTemplateKey=input.taskTemplateId;
  let stepId=sourceTemplateKey,audienceKey:string|null=null;
  let areaName=input.areaNameSnapshot??null,routineTitle=input.routineTitleSnapshot??null,stepTitle=input.stepTitleSnapshot??input.title;
  let routineRevision=input.routineRevisionSnapshot??null;
  if(origin==="routine"&&input.routineId){const routine=await client.query<RoutineRow>("SELECT * FROM routines WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",[input.workspaceId,input.routineId]);if(!routine.rows[0])throw new Error("ROUTINE_NOT_FOUND");routineTitle=input.routineTitleSnapshot===undefined?routine.rows[0].title:routineTitle;routineRevision=input.routineRevisionSnapshot===undefined?iso(routine.rows[0].updated_at):routineRevision;audienceKey=input.assigneeProfileId??"shared";const area= input.areaId ? await client.query<{name:string}>("SELECT name FROM areas WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",[input.workspaceId,input.areaId]):{rows:[]};areaName=input.areaNameSnapshot===undefined?(area.rows[0]?.name??null):areaName;if(stepId?.includes("__execution__")){const first=await client.query<StepRow>("SELECT * FROM routine_steps WHERE workspace_id=$1 AND routine_id=$2 AND archived_at IS NULL ORDER BY sort_order LIMIT 1",[input.workspaceId,input.routineId]);stepId=first.rows[0]?.id??null;}}
  let parentId:string|null=null;if(origin==="routine"&&input.routineId){parentId=generatedId("routine_occurrence");const parent=await client.query<{id:string}>(`INSERT INTO routine_occurrences (id,workspace_id,routine_id,due_date,audience_key,area_name_snapshot,routine_title_snapshot,routine_updated_at_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (workspace_id,routine_id,due_date,audience_key) DO NOTHING RETURNING id`,[parentId,input.workspaceId,input.routineId,input.dueDate,audienceKey,areaName,routineTitle,routineRevision]);if(parent.rows[0])parentId=parent.rows[0].id;else {const existingParent=await client.query<{id:string}>("SELECT id FROM routine_occurrences WHERE workspace_id=$1 AND routine_id=$2 AND due_date=$3 AND audience_key=$4",[input.workspaceId,input.routineId,input.dueDate,audienceKey]);parentId=existingParent.rows[0]?.id??null;}}
  if(origin==="routine"&&input.routineId){const existing=await client.query<TaskRow>("SELECT * FROM task_occurrences WHERE workspace_id=$1 AND routine_id=$2 AND (source_template_key=$3 OR (source_template_key IS NULL AND routine_step_id=$4)) AND due_date=$5 AND audience_key=$6 AND archived_at IS NULL",[input.workspaceId,input.routineId,sourceTemplateKey,stepId,input.dueDate,audienceKey]);if(existing.rows[0])return (await hydrateTasks(client,existing.rows))[0]!;}
  const id=input.id??generatedId("task");const inserted=await client.query<TaskRow>(`INSERT INTO task_occurrences (id,workspace_id,origin,routine_id,routine_step_id,source_template_key,area_id,process_id,assignee_profile_id,audience_key,title,area_name_snapshot,routine_title_snapshot,step_title_snapshot,routine_revision_snapshot,due_hint,approval_mode,evidence_policy,status,due_date,submitted_by_profile_id,submitted_at,reviewed_by_profile_id,reviewed_at,review_comment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING *`,[id,input.workspaceId,origin,input.routineId,stepId,sourceTemplateKey,input.areaId??null,input.processId,input.assigneeProfileId,audienceKey,input.title,areaName,routineTitle,stepTitle,routineRevision,input.dueHint??null,input.approvalMode,input.evidencePolicy,input.status,input.dueDate,input.submittedByProfileId,input.submittedAt,input.reviewedByProfileId,input.reviewedAt,input.reviewComment]);
  const taskId=inserted.rows[0]!.id;await replaceChecklist(client,input.workspaceId,taskId,input.checklistItems??[]);await replaceEvidence(client,{...input,id:taskId,createdAt:"",updatedAt:""});await audit(client,input.workspaceId,"task_occurrence",taskId,"create",input.submittedByProfileId??input.reviewedByProfileId,{routineOccurrenceId:parentId});return (await hydrateTasks(client,inserted.rows))[0]!;
}

function routineOccurrenceKey(sourceTemplateKey:string|null,assigneeProfileId:string|null){return `${sourceTemplateKey??"__shared"}__${assigneeProfileId??"shared"}`;}

async function reconcilePendingRoutineTask(client:OperationalClient,persisted:TaskRow,input:Omit<TaskOccurrence,"id"|"createdAt"|"updatedAt">,routine:RoutineRow){
  const area=input.areaId?await client.query<{name:string}>("SELECT name FROM areas WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL",[input.workspaceId,input.areaId]):{rows:[]};
  const sourceTemplateKey=input.taskTemplateId;
  let stepId=sourceTemplateKey;
  if(sourceTemplateKey?.startsWith(`${input.routineId}__execution__`)){
    const first=await client.query<StepRow>("SELECT * FROM routine_steps WHERE workspace_id=$1 AND routine_id=$2 AND archived_at IS NULL ORDER BY sort_order LIMIT 1",[input.workspaceId,input.routineId]);
    stepId=first.rows[0]?.id??null;
  }
  const routineRevision=iso(routine.updated_at);
  const revisionChanged=(persisted.routine_revision_snapshot?iso(persisted.routine_revision_snapshot):null)!==routineRevision;
  const sameConfiguration=persisted.routine_step_id===stepId
    && persisted.source_template_key===sourceTemplateKey
    && persisted.area_id===(input.areaId??null)
    && persisted.process_id===input.processId
    && persisted.assignee_profile_id===input.assigneeProfileId
    && persisted.audience_key===(input.assigneeProfileId??"shared")
    && persisted.title===input.title
    && persisted.area_name_snapshot===(area.rows[0]?.name??null)
    && persisted.routine_title_snapshot===routine.title
    && persisted.step_title_snapshot===input.title
    && persisted.due_hint===(input.dueHint??null)
    && persisted.approval_mode===input.approvalMode
    && persisted.evidence_policy===input.evidencePolicy;
  if(!revisionChanged&&sameConfiguration)return false;
  await lockActiveAreaReference(client,input.workspaceId,input.areaId??null);
  await client.query(`UPDATE task_occurrences SET routine_step_id=$3,source_template_key=$4,area_id=$5,process_id=$6,assignee_profile_id=$7,audience_key=$8,title=$9,area_name_snapshot=$10,routine_title_snapshot=$11,step_title_snapshot=$12,routine_revision_snapshot=$13,due_hint=$14,approval_mode=$15,evidence_policy=$16,updated_at=GREATEST(NOW(),updated_at+INTERVAL '1 millisecond')
    WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL AND status='pending' AND submitted_at IS NULL`,[input.workspaceId,persisted.id,stepId,sourceTemplateKey,input.areaId??null,input.processId,input.assigneeProfileId,input.assigneeProfileId??"shared",input.title,area.rows[0]?.name??null,routine.title,input.title,routineRevision,input.dueHint??null,input.approvalMode,input.evidencePolicy]);
  if(revisionChanged)await replaceChecklist(client,input.workspaceId,persisted.id,input.checklistItems??[]);
  return true;
}

function taskAuditAttribution(previous:TaskRow,next:TaskOccurrence){
  const reviewChanged=previous.reviewed_by_profile_id!==next.reviewedByProfileId
    || timestamp(previous.reviewed_at)!==timestamp(next.reviewedAt);
  if(reviewChanged&&next.reviewedByProfileId){
    const action=next.status==="completed"?"approve":next.status==="needs_adjustment"?"return":"review";
    return {action,actorProfileId:next.reviewedByProfileId};
  }
  const submissionChanged=previous.submitted_by_profile_id!==next.submittedByProfileId
    || timestamp(previous.submitted_at)!==timestamp(next.submittedAt);
  if(submissionChanged&&next.submittedByProfileId)return {action:"submit",actorProfileId:next.submittedByProfileId};
  return {action:"update",actorProfileId:null};
}

function timestamp(value:string|Date|null){return value?iso(value):null;}
async function replaceChecklist(client:OperationalClient,workspaceId:string,taskId:string,items:TaskChecklistItem[]){for(const [index,item] of items.entries())await client.query(`INSERT INTO task_checklist_items (id,workspace_id,task_occurrence_id,title,sort_order,is_completed) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (workspace_id,task_occurrence_id,sort_order) DO UPDATE SET title=EXCLUDED.title,is_completed=EXCLUDED.is_completed,updated_at=NOW()`,[generatedId("checklist"),workspaceId,taskId,item.title,index+1,item.done]);await client.query("DELETE FROM task_checklist_items WHERE workspace_id=$1 AND task_occurrence_id=$2 AND sort_order>$3",[workspaceId,taskId,items.length]);}
async function replaceEvidence(client:OperationalClient,task:TaskOccurrence){
  const latest=await client.query<EvidenceRow>("SELECT task_occurrence_id,kind,comment,photo_url,object_key,file_name,content_type,size_bytes,created_at FROM task_evidence WHERE workspace_id=$1 AND task_occurrence_id=$2 AND archived_at IS NULL ORDER BY created_at DESC,id DESC",[task.workspaceId,task.id]);
  const latestComment=latest.rows.find(item=>item.kind==="comment")?.comment??null;
  const latestPhoto=latest.rows.find(item=>item.kind==="photo"&&!item.object_key)?.photo_url??null;
  const latestAttachment=latest.rows.find(item=>item.kind==="photo"&&item.object_key&&item.file_name&&item.content_type&&item.size_bytes!==null);
  const nextComment=task.evidence?.comment??null,nextPhoto=task.evidence?.photoUrl??null,nextAttachment=task.evidence?.attachment??null;
  if(nextComment===latestComment&&nextPhoto===latestPhoto&&sameAttachment(nextAttachment,latestAttachment))return;
  await client.query("UPDATE task_evidence SET archived_at=NOW() WHERE workspace_id=$1 AND task_occurrence_id=$2 AND archived_at IS NULL",[task.workspaceId,task.id]);
  if(nextComment)await client.query(`INSERT INTO task_evidence (id,workspace_id,task_occurrence_id,profile_id,kind,comment) VALUES ($1,$2,$3,$4,'comment',$5)`,[generatedId("evidence"),task.workspaceId,task.id,task.submittedByProfileId??task.reviewedByProfileId??"system",nextComment]);
  if(nextPhoto)await client.query(`INSERT INTO task_evidence (id,workspace_id,task_occurrence_id,profile_id,kind,photo_url) VALUES ($1,$2,$3,$4,'photo',$5)`,[generatedId("evidence"),task.workspaceId,task.id,task.submittedByProfileId??task.reviewedByProfileId??"system",nextPhoto]);
  if(nextAttachment)await client.query(`INSERT INTO task_evidence (id,workspace_id,task_occurrence_id,profile_id,kind,photo_url,object_key,file_name,content_type,size_bytes) VALUES ($1,$2,$3,$4,'photo',NULL,$5,$6,$7,$8)`,[generatedId("evidence"),task.workspaceId,task.id,task.submittedByProfileId??task.reviewedByProfileId??"system",nextAttachment.objectKey,nextAttachment.fileName,nextAttachment.contentType,nextAttachment.sizeBytes]);
}
function sameAttachment(next:NonNullable<TaskOccurrence["evidence"]>["attachment"],row:EvidenceRow|undefined){return next?.objectKey===row?.object_key&&next?.fileName===row?.file_name&&next?.contentType===row?.content_type&&next?.sizeBytes===row?.size_bytes;}
