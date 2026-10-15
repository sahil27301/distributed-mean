import type { Job, JobPage, JobSnapshot, ResultPreview, StatusFilter, Worker, WorkerTaskSummary } from "./types";

const BASE = "/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export function listJobs(params: { cursor?: string | null; status: StatusFilter; limit?: number }): Promise<JobPage> {
  const query = new URLSearchParams({ limit: String(params.limit ?? 15) });
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.status !== "all") query.set("status", params.status);
  return request(`/jobs?${query}`);
}

export function createJob(fileCount: number, valuesPerFile: number): Promise<Job> {
  return request("/jobs", { method: "POST", body: JSON.stringify({ fileCount, valuesPerFile }) });
}

export function getSnapshot(id: string): Promise<JobSnapshot> {
  return request(`/jobs/${id}/snapshot`);
}

export function getResultPreview(id: string, limit = 20): Promise<ResultPreview> {
  return request(`/jobs/${id}/result/preview?limit=${limit}`);
}

export async function getJobTasks(id: string): Promise<WorkerTaskSummary[]> {
  return (await request<{ workers: WorkerTaskSummary[] }>(`/jobs/${id}/tasks`)).workers;
}

export async function listWorkers(): Promise<Worker[]> {
  return (await request<{ workers: Worker[] }>("/workers")).workers;
}

export function resultHref(job: Job): string | null {
  return job.resultUrl ? BASE + job.resultUrl : null;
}
