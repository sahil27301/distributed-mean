import type { JobRecord, JobStatus } from "./repo.js";

export interface JobResponse {
  id: string;
  status: JobStatus;
  fileCount: number;
  valuesPerFile: number;
  progress: number;
  createdAt: string;
  completedAt: string | null;
  resultUrl?: string;
  error?: string;
}

/** Every merge of k items removes k − 1, and a job needs F − 1 removals to reach one item. */
export function computeProgress(job: JobRecord): number {
  if (job.status === "done") return 1;
  if (job.status !== "running") return 0;
  const progress = (job.fileCount - job.itemsRemaining) / (job.fileCount - 1);
  return Math.min(1, Math.max(0, progress));
}

export function toJobResponse(job: JobRecord): JobResponse {
  return {
    id: job.id,
    status: job.status,
    fileCount: job.fileCount,
    valuesPerFile: job.valuesPerFile,
    progress: computeProgress(job),
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    ...(job.status === "done" && { resultUrl: `/jobs/${job.id}/result` }),
    ...(job.error && { error: job.error }),
  };
}
