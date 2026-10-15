import type pg from "pg";
import { withTransaction } from "../db/transaction.js";

export type JobStatus = "generating" | "running" | "done" | "failed";

export interface JobRecord {
  id: string;
  fileCount: number;
  valuesPerFile: number;
  status: JobStatus;
  resultPath: string | null;
  error: string | null;
  createdAt: Date;
  runningAt: Date | null;
  completedAt: Date | null;
  itemsRemaining: number;
}

export interface JobSpec {
  id: string;
  fileCount: number;
  valuesPerFile: number;
}

export interface JobRow {
  id: string;
  file_count: number;
  values_per_file: number;
  status: JobStatus;
  result_path: string | null;
  error: string | null;
  created_at: Date;
  running_at: Date | null;
  completed_at: Date | null;
  items_remaining: number;
}

export const JOB_COLUMNS = `id, file_count, values_per_file, status, result_path, error, created_at, running_at, completed_at`;

export function toRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    fileCount: row.file_count,
    valuesPerFile: row.values_per_file,
    status: row.status,
    resultPath: row.result_path,
    error: row.error,
    createdAt: row.created_at,
    runningAt: row.running_at,
    completedAt: row.completed_at,
    itemsRemaining: row.items_remaining,
  };
}

export async function insertJob(pool: pg.Pool, fileCount: number, valuesPerFile: number): Promise<JobRecord> {
  const { rows } = await pool.query<JobRow>(
    `INSERT INTO jobs (file_count, values_per_file, status)
     VALUES ($1, $2, 'generating')
     RETURNING ${JOB_COLUMNS}, 0 AS items_remaining`,
    [fileCount, valuesPerFile],
  );
  return toRecord(rows[0]!);
}

export async function getJob(pool: pg.Pool, id: string): Promise<JobRecord | null> {
  const { rows } = await pool.query<JobRow>(
    `SELECT ${JOB_COLUMNS},
            (SELECT count(*) FROM items i WHERE i.job_id = j.id)::int AS items_remaining
     FROM jobs j
     WHERE j.id = $1`,
    [id],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function listGeneratingJobs(pool: pg.Pool): Promise<JobSpec[]> {
  const { rows } = await pool.query<{ id: string; file_count: number; values_per_file: number }>(
    `SELECT id, file_count, values_per_file FROM jobs WHERE status = 'generating' ORDER BY created_at`,
  );
  return rows.map((r) => ({ id: r.id, fileCount: r.file_count, valuesPerFile: r.values_per_file }));
}

/**
 * Moves a job from generating to running and enqueues one item per raw file, atomically.
 * Returns false if the job was no longer generating (another caller already flipped it).
 */
export async function flipToRunning(pool: pg.Pool, jobId: string): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    const flipped = await client.query(
      `UPDATE jobs SET status = 'running', last_claimed_at = now(), running_at = now()
       WHERE id = $1 AND status = 'generating'`,
      [jobId],
    );
    if (flipped.rowCount !== 1) return false;

    // Path format must match rawPath() in blob/paths.ts.
    await client.query(
      `INSERT INTO items (job_id, path, files_covered)
       SELECT j.id, 'raw/' || j.id || '/' || i || '.bin', 1
       FROM jobs j, generate_series(0, j.file_count - 1) AS i
       WHERE j.id = $1`,
      [jobId],
    );
    return true;
  });
}

export async function markJobFailed(pool: pg.Pool, jobId: string, error: string): Promise<void> {
  await pool.query(`UPDATE jobs SET status = 'failed', error = $2 WHERE id = $1 AND status = 'generating'`, [
    jobId,
    error,
  ]);
}
