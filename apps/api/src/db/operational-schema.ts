export type Queryable = {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  connect?: () => Promise<Queryable & { release(): void }>;
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
    CREATE TABLE IF NOT EXISTS areas (
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

    CREATE TABLE IF NOT EXISTS role_templates (
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
      UNIQUE (workspace_id, area_id, id),
      FOREIGN KEY (workspace_id, area_id) REFERENCES areas(workspace_id, id)
    );

    CREATE TABLE IF NOT EXISTS people (
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

    CREATE TABLE IF NOT EXISTS processes (
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

    CREATE TABLE IF NOT EXISTS process_versions (
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
        REFERENCES processes(workspace_id, id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS process_materials (
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
        (kind = 'link' AND url IS NOT NULL AND url <> ''
          AND object_key IS NULL AND content_type IS NULL AND size_bytes IS NULL)
        OR
        (kind = 'file' AND url IS NULL AND object_key IS NOT NULL AND object_key <> ''
          AND content_type IS NOT NULL AND content_type <> ''
          AND size_bytes IS NOT NULL AND size_bytes >= 0)
      ),
      FOREIGN KEY (workspace_id, process_id)
        REFERENCES processes(workspace_id, id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS routines (
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
        (frequency = 'daily' AND weekdays[1] IS NOT NULL AND month_day IS NULL)
        OR (frequency = 'weekly' AND weekdays[1] IS NOT NULL
          AND weekdays[2] IS NULL AND month_day IS NULL)
        OR (frequency = 'monthly' AND weekdays = ARRAY[]::TEXT[]
          AND month_day BETWEEN 1 AND 31)
        OR (frequency = 'on_demand' AND weekdays = ARRAY[]::TEXT[] AND month_day IS NULL)
      ),
      CHECK (
        weekdays[1] IS NULL OR weekdays[1] IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
      ),
      CHECK (
        weekdays[2] IS NULL OR weekdays[2] IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
      ),
      CHECK (
        weekdays[3] IS NULL OR weekdays[3] IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
      ),
      CHECK (
        weekdays[4] IS NULL OR weekdays[4] IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
      ),
      CHECK (
        weekdays[5] IS NULL OR weekdays[5] IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
      ),
      CHECK (
        weekdays[6] IS NULL OR weekdays[6] IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
      ),
      CHECK (
        weekdays[7] IS NULL OR weekdays[7] IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
      ),
      CHECK (weekdays[8] IS NULL),
      FOREIGN KEY (workspace_id, area_id) REFERENCES areas(workspace_id, id)
    );

    CREATE TABLE IF NOT EXISTS routine_steps (
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

    CREATE TABLE IF NOT EXISTS routine_assignments (
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

    CREATE TABLE IF NOT EXISTS routine_occurrences (
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

    CREATE UNIQUE INDEX IF NOT EXISTS routine_occurrences_generation_uidx
      ON routine_occurrences (workspace_id, routine_id, due_date, audience_key);

    CREATE TABLE IF NOT EXISTS task_occurrences (
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

    CREATE TABLE IF NOT EXISTS task_checklist_items (
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
        REFERENCES task_occurrences(workspace_id, id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS task_checklist_items_order_uidx
      ON task_checklist_items (workspace_id, task_occurrence_id, sort_order);

    CREATE TABLE IF NOT EXISTS task_evidence (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      task_occurrence_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('comment', 'photo')),
      comment TEXT,
      photo_url TEXT,
      object_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, id),
      CHECK (
        (kind = 'comment' AND comment IS NOT NULL AND comment <> ''
          AND photo_url IS NULL AND object_key IS NULL)
        OR
        (kind = 'photo' AND (photo_url IS NOT NULL OR object_key IS NOT NULL))
      ),
      FOREIGN KEY (workspace_id, task_occurrence_id)
        REFERENCES task_occurrences(workspace_id, id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, profile_id) REFERENCES people(workspace_id, id)
    );

    CREATE TABLE IF NOT EXISTS operational_audit_log (
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
  `
}];

export async function ensureOperationalSchema(db: Queryable): Promise<void> {
  const client = db.connect ? await db.connect() : db;

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
    await client.query("ROLLBACK");
    throw error;
  } finally {
    if ("release" in client && typeof client.release === "function") client.release();
  }
}
