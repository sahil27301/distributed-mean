import type pg from "pg";
import type { Logger } from "pino";
import { listGeneratingJobs } from "../jobs/repo.js";
import type { GenerationRunner } from "./runner.js";

/** Restarts generation for jobs whose in-process generation died with a previous API process. */
export async function resumeGeneration(deps: {
  pool: pg.Pool;
  runner: GenerationRunner;
  logger: Logger;
}): Promise<number> {
  const jobs = await listGeneratingJobs(deps.pool);
  deps.logger.info({ count: jobs.length, jobIds: jobs.map((j) => j.id) }, "resuming generation");
  for (const job of jobs) {
    void deps.runner.start(job);
  }
  return jobs.length;
}
