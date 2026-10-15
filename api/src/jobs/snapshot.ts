import type pg from "pg";
import { listLiveWorkers } from "../workers/repo.js";
import { toWorkerResponse, type WorkerResponse } from "../workers/serialize.js";
import type { JobRecord } from "./repo.js";
import { toJobResponse, type JobResponse } from "./serialize.js";

/** Above this, per-item detail is too much to draw and to poll; the snapshot omits it. */
export const MAX_VISUALISED_FILES = 100;

export interface SnapshotItem {
  id: string;
  filesCovered: number;
  /** Set only while a live lease is held; an expired claim is back in the queue. */
  workerId: string | null;
  /** Worker that produced this partial; null for raw files. */
  createdBy: string | null;
}

export interface JobSnapshot {
  job: JobResponse;
  items: SnapshotItem[] | null;
  workers: WorkerResponse[];
}

export async function getJobSnapshot(pool: pg.Pool, job: JobRecord): Promise<JobSnapshot> {
  const [items, workers] = await Promise.all([
    job.fileCount <= MAX_VISUALISED_FILES ? listItems(pool, job.id) : Promise.resolve(null),
    listLiveWorkers(pool),
  ]);
  return { job: toJobResponse(job), items, workers: workers.map((w) => toWorkerResponse(w)) };
}

/** Claim order (largest partials first), so the left of the queue is what gets taken next. */
async function listItems(pool: pg.Pool, jobId: string): Promise<SnapshotItem[]> {
  const { rows } = await pool.query<{
    id: string;
    files_covered: number;
    worker_id: string | null;
    created_by: string | null;
  }>(
    `SELECT id, files_covered, created_by,
            CASE WHEN claimed_by IS NOT NULL AND lease_expires_at > now() THEN claimed_by END AS worker_id
     FROM items
     WHERE job_id = $1
     ORDER BY files_covered DESC, created_at, id`,
    [jobId],
  );
  return rows.map((r) => ({
    id: r.id,
    filesCovered: r.files_covered,
    workerId: r.worker_id,
    createdBy: r.created_by,
  }));
}
