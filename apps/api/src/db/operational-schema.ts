import { attachCleanupError } from "./migration-cleanup-errors";

export type OperationalSchemaClient = {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
};

export type OperationalSchemaPool = {
  connect(): Promise<OperationalSchemaClient>;
};

type Migration = {
  version: number;
  name: string;
  sql: string;
};

const operationalSchemaLock = [1111574853, 1869636978];

const migrations: Migration[] = [{
  version: 1,
  name: "relational_operational_schema",
  sql: `
    CREATE TABLE areas (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id),
      UNIQUE (workspace_id, name)
    );

    CREATE TABLE role_templates (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      area_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id),
      UNIQUE (workspace_id, area_id, name),
      FOREIGN KEY (workspace_id, area_id) REFERENCES areas(workspace_id, id)
    );

    CREATE TABLE people (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'employee')),
      area_id TEXT,
      role_template_id TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'placeholder', 'archived')),
      created_by_profile_id TEXT NOT NULL,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id),
      UNIQUE (workspace_id, email),
      FOREIGN KEY (workspace_id, area_id) REFERENCES areas(workspace_id, id),
      FOREIGN KEY (workspace_id, role_template_id)
        REFERENCES role_templates(workspace_id, id)
    );

    CREATE TABLE processes (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      area_id TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
      owner_profile_id TEXT,
      owner_role_template_id TEXT,
      current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version > 0),
      created_by_profile_id TEXT NOT NULL,
      published_at TIMESTAMPTZ,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id),
      CHECK (owner_profile_id IS NULL OR owner_role_template_id IS NULL),
      FOREIGN KEY (workspace_id, area_id) REFERENCES areas(workspace_id, id),
      FOREIGN KEY (workspace_id, owner_profile_id) REFERENCES people(workspace_id, id),
      FOREIGN KEY (workspace_id, owner_role_template_id)
        REFERENCES role_templates(workspace_id, id)
    );

    CREATE TABLE process_versions (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      process_id TEXT NOT NULL,
      version_number INTEGER NOT NULL CHECK (version_number > 0),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      change_note TEXT NOT NULL,
      editor_profile_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id),
      UNIQUE (workspace_id, process_id, version_number),
      FOREIGN KEY (workspace_id, process_id)
        REFERENCES processes(workspace_id, id)
    );

    CREATE TABLE process_materials (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      process_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('link', 'file')),
      title TEXT NOT NULL,
      url TEXT,
      object_key TEXT,
      content_type TEXT,
      size_bytes BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id),
      CHECK (
        (kind = 'link' AND COALESCE(url ~ '\\S', FALSE)
          AND object_key IS NULL AND content_type IS NULL AND size_bytes IS NULL)
        OR
        (kind = 'file' AND url IS NULL AND COALESCE(object_key ~ '\\S', FALSE)
          AND COALESCE(content_type ~ '\\S', FALSE)
          AND size_bytes IS NOT NULL AND size_bytes >= 0)
      ),
      FOREIGN KEY (workspace_id, process_id)
        REFERENCES processes(workspace_id, id)
    );

    CREATE TABLE routines (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      area_id TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'archived')),
      frequency TEXT NOT NULL DEFAULT 'on_demand'
        CHECK (frequency IN ('daily', 'weekly', 'monthly', 'on_demand')),
      weekdays TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      month_day INTEGER,
      execution_mode TEXT NOT NULL DEFAULT 'shared'
        CHECK (execution_mode IN ('shared', 'individual')),
      approval_mode TEXT NOT NULL DEFAULT 'direct'
        CHECK (approval_mode IN ('direct', 'approval_required')),
      evidence_policy TEXT NOT NULL DEFAULT 'optional'
        CHECK (evidence_policy IN (
          'optional', 'comment_required', 'photo_required', 'photo_or_comment_required'
        )),
      evidence_reason TEXT,
      created_by_profile_id TEXT NOT NULL,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id),
      CHECK (
        CASE frequency
          WHEN 'daily' THEN cardinality(weekdays) BETWEEN 1 AND 7 AND month_day IS NULL
          WHEN 'weekly' THEN cardinality(weekdays) = 1 AND month_day IS NULL
          WHEN 'monthly' THEN cardinality(weekdays) = 0
            AND month_day IS NOT NULL AND month_day BETWEEN 1 AND 31
          WHEN 'on_demand' THEN cardinality(weekdays) = 0 AND month_day IS NULL
          ELSE FALSE
        END
      ),
      CHECK (
        cardinality(weekdays) =
          cardinality(array_positions(weekdays, 'mon'))
          + cardinality(array_positions(weekdays, 'tue'))
          + cardinality(array_positions(weekdays, 'wed'))
          + cardinality(array_positions(weekdays, 'thu'))
          + cardinality(array_positions(weekdays, 'fri'))
          + cardinality(array_positions(weekdays, 'sat'))
          + cardinality(array_positions(weekdays, 'sun'))
        AND cardinality(array_positions(weekdays, 'mon')) <= 1
        AND cardinality(array_positions(weekdays, 'tue')) <= 1
        AND cardinality(array_positions(weekdays, 'wed')) <= 1
        AND cardinality(array_positions(weekdays, 'thu')) <= 1
        AND cardinality(array_positions(weekdays, 'fri')) <= 1
        AND cardinality(array_positions(weekdays, 'sat')) <= 1
        AND cardinality(array_positions(weekdays, 'sun')) <= 1
      ),
      FOREIGN KEY (workspace_id, area_id) REFERENCES areas(workspace_id, id)
    );

    CREATE TABLE routine_steps (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      routine_id TEXT NOT NULL,
      title TEXT NOT NULL,
      process_id TEXT,
      instruction_timing TEXT,
      deadline_time TIME,
      approval_mode TEXT NOT NULL DEFAULT 'direct'
        CHECK (approval_mode IN ('direct', 'approval_required')),
      evidence_policy TEXT NOT NULL DEFAULT 'optional'
        CHECK (evidence_policy IN (
          'optional', 'comment_required', 'photo_required', 'photo_or_comment_required'
        )),
      evidence_reason TEXT,
      sort_order INTEGER NOT NULL CHECK (sort_order > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id),
      UNIQUE (workspace_id, routine_id, id),
      UNIQUE (workspace_id, routine_id, sort_order),
      FOREIGN KEY (workspace_id, routine_id)
        REFERENCES routines(workspace_id, id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, process_id) REFERENCES processes(workspace_id, id)
    );

    CREATE TABLE routine_assignments (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      routine_id TEXT NOT NULL,
      routine_step_id TEXT,
      profile_id TEXT,
      role_template_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id),
      CHECK (
        (profile_id IS NOT NULL AND role_template_id IS NULL)
        OR (profile_id IS NULL AND role_template_id IS NOT NULL)
      ),
      FOREIGN KEY (workspace_id, routine_id)
        REFERENCES routines(workspace_id, id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, routine_id, routine_step_id)
        REFERENCES routine_steps(workspace_id, routine_id, id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, profile_id) REFERENCES people(workspace_id, id),
      FOREIGN KEY (workspace_id, role_template_id)
        REFERENCES role_templates(workspace_id, id)
    );

    CREATE TABLE routine_occurrences (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      routine_id TEXT NOT NULL,
      due_date DATE NOT NULL,
      audience_key TEXT NOT NULL,
      area_name_snapshot TEXT,
      routine_title_snapshot TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id),
      FOREIGN KEY (workspace_id, routine_id) REFERENCES routines(workspace_id, id)
    );

    CREATE UNIQUE INDEX routine_occurrences_generation_uidx
      ON routine_occurrences (workspace_id, routine_id, due_date, audience_key);

    CREATE TABLE task_occurrences (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('routine', 'manual')),
      routine_id TEXT,
      routine_step_id TEXT,
      area_id TEXT,
      process_id TEXT,
      assignee_profile_id TEXT,
      audience_key TEXT,
      title TEXT NOT NULL,
      area_name_snapshot TEXT,
      routine_title_snapshot TEXT,
      step_title_snapshot TEXT NOT NULL,
      routine_revision_snapshot TIMESTAMPTZ,
      approval_mode TEXT NOT NULL CHECK (approval_mode IN ('direct', 'approval_required')),
      evidence_policy TEXT NOT NULL CHECK (evidence_policy IN (
        'optional', 'comment_required', 'photo_required', 'photo_or_comment_required'
      )),
      evidence_reason TEXT,
      status TEXT NOT NULL CHECK (status IN (
        'pending', 'in_progress', 'awaiting_approval', 'completed',
        'needs_adjustment', 'late', 'dismissed'
      )),
      due_date DATE NOT NULL,
      due_time TIME,
      submitted_by_profile_id TEXT,
      submitted_at TIMESTAMPTZ,
      reviewed_by_profile_id TEXT,
      reviewed_at TIMESTAMPTZ,
      review_comment TEXT,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id),
      CHECK (
        (origin = 'manual' AND routine_id IS NULL AND routine_step_id IS NULL
          AND routine_title_snapshot IS NULL)
        OR
        (origin = 'routine' AND routine_id IS NOT NULL AND routine_step_id IS NOT NULL
          AND audience_key IS NOT NULL AND routine_title_snapshot IS NOT NULL)
      ),
      FOREIGN KEY (workspace_id, routine_id) REFERENCES routines(workspace_id, id),
      FOREIGN KEY (workspace_id, routine_id, routine_step_id)
        REFERENCES routine_steps(workspace_id, routine_id, id),
      FOREIGN KEY (workspace_id, area_id) REFERENCES areas(workspace_id, id),
      FOREIGN KEY (workspace_id, process_id) REFERENCES processes(workspace_id, id),
      FOREIGN KEY (workspace_id, assignee_profile_id) REFERENCES people(workspace_id, id)
    );

    CREATE TABLE task_checklist_items (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      task_occurrence_id TEXT NOT NULL,
      title TEXT NOT NULL,
      sort_order INTEGER NOT NULL CHECK (sort_order > 0),
      is_completed BOOLEAN NOT NULL DEFAULT FALSE,
      completed_by_profile_id TEXT,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id),
      FOREIGN KEY (workspace_id, task_occurrence_id)
        REFERENCES task_occurrences(workspace_id, id)
    );

    CREATE UNIQUE INDEX task_checklist_items_order_uidx
      ON task_checklist_items (workspace_id, task_occurrence_id, sort_order);

    CREATE TABLE task_evidence (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      task_occurrence_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('comment', 'photo')),
      comment TEXT,
      photo_url TEXT,
      object_key TEXT,
      file_name TEXT,
      content_type TEXT,
      size_bytes BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id),
      CHECK (
        (kind = 'comment' AND COALESCE(comment ~ '\\S', FALSE)
          AND photo_url IS NULL AND object_key IS NULL)
        OR
        (kind = 'photo' AND (
          COALESCE(photo_url ~ '\\S', FALSE)
          OR COALESCE(object_key ~ '\\S', FALSE)
        ))
      ),
      FOREIGN KEY (workspace_id, task_occurrence_id)
        REFERENCES task_occurrences(workspace_id, id),
      FOREIGN KEY (workspace_id, profile_id) REFERENCES people(workspace_id, id)
    );

    CREATE TABLE operational_audit_log (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_profile_id TEXT,
      details JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id)
    );

    CREATE INDEX people_area_idx
      ON people (workspace_id, area_id);
    CREATE INDEX people_role_template_idx
      ON people (workspace_id, role_template_id);
    CREATE INDEX processes_area_idx
      ON processes (workspace_id, area_id);
    CREATE INDEX processes_owner_profile_idx
      ON processes (workspace_id, owner_profile_id);
    CREATE INDEX processes_owner_role_template_idx
      ON processes (workspace_id, owner_role_template_id);
    CREATE INDEX process_materials_process_idx
      ON process_materials (workspace_id, process_id);
    CREATE INDEX routines_area_idx
      ON routines (workspace_id, area_id);
    CREATE INDEX routine_steps_process_idx
      ON routine_steps (workspace_id, process_id);
    CREATE INDEX routine_assignments_step_idx
      ON routine_assignments (workspace_id, routine_id, routine_step_id);
    CREATE INDEX routine_assignments_profile_idx
      ON routine_assignments (workspace_id, profile_id);
    CREATE INDEX routine_assignments_role_template_idx
      ON routine_assignments (workspace_id, role_template_id);
    CREATE INDEX task_occurrences_step_idx
      ON task_occurrences (workspace_id, routine_id, routine_step_id);
    CREATE INDEX task_occurrences_area_idx
      ON task_occurrences (workspace_id, area_id);
    CREATE INDEX task_occurrences_process_idx
      ON task_occurrences (workspace_id, process_id);
    CREATE INDEX task_occurrences_assignee_due_idx
      ON task_occurrences (workspace_id, assignee_profile_id, due_date);
    CREATE INDEX task_evidence_task_idx
      ON task_evidence (workspace_id, task_occurrence_id, created_at);
    CREATE INDEX task_evidence_profile_idx
      ON task_evidence (workspace_id, profile_id);
    CREATE INDEX operational_audit_entity_idx
      ON operational_audit_log (workspace_id, entity_type, entity_id, created_at);
  `
}, {
  version: 2,
  name: "allow_manual_historical_routine_snapshot",
  sql: `
    ALTER TABLE task_occurrences
      DROP CONSTRAINT IF EXISTS task_occurrences_check;
    ALTER TABLE task_occurrences
      DROP CONSTRAINT IF EXISTS task_occurrences_constraint_5;
    ALTER TABLE task_occurrences
      ADD CONSTRAINT task_occurrences_origin_references_check
      CHECK (
        (origin = 'manual' AND routine_id IS NULL AND routine_step_id IS NULL)
        OR
        (origin = 'routine' AND routine_id IS NOT NULL AND routine_step_id IS NOT NULL
          AND audience_key IS NOT NULL AND routine_title_snapshot IS NOT NULL)
      );
  `
}, {
  version: 3,
  name: "operational_repository_runtime_compatibility",
  sql: `
    ALTER TABLE routine_steps ADD COLUMN archived_at TIMESTAMPTZ;
    ALTER TABLE task_occurrences ADD COLUMN archived_at TIMESTAMPTZ;
    ALTER TABLE routines ADD COLUMN due_hint TEXT;
    ALTER TABLE routine_steps ADD COLUMN due_hint TEXT;
    ALTER TABLE task_occurrences ADD COLUMN due_hint TEXT;
    ALTER TABLE task_occurrences ADD COLUMN source_template_key TEXT;
    ALTER TABLE routine_occurrences ADD COLUMN routine_updated_at_snapshot TIMESTAMPTZ;
    ALTER TABLE task_evidence ADD COLUMN archived_at TIMESTAMPTZ;

    ALTER TABLE routine_steps
      DROP CONSTRAINT IF EXISTS routine_steps_workspace_id_routine_id_sort_order_key;
    CREATE UNIQUE INDEX routine_steps_active_order_uidx
      ON routine_steps (workspace_id, routine_id, sort_order)
      WHERE archived_at IS NULL;

    ALTER TABLE task_occurrences
      DROP CONSTRAINT IF EXISTS task_occurrences_assignee_profile_id_fkey;
    ALTER TABLE task_occurrences
      DROP CONSTRAINT IF EXISTS task_occurrences_workspace_id_assignee_profile_id_fkey;
    ALTER TABLE task_evidence
      DROP CONSTRAINT IF EXISTS task_evidence_profile_id_fkey;
    ALTER TABLE task_evidence
      DROP CONSTRAINT IF EXISTS task_evidence_workspace_id_profile_id_fkey;

  `
}, {
  version: 4,
  name: "active_company_uniqueness",
  sql: `
    ALTER TABLE areas
      DROP CONSTRAINT IF EXISTS areas_workspace_id_name_key;
    ALTER TABLE role_templates
      DROP CONSTRAINT IF EXISTS role_templates_workspace_id_area_id_name_key;
    ALTER TABLE people
      DROP CONSTRAINT IF EXISTS people_workspace_id_email_key;

    CREATE UNIQUE INDEX areas_active_name_uidx
      ON areas (workspace_id, name) WHERE archived_at IS NULL;
    CREATE UNIQUE INDEX role_templates_active_name_uidx
      ON role_templates (workspace_id, area_id, name) WHERE archived_at IS NULL;
    CREATE UNIQUE INDEX people_active_email_uidx
      ON people (workspace_id, email)
      WHERE archived_at IS NULL AND email IS NOT NULL;
  `
}, {
  version: 5,
  name: "operational_member_identity_and_scope",
  sql: `
    ALTER TABLE people ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;
    ALTER TABLE people ADD COLUMN IF NOT EXISTS customer_id TEXT;
    ALTER TABLE people ADD COLUMN IF NOT EXISTS access_scope TEXT NOT NULL DEFAULT 'workspace'
      CHECK (access_scope IN ('workspace','area','assigned_only'));
    ALTER TABLE people DROP CONSTRAINT IF EXISTS people_status_check;
    ALTER TABLE people ADD CONSTRAINT people_status_check
      CHECK (status IN ('pending','active','inactive','placeholder','archived'));

    CREATE TABLE IF NOT EXISTS person_area_access (
      workspace_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      area_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, person_id, area_id),
      FOREIGN KEY (workspace_id, person_id) REFERENCES people(workspace_id, id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, area_id) REFERENCES areas(workspace_id, id) ON DELETE RESTRICT
    );
    INSERT INTO person_area_access (workspace_id,person_id,area_id)
      SELECT workspace_id,id,area_id FROM people WHERE area_id IS NOT NULL
      ON CONFLICT DO NOTHING;
    CREATE UNIQUE INDEX IF NOT EXISTS people_active_clerk_identity_uidx
      ON people (workspace_id, clerk_user_id) WHERE clerk_user_id IS NOT NULL AND archived_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS people_active_customer_identity_uidx
      ON people (workspace_id, customer_id) WHERE customer_id IS NOT NULL AND archived_at IS NULL;
  `
}, {
  version: 6,
  name: "task_occurrence_routine_revision_snapshot",
  sql: `
    ALTER TABLE task_occurrences
      ADD COLUMN IF NOT EXISTS routine_revision_snapshot TIMESTAMPTZ;

    UPDATE task_occurrences
      SET routine_revision_snapshot = routine_occurrences_parent.routine_updated_at_snapshot
      FROM routine_occurrences AS routine_occurrences_parent
      WHERE task_occurrences.routine_revision_snapshot IS NULL
        AND task_occurrences.origin = 'routine'
        AND task_occurrences.status = 'pending'
        AND task_occurrences.submitted_at IS NULL
        AND task_occurrences.workspace_id = routine_occurrences_parent.workspace_id
        AND task_occurrences.routine_id = routine_occurrences_parent.routine_id
        AND task_occurrences.due_date = routine_occurrences_parent.due_date
        AND task_occurrences.audience_key = routine_occurrences_parent.audience_key;
  `
}, {
  version: 7,
  name: "task_evidence_attachment_metadata",
  sql: `
    ALTER TABLE task_evidence ADD COLUMN IF NOT EXISTS file_name TEXT;
    ALTER TABLE task_evidence ADD COLUMN IF NOT EXISTS content_type TEXT;
    ALTER TABLE task_evidence ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
  `
}, {
  version: 8,
  name: "role_safe_access_scopes",
  sql: `
    UPDATE people
      SET access_scope = 'workspace'
      WHERE role = 'owner' AND access_scope <> 'workspace';

    UPDATE people
      SET access_scope = 'area'
      WHERE role = 'manager' AND access_scope <> 'area';

    UPDATE people
      SET access_scope = 'assigned_only'
      WHERE role = 'employee' AND access_scope <> 'assigned_only';

    INSERT INTO person_area_access (workspace_id, person_id, area_id)
      SELECT workspace_id, id, area_id
      FROM people
      WHERE role = 'manager' AND area_id IS NOT NULL AND archived_at IS NULL
      ON CONFLICT DO NOTHING;
  `
}, {
  version: 9,
  name: "owner_studio_foundation",
  sql: `
    CREATE TABLE studio_documents (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      owner_profile_id TEXT NOT NULL,
      title TEXT,
      body_json JSONB NOT NULL,
      body_text TEXT NOT NULL,
      search_tokens TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
      capture_mode TEXT NOT NULL
        CHECK (capture_mode IN ('text','audio','file','image','link','mixed')),
      inbox_state TEXT NOT NULL DEFAULT 'pending_review'
        CHECK (inbox_state IN ('pending_review','reviewed')),
      is_focused BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, owner_profile_id, id)
    );

    CREATE TABLE studio_document_versions (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      owner_profile_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      version_number INTEGER NOT NULL CHECK (version_number > 0),
      body_json JSONB NOT NULL,
      body_text TEXT NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('user','import','accepted_ai_suggestion')),
      actor_profile_id TEXT NOT NULL,
      ai_run_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, owner_profile_id, id),
      UNIQUE (workspace_id, owner_profile_id, document_id, version_number),
      FOREIGN KEY (workspace_id, owner_profile_id, document_id)
        REFERENCES studio_documents(workspace_id, owner_profile_id, id) ON DELETE CASCADE
    );

    CREATE TABLE studio_assets (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      owner_profile_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('audio','image','file','link_snapshot')),
      display_name TEXT NOT NULL,
      object_key TEXT NOT NULL,
      source_url TEXT,
      mime_type TEXT NOT NULL,
      size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, owner_profile_id, id),
      FOREIGN KEY (workspace_id, owner_profile_id, document_id)
        REFERENCES studio_documents(workspace_id, owner_profile_id, id) ON DELETE CASCADE
    );

    CREATE TABLE studio_collections (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      owner_profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, owner_profile_id, id)
    );

    CREATE TABLE studio_collection_items (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      owner_profile_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, owner_profile_id, id),
      UNIQUE (workspace_id, owner_profile_id, collection_id, document_id),
      FOREIGN KEY (workspace_id, owner_profile_id, collection_id)
        REFERENCES studio_collections(workspace_id, owner_profile_id, id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, owner_profile_id, document_id)
        REFERENCES studio_documents(workspace_id, owner_profile_id, id) ON DELETE CASCADE
    );

    CREATE INDEX studio_documents_owner_updated_idx
      ON studio_documents (workspace_id, owner_profile_id, updated_at DESC);
    CREATE INDEX studio_documents_owner_inbox_state_idx
      ON studio_documents (workspace_id, owner_profile_id, inbox_state, updated_at DESC);
    CREATE INDEX studio_documents_owner_focused_idx
      ON studio_documents (workspace_id, owner_profile_id, updated_at DESC)
      WHERE is_focused = TRUE;
    CREATE INDEX studio_documents_owner_status_idx
      ON studio_documents (workspace_id, owner_profile_id, status, updated_at DESC);
    CREATE INDEX studio_documents_owner_search_idx
      ON studio_documents USING GIN (search_tokens) WHERE status = 'active';
    CREATE INDEX studio_assets_document_idx
      ON studio_assets (workspace_id, owner_profile_id, document_id, created_at);
    CREATE INDEX studio_collection_items_collection_idx
      ON studio_collection_items (workspace_id, owner_profile_id, collection_id, created_at);
    CREATE INDEX studio_collection_items_document_idx
      ON studio_collection_items (workspace_id, owner_profile_id, document_id);
  `
}];

export async function ensureOperationalSchema(pool: OperationalSchemaPool): Promise<void> {
  return ensureOperationalSchemaThrough(pool, Number.POSITIVE_INFINITY);
}

export async function ensureOperationalSchemaThrough(
  pool: OperationalSchemaPool,
  maximumVersion: number
): Promise<void> {
  const client = await pool.connect();
  let primaryError: unknown;

  try {
    await migrateOperationalSchema(client, maximumVersion);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      client.release();
    } catch (cleanupError) {
      if (primaryError) attachCleanupError(primaryError, cleanupError);
      else throw cleanupError;
    }
  }
}

async function migrateOperationalSchema(client: OperationalSchemaClient, maximumVersion: number): Promise<void> {
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", operationalSchemaLock);
    const migrationTable = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = $1`,
      ["baase_schema_migrations"]
    );
    if (migrationTable.rows.length === 0) {
      await client.query(`
        CREATE TABLE baase_schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    }

    for (const migration of migrations) {
      if (migration.version > maximumVersion) continue;
      const applied = await client.query<{ version: number }>(
        "SELECT version FROM baase_schema_migrations WHERE version = $1",
        [migration.version]
      );
      if (applied.rows.length > 0) continue;

      await client.query(migration.sql);
      await client.query(
        "INSERT INTO baase_schema_migrations (version, name) VALUES ($1, $2)",
        [migration.version, migration.name]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (cleanupError) {
      attachCleanupError(error, cleanupError);
    }
    throw error;
  }
}
