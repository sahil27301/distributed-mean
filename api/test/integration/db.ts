import pg from "pg";
import { pino } from "pino";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://mean:mean@localhost:5432/mean_test";

export const silentLogger = pino({ level: "silent" });

export function createTestPool(): pg.Pool {
  return new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 5 });
}

export async function resetDb(pool: pg.Pool): Promise<void> {
  await pool.query("TRUNCATE tasks, items, jobs");
}

export async function insertJobRow(
  pool: pg.Pool,
  fields: { fileCount: number; valuesPerFile?: number; status: string; resultPath?: string },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO jobs (file_count, values_per_file, status, result_path, completed_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $3 = 'done' THEN now() END)
     RETURNING id`,
    [fields.fileCount, fields.valuesPerFile ?? 10, fields.status, fields.resultPath ?? null],
  );
  return rows[0]!.id;
}

export async function insertItems(pool: pg.Pool, jobId: string, filesCovered: number[]): Promise<void> {
  for (const [i, covered] of filesCovered.entries()) {
    await pool.query(`INSERT INTO items (job_id, path, files_covered) VALUES ($1, $2, $3)`, [
      jobId,
      `partials/${jobId}/${i}.bin`,
      covered,
    ]);
  }
}
