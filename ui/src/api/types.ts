export type JobStatus = "generating" | "running" | "done" | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  fileCount: number;
  valuesPerFile: number;
  progress: number;
  createdAt: string;
  runningAt: string | null;
  completedAt: string | null;
  resultUrl?: string;
  error?: string;
}

export interface JobPage {
  jobs: Job[];
  nextCursor: string | null;
}

export interface WorkerTask {
  jobId: string;
  inputs: number;
  filesCovered: number;
  claimedAt: string;
}

export interface WorkerStats {
  committed: number;
  lost: number;
  failed: number;
  valuesRead: number;
  busySeconds: number;
  lastFinishedAt: string | null;
  valuesPerBusySecond: number | null;
}

export interface Worker {
  id: string;
  label: string;
  speedFactor: number;
  startedAt: string;
  task: WorkerTask | null;
  stats?: WorkerStats;
}

export interface SnapshotItem {
  id: string;
  filesCovered: number;
  workerId: string | null;
  createdBy: string | null;
}

export interface JobSnapshot {
  job: Job;
  items: SnapshotItem[] | null;
  workers: Worker[];
}

export interface ResultPreview {
  means: number[];
  /** Means in the whole result (= values per file). */
  total: number;
}

export interface WorkerTaskSummary {
  workerId: string;
  label: string;
  committed: number;
  lost: number;
  failed: number;
  valuesRead: number;
  busySeconds: number;
}

export type StatusFilter = "all" | "active" | "done" | "failed";
