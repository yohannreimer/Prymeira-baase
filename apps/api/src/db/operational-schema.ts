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

// Versions 14–16 are implemented in the approved Studio order. Versions 17–19 remain
// unavailable to incidental hardening work so upcoming ritual/operations/proactivity state
// can land additively without renumbering released migrations.
export const STUDIO_MIGRATION_LEDGER_RESERVATIONS = Object.freeze({
  14: "studio_relations_and_index_jobs",
  15: "studio_conversations_messages_suggestions_citations",
  16: "studio_structures",
  17: "studio_ritual_sessions",
  18: "studio_operation_previews_and_links",
  19: "studio_proactivity_settings_and_signals"
} as const);

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
      search_title_folded TEXT NOT NULL DEFAULT '',
      search_body_folded TEXT NOT NULL DEFAULT '',
      search_tokens TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      search_prefix_tokens TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
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
      object_key TEXT,
      source_url TEXT,
      final_url TEXT,
      fetched_at TIMESTAMPTZ,
      mime_type TEXT,
      size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
      extraction_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (extraction_status IN ('pending','processing','ready','failed')),
      extracted_text TEXT,
      extraction_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
      last_error_code TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      next_attempt_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, owner_profile_id, id),
      CHECK (
        (kind = 'link_snapshot' AND object_key IS NULL AND source_url IS NOT NULL)
        OR (kind <> 'link_snapshot' AND object_key IS NOT NULL AND mime_type IS NOT NULL)
      ),
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
    CREATE INDEX studio_documents_owner_search_prefix_idx
      ON studio_documents USING GIN (search_prefix_tokens) WHERE status = 'active';
    CREATE INDEX studio_assets_document_idx
      ON studio_assets (workspace_id, owner_profile_id, document_id, created_at);
    CREATE INDEX studio_assets_processing_idx
      ON studio_assets (extraction_status, next_attempt_at, created_at)
      WHERE extraction_status IN ('pending','failed');
    CREATE INDEX studio_collection_items_collection_idx
      ON studio_collection_items (workspace_id, owner_profile_id, collection_id, created_at);
    CREATE INDEX studio_collection_items_document_idx
      ON studio_collection_items (workspace_id, owner_profile_id, document_id);
  `
}, {
  version: 10,
  name: "studio_asset_processing_hardening",
  sql: `
    ALTER TABLE studio_assets ADD COLUMN IF NOT EXISTS final_url TEXT;
    ALTER TABLE studio_assets ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ;
    ALTER TABLE studio_assets ADD COLUMN IF NOT EXISTS extraction_status TEXT DEFAULT 'pending';
    ALTER TABLE studio_assets ADD COLUMN IF NOT EXISTS extracted_text TEXT;
    ALTER TABLE studio_assets ADD COLUMN IF NOT EXISTS extraction_metadata JSONB DEFAULT '{}'::JSONB;
    ALTER TABLE studio_assets ADD COLUMN IF NOT EXISTS last_error_code TEXT;
    ALTER TABLE studio_assets ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0;
    ALTER TABLE studio_assets ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
    ALTER TABLE studio_assets ADD COLUMN IF NOT EXISTS claim_token TEXT;
    ALTER TABLE studio_assets ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
    ALTER TABLE studio_assets ADD COLUMN IF NOT EXISTS lifecycle_status TEXT DEFAULT 'active';

    ALTER TABLE studio_assets ALTER COLUMN object_key DROP NOT NULL;
    ALTER TABLE studio_assets ALTER COLUMN mime_type DROP NOT NULL;
    UPDATE studio_assets SET extraction_status='pending'
      WHERE extraction_status IS NULL OR extraction_status='processing';
    UPDATE studio_assets SET extraction_metadata='{}'::JSONB WHERE extraction_metadata IS NULL;
    UPDATE studio_assets SET attempt_count=0 WHERE attempt_count IS NULL OR attempt_count < 0;
    UPDATE studio_assets SET lifecycle_status='active' WHERE lifecycle_status IS NULL;
    UPDATE studio_assets SET claim_token=NULL,lease_expires_at=NULL
      WHERE extraction_status <> 'processing';
    ALTER TABLE studio_assets ALTER COLUMN extraction_status SET DEFAULT 'pending';
    ALTER TABLE studio_assets ALTER COLUMN extraction_status SET NOT NULL;
    ALTER TABLE studio_assets ALTER COLUMN extraction_metadata SET DEFAULT '{}'::JSONB;
    ALTER TABLE studio_assets ALTER COLUMN extraction_metadata SET NOT NULL;
    ALTER TABLE studio_assets ALTER COLUMN attempt_count SET DEFAULT 0;
    ALTER TABLE studio_assets ALTER COLUMN attempt_count SET NOT NULL;
    ALTER TABLE studio_assets ALTER COLUMN lifecycle_status SET DEFAULT 'active';
    ALTER TABLE studio_assets ALTER COLUMN lifecycle_status SET NOT NULL;
    ALTER TABLE studio_assets DROP CONSTRAINT IF EXISTS studio_assets_extraction_status_check;
    ALTER TABLE studio_assets ADD CONSTRAINT studio_assets_extraction_status_check
      CHECK (extraction_status IN ('pending','processing','ready','failed'));
    ALTER TABLE studio_assets DROP CONSTRAINT IF EXISTS studio_assets_attempt_count_check;
    ALTER TABLE studio_assets ADD CONSTRAINT studio_assets_attempt_count_check CHECK (attempt_count >= 0);
    ALTER TABLE studio_assets DROP CONSTRAINT IF EXISTS studio_assets_lifecycle_status_check;
    ALTER TABLE studio_assets ADD CONSTRAINT studio_assets_lifecycle_status_check
      CHECK (lifecycle_status IN ('active','deleting'));
    ALTER TABLE studio_assets DROP CONSTRAINT IF EXISTS studio_assets_processing_lease_check;
    ALTER TABLE studio_assets ADD CONSTRAINT studio_assets_processing_lease_check CHECK (
      (extraction_status='processing' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)
      OR (extraction_status<>'processing' AND claim_token IS NULL AND lease_expires_at IS NULL)
    );
    ALTER TABLE studio_assets DROP CONSTRAINT IF EXISTS studio_assets_capture_storage_check;
    ALTER TABLE studio_assets ADD CONSTRAINT studio_assets_capture_storage_check CHECK (
      (kind='link_snapshot' AND object_key IS NULL AND source_url IS NOT NULL)
      OR (kind<>'link_snapshot' AND object_key IS NOT NULL AND mime_type IS NOT NULL)
    );

    CREATE TABLE IF NOT EXISTS studio_asset_cleanup_jobs (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      owner_profile_id TEXT NOT NULL,
      asset_id TEXT,
      object_key TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      next_attempt_at TIMESTAMPTZ,
      last_error_code TEXT,
      claim_token TEXT,
      lease_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, owner_profile_id, id),
      CHECK (asset_id IS NOT NULL OR object_key IS NOT NULL),
      CHECK (
        (status='processing' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (status<>'processing' AND claim_token IS NULL AND lease_expires_at IS NULL)
      )
    );

    DROP INDEX IF EXISTS studio_assets_processing_idx;
    CREATE INDEX studio_assets_processing_idx
      ON studio_assets (extraction_status, next_attempt_at, lease_expires_at, created_at)
      WHERE lifecycle_status='active' AND extraction_status IN ('pending','processing','failed');
    CREATE INDEX IF NOT EXISTS studio_asset_cleanup_jobs_claim_idx
      ON studio_asset_cleanup_jobs (status, next_attempt_at, lease_expires_at, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS studio_asset_cleanup_jobs_object_uidx
      ON studio_asset_cleanup_jobs (workspace_id, owner_profile_id, object_key)
      WHERE object_key IS NOT NULL;
  `
}, {
  version: 11,
  name: "studio_asset_upload_intents",
  sql: `
    CREATE TABLE studio_asset_upload_intents (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      owner_profile_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      object_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('audio','image','file')),
      mime_type TEXT NOT NULL,
      size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','cleanup_pending','processing','failed','resolved')),
      asset_id TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      next_attempt_at TIMESTAMPTZ,
      last_error_code TEXT,
      claim_token TEXT,
      lease_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, owner_profile_id, id),
      UNIQUE (workspace_id, owner_profile_id, object_key),
      CHECK (
        (status='processing' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (status<>'processing' AND claim_token IS NULL AND lease_expires_at IS NULL)
      ),
      CHECK ((status='resolved' AND asset_id IS NOT NULL) OR status<>'resolved'),
      FOREIGN KEY (workspace_id, owner_profile_id, document_id)
        REFERENCES studio_documents(workspace_id, owner_profile_id, id)
    );

    CREATE UNIQUE INDEX studio_assets_object_key_uidx
      ON studio_assets (workspace_id, owner_profile_id, object_key)
      WHERE object_key IS NOT NULL;
    CREATE INDEX studio_asset_upload_intents_claim_idx
      ON studio_asset_upload_intents (status, next_attempt_at, lease_expires_at, created_at)
      WHERE status IN ('pending','cleanup_pending','processing','failed');
  `
}, {
  version: 12,
  name: "studio_asset_upload_lifecycle",
  sql: `
    DELETE FROM studio_asset_upload_intents WHERE status='resolved';
    UPDATE studio_asset_upload_intents
      SET status='cleanup_pending',asset_id=NULL,next_attempt_at=COALESCE(next_attempt_at,NOW())
      WHERE status='pending';
    UPDATE studio_asset_upload_intents
      SET asset_id=NULL,next_attempt_at=COALESCE(next_attempt_at,NOW())
      WHERE status IN ('cleanup_pending','failed');

    ALTER TABLE studio_asset_upload_intents ADD COLUMN upload_token TEXT;
    ALTER TABLE studio_asset_upload_intents ADD COLUMN upload_lease_expires_at TIMESTAMPTZ;
    ALTER TABLE studio_asset_upload_intents ALTER COLUMN status SET DEFAULT 'cleanup_pending';

    ALTER TABLE studio_asset_upload_intents DROP CONSTRAINT IF EXISTS studio_asset_upload_intents_status_check;
    ALTER TABLE studio_asset_upload_intents DROP CONSTRAINT IF EXISTS studio_asset_upload_intents_check;
    ALTER TABLE studio_asset_upload_intents DROP CONSTRAINT IF EXISTS studio_asset_upload_intents_check1;

    ALTER TABLE studio_asset_upload_intents ADD CONSTRAINT studio_asset_upload_intents_status_check
      CHECK (status IN ('uploading','cleanup_pending','processing','failed'));
    ALTER TABLE studio_asset_upload_intents ADD CONSTRAINT studio_asset_upload_intents_lifecycle_check CHECK (
      (status='uploading'
        AND upload_token IS NOT NULL AND upload_lease_expires_at IS NOT NULL
        AND claim_token IS NULL AND lease_expires_at IS NULL AND next_attempt_at IS NULL)
      OR (status='processing'
        AND upload_token IS NULL AND upload_lease_expires_at IS NULL
        AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL AND next_attempt_at IS NULL)
      OR (status IN ('cleanup_pending','failed')
        AND upload_token IS NULL AND upload_lease_expires_at IS NULL
        AND claim_token IS NULL AND lease_expires_at IS NULL AND next_attempt_at IS NOT NULL)
    );

    ALTER TABLE studio_asset_upload_intents
      DROP CONSTRAINT IF EXISTS studio_asset_upload_intents_workspace_id_owner_profile_id__fkey;
    ALTER TABLE studio_asset_upload_intents
      ADD CONSTRAINT studio_asset_upload_intents_document_fkey
      FOREIGN KEY (workspace_id,owner_profile_id,document_id)
      REFERENCES studio_documents(workspace_id,owner_profile_id,id) ON DELETE CASCADE;

    DROP INDEX studio_asset_upload_intents_claim_idx;
    CREATE INDEX studio_asset_upload_intents_claim_idx
      ON studio_asset_upload_intents
        (status,next_attempt_at,upload_lease_expires_at,lease_expires_at,created_at)
      WHERE status IN ('uploading','cleanup_pending','processing','failed');
  `
}, {
  version: 13,
  name: "studio_asset_atomic_upload_sessions",
  sql: `
    ALTER TABLE studio_asset_upload_intents ADD COLUMN storage_upload_id TEXT;
    ALTER TABLE studio_asset_upload_intents ADD COLUMN storage_session_state TEXT;

    UPDATE studio_asset_upload_intents
      SET status='cleanup_pending',next_attempt_at=COALESCE(next_attempt_at,NOW()),
        upload_token=NULL,upload_lease_expires_at=NULL
      WHERE status='uploading';
    UPDATE studio_asset_upload_intents SET storage_session_state='abort_pending';

    ALTER TABLE studio_asset_upload_intents ALTER COLUMN storage_session_state SET DEFAULT 'creating';
    ALTER TABLE studio_asset_upload_intents ALTER COLUMN storage_session_state SET NOT NULL;
    ALTER TABLE studio_asset_upload_intents ADD CONSTRAINT studio_asset_upload_intents_storage_session_check CHECK (
      (storage_session_state='creating' AND storage_upload_id IS NULL AND status='uploading')
      OR (storage_session_state='active' AND storage_upload_id IS NOT NULL AND status='uploading')
      OR (storage_session_state='abort_pending' AND status IN ('cleanup_pending','processing','failed'))
    );
  `
}, {
  version: 14,
  name: "studio_relations_and_index_jobs",
  sql: `
    ALTER TABLE studio_document_versions
      ADD CONSTRAINT studio_document_versions_document_id_id_uidx
      UNIQUE (workspace_id,owner_profile_id,document_id,id);

    CREATE TABLE studio_relations (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      owner_profile_id TEXT NOT NULL,
      source_document_id TEXT NOT NULL,
      target_document_id TEXT NOT NULL,
      relation_type TEXT NOT NULL CHECK (relation_type IN (
        'related_to','supports','contradicts','originated','informs','supersedes'
      )),
      created_by_profile_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id,owner_profile_id,id),
      UNIQUE (
        workspace_id,owner_profile_id,source_document_id,target_document_id,relation_type
      ),
      CHECK (source_document_id <> target_document_id),
      FOREIGN KEY (workspace_id,owner_profile_id,source_document_id)
        REFERENCES studio_documents(workspace_id,owner_profile_id,id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id,owner_profile_id,target_document_id)
        REFERENCES studio_documents(workspace_id,owner_profile_id,id) ON DELETE CASCADE
    );

    CREATE TABLE studio_index_jobs (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      owner_profile_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','failed','completed')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      next_attempt_at TIMESTAMPTZ,
      last_error_code TEXT,
      claim_token TEXT,
      lease_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id,owner_profile_id,id),
      UNIQUE (workspace_id,owner_profile_id,version_id),
      CHECK (
        (status='processing' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (status<>'processing' AND claim_token IS NULL AND lease_expires_at IS NULL)
      ),
      CHECK (
        (status='pending' AND next_attempt_at IS NOT NULL)
        OR (status='failed')
        OR (status IN ('processing','completed') AND next_attempt_at IS NULL)
      ),
      FOREIGN KEY (workspace_id,owner_profile_id,document_id)
        REFERENCES studio_documents(workspace_id,owner_profile_id,id) ON DELETE CASCADE
    );

    INSERT INTO studio_index_jobs
      (id,workspace_id,owner_profile_id,document_id,version_id,status,next_attempt_at)
      SELECT 'studio_index_job_backfill_' || selected_version.selected_version_id,
        document.workspace_id,document.owner_profile_id,document.id,
        selected_version.selected_version_id,'pending',NOW()
      FROM studio_documents document
      JOIN (
        SELECT workspace_id,owner_profile_id,document_id,MAX(version_number) AS version_number
        FROM studio_document_versions
        GROUP BY workspace_id,owner_profile_id,document_id
      ) current_version
        ON current_version.workspace_id=document.workspace_id
        AND current_version.owner_profile_id=document.owner_profile_id
        AND current_version.document_id=document.id
      JOIN (
        SELECT workspace_id AS version_workspace_id,
          owner_profile_id AS version_owner_profile_id,
          document_id AS version_document_id,
          id AS selected_version_id,
          version_number
        FROM studio_document_versions
      ) selected_version
        ON selected_version.version_workspace_id=current_version.workspace_id
        AND selected_version.version_owner_profile_id=current_version.owner_profile_id
        AND selected_version.version_document_id=current_version.document_id
        AND selected_version.version_number=current_version.version_number
      WHERE document.status='active'
      ON CONFLICT (workspace_id,owner_profile_id,version_id) DO NOTHING;

    ALTER TABLE studio_index_jobs
      ADD CONSTRAINT studio_index_jobs_version_fkey
      FOREIGN KEY (workspace_id,owner_profile_id,document_id,version_id)
      REFERENCES studio_document_versions(workspace_id,owner_profile_id,document_id,id) ON DELETE CASCADE;

    CREATE INDEX studio_relations_source_idx
      ON studio_relations (workspace_id,owner_profile_id,source_document_id,created_at,id);
    CREATE INDEX studio_relations_target_idx
      ON studio_relations (workspace_id,owner_profile_id,target_document_id,created_at,id);
    CREATE INDEX studio_index_jobs_claim_idx
      ON studio_index_jobs (status,next_attempt_at,lease_expires_at,created_at,id)
      WHERE status IN ('pending','processing','failed');
  `
}, {
  version: 15,
  name: "studio_conversations_messages_suggestions_citations",
  sql: `
    CREATE TABLE studio_conversations (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      owner_profile_id TEXT NOT NULL,
      document_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id,owner_profile_id,id),
      FOREIGN KEY (workspace_id,owner_profile_id,document_id)
        REFERENCES studio_documents(workspace_id,owner_profile_id,id) ON DELETE CASCADE
    );

    CREATE TABLE studio_messages (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      owner_profile_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content TEXT NOT NULL CHECK (content <> ''),
      ai_run_id TEXT,
      status TEXT NOT NULL DEFAULT 'complete' CHECK (status='complete'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id,owner_profile_id,id),
      FOREIGN KEY (workspace_id,owner_profile_id,conversation_id)
        REFERENCES studio_conversations(workspace_id,owner_profile_id,id) ON DELETE CASCADE,
      CHECK ((role='user' AND ai_run_id IS NULL) OR (role='assistant' AND ai_run_id IS NOT NULL))
    );

    CREATE TABLE studio_suggestions (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      owner_profile_id TEXT NOT NULL,
      document_id TEXT,
      conversation_id TEXT,
      ai_run_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind='text'),
      payload_json JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','accepted','dismissed','expired')),
      accepted_version_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_at TIMESTAMPTZ,
      PRIMARY KEY (workspace_id,owner_profile_id,id),
      FOREIGN KEY (workspace_id,owner_profile_id,document_id)
        REFERENCES studio_documents(workspace_id,owner_profile_id,id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id,owner_profile_id,conversation_id)
        REFERENCES studio_conversations(workspace_id,owner_profile_id,id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id,owner_profile_id,document_id,accepted_version_id)
        REFERENCES studio_document_versions(workspace_id,owner_profile_id,document_id,id),
      CHECK (kind<>'text' OR document_id IS NOT NULL),
      CHECK (
        (status='pending' AND decided_at IS NULL AND accepted_version_id IS NULL)
        OR (status='accepted' AND document_id IS NOT NULL AND decided_at IS NOT NULL AND accepted_version_id IS NOT NULL)
        OR (status IN ('dismissed','expired') AND decided_at IS NOT NULL AND accepted_version_id IS NULL)
      )
    );

    CREATE TABLE studio_citations (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      owner_profile_id TEXT NOT NULL,
      message_id TEXT,
      suggestion_id TEXT,
      source_type TEXT NOT NULL CHECK (source_type IN (
        'studio_document','studio_asset','operational_resource','operational_metric','external_url'
      )),
      source_id TEXT,
      url TEXT,
      label TEXT NOT NULL CHECK (label <> ''),
      excerpt TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      period_from DATE,
      period_to DATE,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id,owner_profile_id,id),
      FOREIGN KEY (workspace_id,owner_profile_id,message_id)
        REFERENCES studio_messages(workspace_id,owner_profile_id,id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id,owner_profile_id,suggestion_id)
        REFERENCES studio_suggestions(workspace_id,owner_profile_id,id) ON DELETE CASCADE,
      CHECK (
        (message_id IS NOT NULL AND suggestion_id IS NULL)
        OR (message_id IS NULL AND suggestion_id IS NOT NULL)
      ),
      CHECK (
        (source_type='external_url' AND source_id IS NULL AND url IS NOT NULL)
        OR (source_type<>'external_url' AND source_id IS NOT NULL AND url IS NULL)
      ),
      CHECK ((period_from IS NULL AND period_to IS NULL) OR (period_from IS NOT NULL AND period_to IS NOT NULL AND period_from <= period_to))
    );

    CREATE INDEX studio_conversations_owner_updated_idx
      ON studio_conversations (workspace_id,owner_profile_id,updated_at DESC,id DESC);
    CREATE INDEX studio_messages_conversation_idx
      ON studio_messages (workspace_id,owner_profile_id,conversation_id,created_at DESC,id DESC);
    CREATE INDEX studio_suggestions_owner_status_idx
      ON studio_suggestions (workspace_id,owner_profile_id,status,created_at DESC,id DESC);
    CREATE INDEX studio_citations_message_idx
      ON studio_citations (workspace_id,owner_profile_id,message_id,created_at,id)
      WHERE message_id IS NOT NULL;
    CREATE INDEX studio_citations_suggestion_idx
      ON studio_citations (workspace_id,owner_profile_id,suggestion_id,created_at,id)
      WHERE suggestion_id IS NOT NULL;
  `
}, {
  version: 16,
  name: "studio_structures",
  sql: `
    CREATE TABLE studio_structures (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      owner_profile_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('goal','decision','plan','ritual')),
      lifecycle_status TEXT NOT NULL DEFAULT 'active'
        CHECK (lifecycle_status IN ('active','archived')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
      horizon_at TIMESTAMPTZ,
      metric_json JSONB,
      cadence_json JSONB,
      next_run_at TIMESTAMPTZ,
      properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT
        date_bin('1 millisecond'::interval,NOW(),'2000-01-01 00:00:00+00'::timestamptz),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      archived_at TIMESTAMPTZ,
      PRIMARY KEY (workspace_id,owner_profile_id,id),
      FOREIGN KEY (workspace_id,owner_profile_id,document_id)
        REFERENCES studio_documents(workspace_id,owner_profile_id,id) ON DELETE CASCADE,
      CHECK (
        (lifecycle_status='active' AND archived_at IS NULL)
        OR (lifecycle_status='archived' AND archived_at IS NOT NULL)
      ),
      CHECK (
        (kind='goal' AND cadence_json IS NULL AND next_run_at IS NULL)
        OR (kind='ritual' AND metric_json IS NULL AND (
          (cadence_json IS NULL AND next_run_at IS NULL)
          OR (cadence_json IS NOT NULL AND next_run_at IS NOT NULL)
        ))
        OR (kind IN ('decision','plan') AND metric_json IS NULL AND cadence_json IS NULL AND next_run_at IS NULL)
      )
    );

    CREATE UNIQUE INDEX studio_structures_active_kind_uidx
      ON studio_structures (workspace_id,owner_profile_id,document_id,kind)
      WHERE lifecycle_status='active';
    CREATE INDEX studio_structures_owner_cursor_idx
      ON studio_structures (workspace_id,owner_profile_id,created_at DESC,id DESC);
    CREATE INDEX studio_structures_owner_kind_cursor_idx
      ON studio_structures (workspace_id,owner_profile_id,kind,created_at DESC,id DESC);
    CREATE INDEX studio_structures_owner_kind_lifecycle_cursor_idx
      ON studio_structures (workspace_id,owner_profile_id,kind,lifecycle_status,created_at DESC,id DESC);
    CREATE INDEX studio_structures_owner_lifecycle_cursor_idx
      ON studio_structures (workspace_id,owner_profile_id,lifecycle_status,created_at DESC,id DESC);
    CREATE INDEX studio_structures_next_run_idx
      ON studio_structures (workspace_id,owner_profile_id,next_run_at,id)
      WHERE kind='ritual' AND lifecycle_status='active' AND next_run_at IS NOT NULL;
  `
}, {
  version: 17,
  name: "studio_ritual_sessions",
  sql: `
    CREATE TABLE studio_ritual_sessions (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      owner_profile_id TEXT NOT NULL,
      ritual_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'preparing'
        CHECK (status IN ('preparing','ready','in_progress','completed','failed')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
      context_json JSONB,
      preparation_json JSONB,
      answers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      synthesis_json JSONB,
      prepare_ai_run_id TEXT,
      synthesis_ai_run_id TEXT,
      preparation_token TEXT,
      preparation_lease_expires_at TIMESTAMPTZ,
      failure_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT
        date_bin('1 millisecond'::interval,NOW(),'2000-01-01 00:00:00+00'::timestamptz),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      PRIMARY KEY (workspace_id,owner_profile_id,id),
      FOREIGN KEY (workspace_id,owner_profile_id,ritual_id)
        REFERENCES studio_structures(workspace_id,owner_profile_id,id) ON DELETE CASCADE,
      CHECK (jsonb_typeof(answers_json)='object'),
      CHECK (context_json IS NULL OR jsonb_typeof(context_json)='object'),
      CHECK (preparation_json IS NULL OR jsonb_typeof(preparation_json)='object'),
      CHECK (synthesis_json IS NULL OR jsonb_typeof(synthesis_json)='object'),
      CHECK ((preparation_token IS NULL)=(preparation_lease_expires_at IS NULL)),
      CHECK ((status='completed' AND completed_at IS NOT NULL) OR (status<>'completed' AND completed_at IS NULL)),
      CHECK ((status='failed' AND failure_code IS NOT NULL) OR (status<>'failed' AND failure_code IS NULL))
    );

    CREATE UNIQUE INDEX studio_ritual_sessions_open_uidx
      ON studio_ritual_sessions (workspace_id,owner_profile_id,ritual_id)
      WHERE status IN ('preparing','ready','in_progress','failed');
    CREATE INDEX studio_ritual_sessions_ritual_cursor_idx
      ON studio_ritual_sessions (workspace_id,owner_profile_id,ritual_id,created_at DESC,id DESC);
    CREATE INDEX studio_ritual_sessions_owner_status_idx
      ON studio_ritual_sessions (workspace_id,owner_profile_id,status,updated_at DESC,id DESC);
  `
}, {
  version: 20,
  name: "studio_asset_capture_idempotency",
  sql: `
    ALTER TABLE studio_documents ADD COLUMN IF NOT EXISTS capture_key TEXT;
    DROP INDEX IF EXISTS studio_documents_capture_uidx;
    CREATE UNIQUE INDEX studio_documents_capture_uidx
      ON studio_documents (workspace_id,owner_profile_id,capture_key)
      WHERE capture_key IS NOT NULL AND status='active';

    ALTER TABLE studio_assets ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
    DROP INDEX IF EXISTS studio_assets_idempotency_uidx;
    CREATE UNIQUE INDEX studio_assets_idempotency_uidx
      ON studio_assets (workspace_id,owner_profile_id,document_id,idempotency_key)
      WHERE idempotency_key IS NOT NULL AND lifecycle_status='active';
  `
}, {
  version: 21,
  name: "studio_library_cursor_indexes",
  sql: `
    CREATE INDEX studio_documents_owner_library_cursor_idx
      ON studio_documents
        (workspace_id,owner_profile_id,date_bin('1 millisecond'::interval,updated_at,'2000-01-01 00:00:00+00'::timestamptz) DESC,id DESC);
    CREATE INDEX studio_documents_active_library_cursor_idx
      ON studio_documents
        (workspace_id,owner_profile_id,date_bin('1 millisecond'::interval,updated_at,'2000-01-01 00:00:00+00'::timestamptz) DESC,id DESC)
      WHERE status='active';
    CREATE INDEX studio_documents_active_inbox_cursor_idx
      ON studio_documents
        (workspace_id,owner_profile_id,inbox_state,date_bin('1 millisecond'::interval,updated_at,'2000-01-01 00:00:00+00'::timestamptz) DESC,id DESC)
      WHERE status='active';
    CREATE INDEX studio_documents_archived_library_cursor_idx
      ON studio_documents
        (workspace_id,owner_profile_id,date_bin('1 millisecond'::interval,updated_at,'2000-01-01 00:00:00+00'::timestamptz) DESC,id DESC)
      WHERE status='archived';
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
