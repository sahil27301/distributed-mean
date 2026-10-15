import type pg from "pg";

/** Workers refresh presence every 5 s; three missed refreshes means gone. */
export const WORKER_LIVENESS_SECONDS = 15;

export interface CurrentTask {
  jobId: string;
  inputs: number;
  filesCovered: number;
  claimedAt: Date;
}

export interface LiveWorker {
  id: string;
  speedFactor: number;
  startedAt: Date;
  lastSeenAt: Date;
  task: CurrentTask | null;
}

export interface WorkerStats {
  committed: number;
  lost: number;
  failed: number;
  valuesRead: number;
  busySeconds: number;
  lastFinishedAt: Date | null;
}

interface LiveWorkerRow {
  id: string;
  speed_factor: number;
  started_at: Date;
  last_seen_at: Date;
  job_id: string | null;
  inputs: number | null;
  files_covered: number | null;
  claimed_at: Date | null;
}

/** Live workers and what each one holds right now (only unexpired leases count as holding). */
export async function listLiveWorkers(pool: pg.Pool): Promise<LiveWorker[]> {
  const { rows } = await pool.query<LiveWorkerRow>(
    `SELECT w.id, w.speed_factor, w.started_at, w.last_seen_at,
            cur.job_id, cur.inputs, cur.files_covered, cur.claimed_at
     FROM workers w
     LEFT JOIN LATERAL (
       SELECT i.job_id, count(*)::int AS inputs, sum(i.files_covered)::int AS files_covered,
              min(i.claimed_at) AS claimed_at
       FROM items i
       WHERE i.claimed_by = w.id AND i.lease_expires_at > now()
       GROUP BY i.job_id
       ORDER BY min(i.claimed_at) DESC
       LIMIT 1
     ) cur ON true
     WHERE w.last_seen_at > now() - make_interval(secs => $1)
     ORDER BY w.started_at, w.id`,
    [WORKER_LIVENESS_SECONDS],
  );
  return rows.map((r) => ({
    id: r.id,
    speedFactor: r.speed_factor,
    startedAt: r.started_at,
    lastSeenAt: r.last_seen_at,
    task:
      r.job_id && r.claimed_at
        ? { jobId: r.job_id, inputs: r.inputs ?? 0, filesCovered: r.files_covered ?? 0, claimedAt: r.claimed_at }
        : null,
  }));
}

export async function getWorkerStats(pool: pg.Pool, workerIds: string[]): Promise<Map<string, WorkerStats>> {
  const { rows } = await pool.query<{
    worker_id: string;
    committed: number;
    lost: number;
    failed: number;
    values_read: string;
    busy_seconds: number;
    last_finished_at: Date | null;
  }>(
    `SELECT worker_id,
            count(*) FILTER (WHERE outcome = 'committed')::int AS committed,
            count(*) FILTER (WHERE outcome = 'lost')::int AS lost,
            count(*) FILTER (WHERE outcome = 'failed')::int AS failed,
            coalesce(sum(values_read) FILTER (WHERE outcome = 'committed'), 0)::bigint AS values_read,
            coalesce(sum(extract(epoch FROM finished_at - claimed_at)), 0)::float8 AS busy_seconds,
            max(finished_at) AS last_finished_at
     FROM tasks
     WHERE worker_id = ANY($1)
     GROUP BY worker_id`,
    [workerIds],
  );
  return new Map(
    rows.map((r) => [
      r.worker_id,
      {
        committed: r.committed,
        lost: r.lost,
        failed: r.failed,
        valuesRead: Number(r.values_read),
        busySeconds: r.busy_seconds,
        lastFinishedAt: r.last_finished_at,
      },
    ]),
  );
}
