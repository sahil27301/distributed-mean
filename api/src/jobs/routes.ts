import { Router, type Request, type Response } from "express";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type pg from "pg";
import type { BlobStore } from "../blob/blobStore.js";
import type { GenerationRunner } from "../generation/runner.js";
import { decodeCursor, listJobs, ListJobsQuerySchema } from "./listJobs.js";
import { getJob, insertJob, type JobRecord } from "./repo.js";
import { readFirstMeans, ResultPreviewQuerySchema } from "./resultPreview.js";
import { getJobSnapshot } from "./snapshot.js";
import { getJobTaskSummary } from "./taskSummary.js";
import { CreateJobSchema, JobIdSchema } from "./schemas.js";
import { toJobResponse } from "./serialize.js";

export interface JobsRouterDeps {
  pool: pg.Pool;
  blobs: BlobStore;
  runner: GenerationRunner;
}

export function createJobsRouter(deps: JobsRouterDeps): Router {
  const router = Router();
  router.post("/", (req, res) => createJob(deps, req, res));
  router.get("/", (req, res) => listJobPage(deps, req, res));
  router.get("/:id", (req, res) => getJobStatus(deps, req, res));
  router.get("/:id/snapshot", (req, res) => getSnapshot(deps, req, res));
  router.get("/:id/result", (req, res) => getJobResult(deps, req, res));
  router.get("/:id/result/preview", (req, res) => getResultPreview(deps, req, res));
  router.get("/:id/tasks", (req, res) => getTaskSummary(deps, req, res));
  return router;
}

async function getResultPreview({ pool, blobs }: JobsRouterDeps, req: Request, res: Response): Promise<void> {
  const query = ResultPreviewQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: z.prettifyError(query.error) });
    return;
  }
  const job = await findJobOrRespond(pool, req, res);
  if (!job) return;
  if (job.status !== "done" || !job.resultPath) {
    res.status(409).json({ error: "job is not done", status: job.status });
    return;
  }
  const means = await readFirstMeans(await blobs.openRead(job.resultPath), query.data.limit);
  req.log.debug({ jobId: job.id, returned: means.length }, "result preview");
  res.json({ means, total: job.valuesPerFile });
}

async function getTaskSummary({ pool }: JobsRouterDeps, req: Request, res: Response): Promise<void> {
  const job = await findJobOrRespond(pool, req, res);
  if (job) res.json({ workers: await getJobTaskSummary(pool, job.id) });
}

async function listJobPage({ pool }: JobsRouterDeps, req: Request, res: Response): Promise<void> {
  const query = ListJobsQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: z.prettifyError(query.error) });
    return;
  }
  const cursor = query.data.cursor ? decodeCursor(query.data.cursor) : null;
  if (query.data.cursor && !cursor) {
    res.status(400).json({ error: "invalid cursor" });
    return;
  }
  const page = await listJobs(pool, query.data, cursor);
  res.json({ jobs: page.jobs.map(toJobResponse), nextCursor: page.nextCursor });
}

async function getSnapshot({ pool }: JobsRouterDeps, req: Request, res: Response): Promise<void> {
  const job = await findJobOrRespond(pool, req, res);
  if (job) res.json(await getJobSnapshot(pool, job));
}

async function createJob({ pool, runner }: JobsRouterDeps, req: Request, res: Response): Promise<void> {
  const parsed = CreateJobSchema.safeParse(req.body);
  if (!parsed.success) {
    req.log.info({ body: req.body }, "rejected job request");
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }

  const job = await insertJob(pool, parsed.data.fileCount, parsed.data.valuesPerFile);
  req.log.info({ jobId: job.id, fileCount: job.fileCount, valuesPerFile: job.valuesPerFile }, "job created");
  void runner.start({ id: job.id, fileCount: job.fileCount, valuesPerFile: job.valuesPerFile });

  res.status(202).location(`/jobs/${job.id}`).json(toJobResponse(job));
}

async function getJobStatus({ pool }: JobsRouterDeps, req: Request, res: Response): Promise<void> {
  const job = await findJobOrRespond(pool, req, res);
  if (job) res.json(toJobResponse(job));
}

async function getJobResult({ pool, blobs }: JobsRouterDeps, req: Request, res: Response): Promise<void> {
  const job = await findJobOrRespond(pool, req, res);
  if (!job) return;

  if (job.status !== "done" || !job.resultPath) {
    res.status(409).json({ error: "job is not done", status: job.status });
    return;
  }

  const url = await blobs.getDownloadUrl(job.resultPath);
  if (url) {
    res.redirect(302, url);
    return;
  }

  const stream = await blobs.openRead(job.resultPath);
  res.type("text/csv").attachment(`${job.id}.csv`);
  await pipeline(stream, res);
}

async function findJobOrRespond(pool: pg.Pool, req: Request, res: Response): Promise<JobRecord | null> {
  const id = JobIdSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "invalid job id" });
    return null;
  }
  const job = await getJob(pool, id.data);
  if (!job) {
    res.status(404).json({ error: "job not found" });
    return null;
  }
  return job;
}
