import type { LiveWorker, WorkerStats } from "./repo.js";

export interface WorkerResponse {
  id: string;
  /** Container id prefix, matching `docker ps`, so a worker on screen can be found and killed. */
  label: string;
  speedFactor: number;
  startedAt: string;
  task: { jobId: string; inputs: number; filesCovered: number; claimedAt: string } | null;
  stats?: WorkerStats & { valuesPerBusySecond: number | null };
}

export function workerLabel(id: string): string {
  return id.split("-")[0]!.slice(0, 12);
}

export function toWorkerResponse(worker: LiveWorker, stats?: WorkerStats): WorkerResponse {
  return {
    id: worker.id,
    label: workerLabel(worker.id),
    speedFactor: worker.speedFactor,
    startedAt: worker.startedAt.toISOString(),
    task: worker.task && { ...worker.task, claimedAt: worker.task.claimedAt.toISOString() },
    ...(stats && {
      stats: {
        ...stats,
        valuesPerBusySecond: stats.busySeconds > 0 ? stats.valuesRead / stats.busySeconds : null,
      },
    }),
  };
}

export const EMPTY_STATS: WorkerStats = {
  committed: 0,
  lost: 0,
  failed: 0,
  valuesRead: 0,
  busySeconds: 0,
  lastFinishedAt: null,
};
