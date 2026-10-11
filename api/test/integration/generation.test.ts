import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { LocalBlobStore } from "../../src/blob/localBlobStore.js";
import { rawPath } from "../../src/blob/paths.js";
import { generateFile } from "../../src/generation/generateFile.js";
import { generateJob } from "../../src/generation/generateJob.js";
import { resumeGeneration } from "../../src/generation/resume.js";
import { createGenerationRunner, type GenerationRunner } from "../../src/generation/runner.js";
import { getJob, insertJob, type JobSpec } from "../../src/jobs/repo.js";
import { createTestPool, insertJobRow, resetDb, silentLogger } from "./db.js";

let pool: pg.Pool;
let root: string;
let blobs: LocalBlobStore;

beforeAll(() => {
  pool = createTestPool();
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetDb(pool);
  root = await mkdtemp(path.join(tmpdir(), "gen-"));
  blobs = new LocalBlobStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function itemsOf(jobId: string) {
  const { rows } = await pool.query<{ path: string; files_covered: number; claimed_by: string | null }>(
    `SELECT path, files_covered, claimed_by FROM items WHERE job_id = $1`,
    [jobId],
  );
  return rows;
}

describe("generateJob", () => {
  test("writes every raw file and enqueues one unclaimed item per file at the same path", async () => {
    const job = await insertJob(pool, 7, 16);
    expect(await generateJob({ pool, blobs, logger: silentLogger }, job)).toBe(true);

    for (let i = 0; i < 7; i++) {
      const bytes = await readFile(path.join(root, rawPath(job.id, i)));
      expect(bytes.equals(generateFile(job.id, i, 16))).toBe(true);
    }
    const items = await itemsOf(job.id);
    expect(items.map((it) => it.path).sort()).toEqual(
      Array.from({ length: 7 }, (_, i) => rawPath(job.id, i)).sort(),
    );
    expect(items.every((it) => it.files_covered === 1 && it.claimed_by === null)).toBe(true);
    expect((await getJob(pool, job.id))?.status).toBe("running");
  });

  test("concurrent generations of the same job flip once and enqueue items once", async () => {
    const job = await insertJob(pool, 20, 8);
    const deps = { pool, blobs, logger: silentLogger };
    const results = await Promise.all([generateJob(deps, job), generateJob(deps, job), generateJob(deps, job)]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await itemsOf(job.id)).toHaveLength(20);
  });

  test("skips files that already exist instead of rewriting them", async () => {
    const job = await insertJob(pool, 3, 4);
    const sentinel = Buffer.from("already-here");
    await blobs.put(rawPath(job.id, 0), sentinel);

    await generateJob({ pool, blobs, logger: silentLogger }, job);

    expect((await readFile(path.join(root, rawPath(job.id, 0)))).equals(sentinel)).toBe(true);
    expect((await readFile(path.join(root, rawPath(job.id, 1)))).equals(generateFile(job.id, 1, 4))).toBe(true);
  });

  test("does not enqueue anything for a job that is no longer generating", async () => {
    const jobId = await insertJobRow(pool, { fileCount: 3, status: "failed" });
    const flipped = await generateJob({ pool, blobs, logger: silentLogger }, { id: jobId, fileCount: 3, valuesPerFile: 4 });

    expect(flipped).toBe(false);
    expect(await itemsOf(jobId)).toHaveLength(0);
  });
});

describe("generation runner", () => {
  test("a storage error marks the job failed with the reason and enqueues nothing", async () => {
    class FullDisk extends LocalBlobStore {
      override async put(): Promise<void> {
        throw new Error("ENOSPC: no space left on device");
      }
    }
    const runner = createGenerationRunner({ pool, blobs: new FullDisk(root), logger: silentLogger, concurrency: 1 });
    const job = await insertJob(pool, 3, 4);

    await runner.start(job);

    const after = await getJob(pool, job.id);
    expect(after?.status).toBe("failed");
    expect(after?.error).toContain("ENOSPC");
    expect(await itemsOf(job.id)).toHaveLength(0);
  });
});

describe("resumeGeneration", () => {
  test("restarts only jobs still in generating", async () => {
    const generating = await insertJobRow(pool, { fileCount: 3, status: "generating" });
    await insertJobRow(pool, { fileCount: 3, status: "running" });
    await insertJobRow(pool, { fileCount: 3, status: "done", resultPath: "results/x.csv" });

    const started: JobSpec[] = [];
    const runner: GenerationRunner = { start: async (job) => void started.push(job) };

    expect(await resumeGeneration({ pool, runner, logger: silentLogger })).toBe(1);
    expect(started).toEqual([{ id: generating, fileCount: 3, valuesPerFile: 10 }]);
  });
});
