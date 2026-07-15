import { withOperationalTransaction, type OperationalPool } from "../../db/operational-repository-support";
import type {
  StudioDueRitualClaim,
  StudioProactiveSignal,
  StudioProactivitySettings,
  StudioProactivityStore
} from "./studio-proactivity.service";

type SettingsRow = {
  workspace_id: string;
  owner_profile_id: string;
  ritual_reminder_enabled: boolean;
  stale_goal_enabled: boolean;
  recurring_theme_enabled: boolean;
  decision_review_enabled: boolean;
  operational_change_enabled: boolean;
  focused_content_enabled: boolean;
  stale_goal_after_days: number;
  updated_at: string | Date;
};

type SignalRow = {
  id: string;
  workspace_id: string;
  owner_profile_id: string;
  signal_type: StudioProactiveSignal["type"];
  source_id: string;
  source_scheduled_for: string | Date;
  title: string;
  reason: string;
  status: "preparing" | "active" | "failed" | "dismissed";
  next_reminder_at: string | Date;
  claim_token: string | null;
  attempt_count: number;
  created_at: string | Date;
  updated_at: string | Date;
  dismissed_at: string | Date | null;
};

export function createPostgresStudioProactivityStore(db: OperationalPool): StudioProactivityStore {
  const readSettings = async (scope: { workspaceId: string; ownerProfileId: string }) => {
    const result = await db.query<SettingsRow>(
      `SELECT * FROM studio_proactivity_settings
        WHERE workspace_id=$1 AND owner_profile_id=$2`,
      [scope.workspaceId, scope.ownerProfileId]
    );
    return result.rows[0] ? settingsFromRow(result.rows[0]) : null;
  };

  return {
    async readSettings(scope) {
      return readSettings(scope);
    },

    async saveSettings(settings) {
      return withOperationalTransaction(db, async (client) => {
        const result = await client.query<SettingsRow>(
          `INSERT INTO studio_proactivity_settings
          (workspace_id,owner_profile_id,ritual_reminder_enabled,stale_goal_enabled,
           recurring_theme_enabled,decision_review_enabled,operational_change_enabled,
           focused_content_enabled,stale_goal_after_days,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (workspace_id,owner_profile_id) DO UPDATE SET
           ritual_reminder_enabled=EXCLUDED.ritual_reminder_enabled,
           stale_goal_enabled=EXCLUDED.stale_goal_enabled,
           recurring_theme_enabled=EXCLUDED.recurring_theme_enabled,
           decision_review_enabled=EXCLUDED.decision_review_enabled,
           operational_change_enabled=EXCLUDED.operational_change_enabled,
           focused_content_enabled=EXCLUDED.focused_content_enabled,
           stale_goal_after_days=EXCLUDED.stale_goal_after_days,
           updated_at=EXCLUDED.updated_at
         RETURNING *`,
          [settings.workspaceId, settings.ownerProfileId, settings.ritualReminder, settings.staleGoal,
            settings.recurringTheme, settings.decisionReview, settings.operationalChange,
            settings.focusedContent, settings.staleGoalAfterDays, settings.updatedAt]
        );
        await client.query(
          `UPDATE studio_proactive_signals
            SET status='dismissed',dismissed_at=$10,claim_token=NULL,claim_lease_expires_at=NULL,
                next_attempt_at=NULL,last_error_code='STUDIO_PROACTIVITY_DISABLED',updated_at=$10
          WHERE workspace_id=$1 AND owner_profile_id=$2 AND status IN ('preparing','active','failed')
            AND (
              (signal_type='ritual_reminder' AND $3=FALSE)
              OR (signal_type='stale_goal' AND $4=FALSE)
              OR (signal_type='recurring_theme' AND $5=FALSE)
              OR (signal_type='decision_review' AND $6=FALSE)
              OR (signal_type='operational_change' AND $7=FALSE)
              OR (signal_type='focused_content' AND $8=FALSE)
            )`,
          [settings.workspaceId, settings.ownerProfileId, settings.ritualReminder, settings.staleGoal,
            settings.recurringTheme, settings.decisionReview, settings.operationalChange,
            settings.focusedContent, settings.staleGoalAfterDays, settings.updatedAt]
        );
        return settingsFromRow(result.rows[0]!);
      });
    },

    async claimDueRituals(input) {
      return withOperationalTransaction(db, async (client) => {
        const reclaimed = await client.query<SignalRow>(
          `WITH ranked AS (
             SELECT signals.workspace_id,signals.owner_profile_id,signals.id,
                    COALESCE(signals.next_attempt_at,signals.claim_lease_expires_at) AS due_at,
                    ROW_NUMBER() OVER (PARTITION BY signals.workspace_id,signals.owner_profile_id
                      ORDER BY COALESCE(signals.next_attempt_at,signals.claim_lease_expires_at),
                               signals.source_scheduled_for,signals.id) AS owner_rank
               FROM studio_proactive_signals signals
               JOIN studio_proactivity_settings settings
                 ON settings.workspace_id=signals.workspace_id
                AND settings.owner_profile_id=signals.owner_profile_id
                AND settings.ritual_reminder_enabled=TRUE
              WHERE signals.signal_type='ritual_reminder'
                AND (
                  (signals.status='failed' AND signals.next_attempt_at IS NOT NULL AND signals.next_attempt_at <= $1)
                  OR (signals.status='preparing' AND signals.claim_lease_expires_at <= $1)
                )
           ), candidates AS (
             SELECT signals.workspace_id,signals.owner_profile_id,signals.id
               FROM studio_proactive_signals signals
               JOIN ranked ON ranked.workspace_id=signals.workspace_id
                AND ranked.owner_profile_id=signals.owner_profile_id AND ranked.id=signals.id
              WHERE ranked.owner_rank=1
              ORDER BY ranked.due_at,signals.id
              FOR UPDATE OF signals SKIP LOCKED
              LIMIT $2
           )
           UPDATE studio_proactive_signals signals
              SET status='preparing',claim_token=$3,claim_lease_expires_at=$4,
                  attempt_count=signals.attempt_count+1,next_attempt_at=NULL,
                  last_error_code=NULL,updated_at=$1
             FROM candidates
            WHERE signals.workspace_id=candidates.workspace_id
              AND signals.owner_profile_id=candidates.owner_profile_id
              AND signals.id=candidates.id
           RETURNING signals.*`,
          [input.now, input.limit, input.claimToken, input.claimLeaseExpiresAt]
        );
        const remaining = input.limit - reclaimed.rows.length;
        let inserted: SignalRow[] = [];
        if (remaining > 0) {
          const result = await client.query<SignalRow>(
            `WITH ranked AS (
               SELECT structures.workspace_id,structures.owner_profile_id,structures.id AS ritual_id,
                      structures.next_run_at AS scheduled_for,
                      COALESCE(NULLIF(BTRIM(documents.title),''),
                               NULLIF(BTRIM(structures.properties_json->>'intention'),''),
                               'Ritual privado') AS ritual_title,
                      ROW_NUMBER() OVER (PARTITION BY structures.workspace_id,structures.owner_profile_id
                        ORDER BY structures.next_run_at,structures.id) AS owner_rank
                 FROM studio_structures structures
                 JOIN studio_documents documents
                   ON documents.workspace_id=structures.workspace_id
                  AND documents.owner_profile_id=structures.owner_profile_id
                  AND documents.id=structures.document_id
                 JOIN studio_proactivity_settings settings
                   ON settings.workspace_id=structures.workspace_id
                  AND settings.owner_profile_id=structures.owner_profile_id
                  AND settings.ritual_reminder_enabled=TRUE
                 LEFT JOIN studio_proactive_signals existing
                   ON existing.workspace_id=structures.workspace_id
                  AND existing.owner_profile_id=structures.owner_profile_id
                  AND existing.signal_type='ritual_reminder'
                  AND existing.source_id=structures.id
                  AND existing.source_scheduled_for=structures.next_run_at
                WHERE structures.kind='ritual'
                  AND structures.lifecycle_status='active'
                  AND structures.next_run_at IS NOT NULL
                  AND structures.next_run_at <= $1
                  AND documents.status='active'
                  AND existing.id IS NULL
             ), candidates AS (
               SELECT structures.workspace_id,structures.owner_profile_id,structures.id AS ritual_id,
                      ranked.scheduled_for,ranked.ritual_title
                 FROM studio_structures structures
                 JOIN ranked ON ranked.workspace_id=structures.workspace_id
                  AND ranked.owner_profile_id=structures.owner_profile_id AND ranked.ritual_id=structures.id
                WHERE ranked.owner_rank=1
                  AND NOT ((ranked.workspace_id || '/' || ranked.owner_profile_id) = ANY($5::text[]))
                ORDER BY ranked.scheduled_for,structures.workspace_id,structures.owner_profile_id,structures.id
                FOR UPDATE OF structures SKIP LOCKED
                LIMIT $2
             )
             INSERT INTO studio_proactive_signals
               (id,workspace_id,owner_profile_id,signal_type,source_id,source_scheduled_for,
                title,reason,status,next_reminder_at,claim_token,claim_lease_expires_at,
                attempt_count,next_attempt_at,last_error_code,dismissed_at,created_at,updated_at)
             SELECT 'signal_' || md5(random()::text || clock_timestamp()::text || ritual_id),
                    workspace_id,owner_profile_id,'ritual_reminder',ritual_id,scheduled_for,
                    ritual_title,'','preparing',$1,$3,$4,1,NULL,NULL,NULL,$1,$1
               FROM candidates
             ON CONFLICT (workspace_id,owner_profile_id,signal_type,source_id,source_scheduled_for)
               DO NOTHING
             RETURNING *`,
            [input.now, remaining, input.claimToken, input.claimLeaseExpiresAt,
              reclaimed.rows.map((row) => `${row.workspace_id}/${row.owner_profile_id}`)]
          );
          inserted = result.rows;
        }
        return [...reclaimed.rows, ...inserted].map(claimFromRow);
      });
    },

    async completeRitualPreparation(input) {
      return withOperationalTransaction(db, async (client) => {
        const result = await client.query<SignalRow>(
          `UPDATE studio_proactive_signals signals
              SET title=$7,reason=$8,status='active',next_reminder_at=$9,
                  claim_token=NULL,claim_lease_expires_at=NULL,next_attempt_at=NULL,
                  last_error_code=NULL,dismissed_at=NULL,updated_at=$9
             FROM studio_proactivity_settings settings
            WHERE signals.workspace_id=$1 AND signals.owner_profile_id=$2
              AND settings.workspace_id=signals.workspace_id AND settings.owner_profile_id=signals.owner_profile_id
              AND settings.ritual_reminder_enabled=TRUE
              AND signals.signal_type='ritual_reminder' AND signals.source_id=$3 AND signals.source_scheduled_for=$4
              AND signals.status='preparing' AND signals.claim_token=$5 AND signals.attempt_count=$6
          RETURNING signals.*`,
          [input.claim.workspaceId, input.claim.ownerProfileId, input.claim.ritualId,
            input.claim.scheduledFor, input.claim.claimToken, input.claim.attemptCount,
            input.title, input.reason, input.now]
        );
        if (result.rows[0]) return signalFromRow(result.rows[0]);
        const existing = await client.query<SignalRow>(
          `SELECT * FROM studio_proactive_signals
            WHERE workspace_id=$1 AND owner_profile_id=$2
              AND signal_type='ritual_reminder' AND source_id=$3 AND source_scheduled_for=$4
              AND status IN ('active','dismissed')`,
          [input.claim.workspaceId, input.claim.ownerProfileId, input.claim.ritualId, input.claim.scheduledFor]
        );
        if (!existing.rows[0]) throw new Error("STUDIO_PROACTIVITY_CLAIM_LOST");
        return signalFromRow(existing.rows[0]);
      });
    },

    async failRitualPreparation(input) {
      const result = await db.query<{ id: string }>(
        `UPDATE studio_proactive_signals
            SET status='failed',claim_token=NULL,claim_lease_expires_at=NULL,
                next_attempt_at=$7,last_error_code=$8,updated_at=$9
          WHERE workspace_id=$1 AND owner_profile_id=$2
            AND signal_type='ritual_reminder' AND source_id=$3 AND source_scheduled_for=$4
            AND status='preparing' AND claim_token=$5 AND attempt_count=$6
        RETURNING id`,
        [input.claim.workspaceId, input.claim.ownerProfileId, input.claim.ritualId,
          input.claim.scheduledFor, input.claim.claimToken, input.claim.attemptCount,
          input.nextAttemptAt, input.errorCode, input.now]
      );
      if (!result.rows[0]) throw new Error("STUDIO_PROACTIVITY_CLAIM_LOST");
    },

    async listSignals(scope, input) {
      const result = await db.query<SignalRow>(
        `SELECT signals.* FROM studio_proactive_signals signals
          JOIN studio_proactivity_settings settings
            ON settings.workspace_id=signals.workspace_id AND settings.owner_profile_id=signals.owner_profile_id
          WHERE signals.workspace_id=$1 AND signals.owner_profile_id=$2
            AND signals.status='active' AND signals.next_reminder_at <= $3
            AND ${enabledSignalSql("signals", "settings")}
          ORDER BY signals.next_reminder_at,signals.id LIMIT $4`,
        [scope.workspaceId, scope.ownerProfileId, input.now, input.limit]
      );
      return result.rows.map(signalFromRow);
    },

    async findSignal(scope, signalId) {
      const result = await db.query<SignalRow>(
        `SELECT signals.* FROM studio_proactive_signals signals
          JOIN studio_proactivity_settings settings
            ON settings.workspace_id=signals.workspace_id AND settings.owner_profile_id=signals.owner_profile_id
          WHERE signals.workspace_id=$1 AND signals.owner_profile_id=$2 AND signals.id=$3
            AND signals.status='active' AND ${enabledSignalSql("signals", "settings")}`,
        [scope.workspaceId, scope.ownerProfileId, signalId]
      );
      return result.rows[0] ? signalFromRow(result.rows[0]) : null;
    },

    async updateSignal(signal) {
      const result = await db.query<SignalRow>(
        `UPDATE studio_proactive_signals
            SET status=$4,next_reminder_at=$5,dismissed_at=$6,
                claim_token=NULL,claim_lease_expires_at=NULL,updated_at=$7
          WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3
        RETURNING *`,
        [signal.workspaceId, signal.ownerProfileId, signal.id, signal.status,
          signal.nextReminderAt, signal.dismissedAt, signal.updatedAt]
      );
      if (!result.rows[0]) throw new Error("STUDIO_PROACTIVE_SIGNAL_NOT_FOUND");
      return signalFromRow(result.rows[0]);
    },

    async readPortabilityRows(scope) {
      const [ownerSettings, ownerSignals] = await Promise.all([
        readSettings(scope),
        db.query<SignalRow>(
          `SELECT * FROM studio_proactive_signals
            WHERE workspace_id=$1 AND owner_profile_id=$2 ORDER BY created_at,id`,
          [scope.workspaceId, scope.ownerProfileId]
        )
      ]);
      return { settings: ownerSettings, signals: ownerSignals.rows.map(signalFromRow) };
    },

    async deleteOwnerData(scope) {
      await withOperationalTransaction(db, async (client) => {
        await client.query(
          "DELETE FROM studio_proactive_signals WHERE workspace_id=$1 AND owner_profile_id=$2",
          [scope.workspaceId, scope.ownerProfileId]
        );
        await client.query(
          "DELETE FROM studio_proactivity_settings WHERE workspace_id=$1 AND owner_profile_id=$2",
          [scope.workspaceId, scope.ownerProfileId]
        );
      });
    }
  };
}

function enabledSignalSql(signalAlias: string, settingsAlias: string) {
  return `(
    (${signalAlias}.signal_type='ritual_reminder' AND ${settingsAlias}.ritual_reminder_enabled=TRUE)
    OR (${signalAlias}.signal_type='stale_goal' AND ${settingsAlias}.stale_goal_enabled=TRUE)
    OR (${signalAlias}.signal_type='recurring_theme' AND ${settingsAlias}.recurring_theme_enabled=TRUE)
    OR (${signalAlias}.signal_type='decision_review' AND ${settingsAlias}.decision_review_enabled=TRUE)
    OR (${signalAlias}.signal_type='operational_change' AND ${settingsAlias}.operational_change_enabled=TRUE)
    OR (${signalAlias}.signal_type='focused_content' AND ${settingsAlias}.focused_content_enabled=TRUE)
  )`;
}

function settingsFromRow(row: SettingsRow): StudioProactivitySettings {
  return {
    workspaceId: row.workspace_id,
    ownerProfileId: row.owner_profile_id,
    ritualReminder: row.ritual_reminder_enabled,
    staleGoal: row.stale_goal_enabled,
    recurringTheme: row.recurring_theme_enabled,
    decisionReview: row.decision_review_enabled,
    operationalChange: row.operational_change_enabled,
    focusedContent: row.focused_content_enabled,
    staleGoalAfterDays: row.stale_goal_after_days,
    updatedAt: iso(row.updated_at)
  };
}

function signalFromRow(row: SignalRow): StudioProactiveSignal {
  if (row.status === "preparing" || row.status === "failed") {
    throw new Error("STUDIO_PROACTIVE_SIGNAL_NOT_VISIBLE");
  }
  return {
    workspaceId: row.workspace_id,
    ownerProfileId: row.owner_profile_id,
    id: row.id,
    type: row.signal_type,
    sourceId: row.source_id,
    sourceScheduledFor: iso(row.source_scheduled_for),
    title: row.title,
    reason: row.reason,
    status: row.status,
    nextReminderAt: iso(row.next_reminder_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    dismissedAt: row.dismissed_at ? iso(row.dismissed_at) : null
  };
}

function claimFromRow(row: SignalRow): StudioDueRitualClaim {
  if (row.status !== "preparing" || !row.claim_token) throw new Error("STUDIO_PROACTIVITY_CLAIM_INVALID");
  return {
    workspaceId: row.workspace_id,
    ownerProfileId: row.owner_profile_id,
    ritualId: row.source_id,
    title: row.title,
    scheduledFor: iso(row.source_scheduled_for),
    claimToken: row.claim_token,
    attemptCount: row.attempt_count
  };
}

function iso(value: string | Date) {
  return new Date(value).toISOString();
}
