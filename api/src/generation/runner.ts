import { markJobFailed, type JobSpec } from "../jobs/repo.js";
import { createLimiter } from "../lib/limiter.js";
import { generateJob, type GenerationDeps } from "./generateJob.js";

export interface GenerationRunner {
  /** Queues generation; the returned promise settles when it finishes and never rejects. */
  start(job: JobSpec): Promise<void>;
}

export function createGenerationRunner(deps: GenerationDeps & { concurrency: number }): GenerationRunner {
  const limit = createLimiter(deps.concurrency);

  return {
    start(job) {
      deps.logger.info({ jobId: job.id, concurrency: deps.concurrency }, "generation queued");
      return limit(() => generateJob(deps, job)).then(
        () => undefined,
        (err: unknown) => failJob(deps, job.id, err),
      );
    },
  };
}

async function failJob({ pool, logger }: GenerationDeps, jobId: string, err: unknown): Promise<void> {
  logger.error({ jobId, err }, "generation failed");
  try {
    await markJobFailed(pool, jobId, err instanceof Error ? err.message : String(err));
  } catch (markErr) {
    logger.error({ jobId, err: markErr }, "could not mark job failed; it stays generating and resumes on restart");
  }
}
