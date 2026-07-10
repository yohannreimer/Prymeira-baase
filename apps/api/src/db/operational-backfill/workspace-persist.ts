import { tableSpecs } from "./table-specs";
import { entityTables, type OperationalBackfillClient, type PlannedRow, type WorkspacePlan } from "./types";

export const BACKFILL_BATCH_SIZE = 500;

export async function persistWorkspacePlan(
  client: OperationalBackfillClient,
  plan: WorkspacePlan
) {
  let inserted = 0;
  for (const table of entityTables) {
    const rows = plan.rows[table];
    for (let offset = 0; offset < rows.length; offset += BACKFILL_BATCH_SIZE) {
      inserted += await insertBatch(client, rows.slice(offset, offset + BACKFILL_BATCH_SIZE));
    }
  }
  return inserted;
}

async function insertBatch(client: OperationalBackfillClient, rows: PlannedRow[]) {
  if (rows.length === 0) return 0;
  const spec = tableSpecs[rows[0]!.table];
  const params: unknown[] = [];
  const valuesSql = rows.map((row) => {
    const placeholders = spec.columns.map((column) => {
      const value = row.values[column];
      params.push(spec.casts?.[column] === "::jsonb" && value !== null ? JSON.stringify(value) : value);
      return `$${params.length}${spec.casts?.[column] ?? ""}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  const result = await client.query<{ id: string }>(
    `insert into ${spec.table} (${spec.columns.join(", ")})
     values ${valuesSql.join(", ")}
     on conflict do nothing
     returning id`,
    params
  );
  return result.rows.length;
}
