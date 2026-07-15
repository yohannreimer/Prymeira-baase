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
      const result = await db.query<SettingsRow>(
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
      return settingsFromRow(result.rows[0]!);
    },

    async claimDueRituals(input) {
      return withOperationalTransaction(db, async (client) => {
        const reclaimed = await client.query<SignalRow>(
          `WITH candidates AS (
             SELECT workspace_id,owner_profile_id,id
               FROM studio_proactive_signals
              WHERE signal_type='ritual_reminder'
                AND (
                  (status='failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= $1)
                  OR (status='preparing' AND claim_lease_expires_at <= $1)
                )
              ORDER BY COALESCE(next_attempt_at,claim_lease_expires_at),source_scheduled_for,id
              FOR UPDATE SKIP LOCKED
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
            `WITH candidates AS (
               SELECT structures.workspace_id,structures.owner_profile_id,structures.id AS ritual_id,
                      structures.next_run_at AS scheduled_for,
                      COALESCE(NULLIF(BTRIM(documents.title),''),
                               NULLIF(BTRIM(structures.properties_json->>'intention'),''),
                               'Ritual privado') AS ritual_title
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
                ORDER BY structures.next_run_at,structures.workspace_id,structures.owner_profile_id,structures.id
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
            [input.now, remaining, input.claimToken, input.claimLeaseExpiresAt]
          );
          inserted = result.rows;
        }
        return [...reclaimed.rows, ...inserted].map(claimFromRow);
      });
    },

    async completeRitualPreparation(input) {
      return withOperationalTransaction(db, async (client) => {
        const result = await client.query<SignalRow>(
          `UPDATE studio_proactive_signals
              SET title=$7,reason=$8,status='active',next_reminder_at=$9,
                  claim_token=NULL,claim_lease_expires_at=NULL,next_attempt_at=NULL,
                  last_error_code=NULL,dismissed_at=NULL,updated_at=$9
            WHERE workspace_id=$1 AND owner_profile_id=$2
              AND signal_type='ritual_reminder' AND source_id=$3 AND source_scheduled_for=$4
              AND status='preparing' AND claim_token=$5 AND attempt_count=$6
          RETURNING *`,
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
        `SELECT * FROM studio_proactive_signals
          WHERE workspace_id=$1 AND owner_profile_id=$2
            AND status='active' AND next_reminder_at <= $3
          ORDER BY next_reminder_at,id LIMIT $4`,
        [scope.workspaceId, scope.ownerProfileId, input.now, input.limit]
      );
      return result.rows.map(signalFromRow);
    },

    async findSignal(scope, signalId) {
      const result = await db.query<SignalRow>(
        `SELECT * FROM studio_proactive_signals
          WHERE workspace_id=$1 AND owner_profile_id=$2 AND id=$3`,
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
