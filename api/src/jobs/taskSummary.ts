import type pg from "pg";
import { workerLabel } from "../workers/serialize.js";

export interface WorkerTaskSummary {
  workerId: string;
  label: string;
  committed: number;
  lost: number;
  failed: number;
  valuesRead: number;
  busySeconds: number;
}

/** Per-worker attempt counts for one job, most merges first. Served by `tasks_job_idx`. */
export async function getJobTaskSummary(pool: pg.Pool, jobId: string): Promise<WorkerTaskSummary[]> {
  const { rows } = await pool.query<{
    worker_id: string;
    committed: number;
    lost: number;
    failed: number;
    values_read: string;
    busy_seconds: number;
  }>(
    `SELECT worker_id,
            count(*) FILTER (WHERE outcome = 'committed')::int AS committed,
            count(*) FILTER (WHERE outcome = 'lost')::int AS lost,
            count(*) FILTER (WHERE outcome = 'failed')::int AS failed,
            coalesce(sum(values_read) FILTER (WHERE outcome = 'committed'), 0)::bigint AS values_read,
            coalesce(sum(extract(epoch FROM finished_at - claimed_at)), 0)::float8 AS busy_seconds
     FROM tasks
     WHERE job_id = $1
     GROUP BY worker_id
     ORDER BY committed DESC, worker_id`,
    [jobId],
  );
  return rows.map((r) => ({
    workerId: r.worker_id,
    label: workerLabel(r.worker_id),
    committed: r.committed,
    lost: r.lost,
    failed: r.failed,
    valuesRead: Number(r.values_read),
    busySeconds: r.busy_seconds,
  }));
}
