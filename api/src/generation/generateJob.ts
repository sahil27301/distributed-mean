import type pg from "pg";
import type { Logger } from "pino";
import type { BlobStore } from "../blob/blobStore.js";
import { rawPath } from "../blob/paths.js";
import { flipToRunning, type JobSpec } from "../jobs/repo.js";
import { generateFile } from "./generateFile.js";

export interface GenerationDeps {
  pool: pg.Pool;
  blobs: BlobStore;
  logger: Logger;
}

/**
 * Writes any missing raw files, then flips the job to running. Safe to call repeatedly or
 * concurrently for the same job: files are deterministic and the flip happens at most once.
 */
export async function generateJob(deps: GenerationDeps, job: JobSpec): Promise<boolean> {
  const log = deps.logger.child({ jobId: job.id });
  const startedAt = Date.now();
  log.info({ fileCount: job.fileCount, valuesPerFile: job.valuesPerFile }, "generation started");

  const { written, skipped } = await writeRawFiles(deps.blobs, job, log);
  const flipped = await flipToRunning(deps.pool, job.id);

  log.info(
    { written, skipped, flipped, durationMs: Date.now() - startedAt },
    flipped ? "generation finished, job running" : "generation finished, job was already flipped",
  );
  return flipped;
}

async function writeRawFiles(
  blobs: BlobStore,
  job: JobSpec,
  log: Logger,
): Promise<{ written: number; skipped: number }> {
  const progressEvery = Math.max(1, Math.floor(job.fileCount / 10));
  let written = 0;
  let skipped = 0;

  for (let i = 0; i < job.fileCount; i++) {
    const path = rawPath(job.id, i);
    if (await blobs.exists(path)) {
      skipped++;
    } else {
      await blobs.put(path, generateFile(job.id, i, job.valuesPerFile));
      written++;
    }
    if ((i + 1) % progressEvery === 0) {
      log.debug({ done: i + 1, fileCount: job.fileCount, written, skipped }, "generation progress");
    }
  }
  return { written, skipped };
}
