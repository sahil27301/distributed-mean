import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../src/app.js";
import { LocalBlobStore } from "../../src/blob/localBlobStore.js";
import type { GenerationRunner } from "../../src/generation/runner.js";
import { createTestPool, insertJobRow, resetDb, silentLogger } from "./db.js";

let pool: pg.Pool;
let blobs: LocalBlobStore;
let root: string;
const runner: GenerationRunner = { start: async () => {} };
const app = () => createApp({ pool, logger: silentLogger, blobs, runner });

beforeAll(async () => {
  pool = createTestPool();
  root = await mkdtemp(path.join(tmpdir(), "ui-endpoints-"));
  blobs = new LocalBlobStore(root);
});
afterAll(async () => {
  await pool.end();
  await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetDb(pool);
});

async function insertJobsAt(createdAt: string, statuses: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const status of statuses) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO jobs (file_count, values_per_file, status, created_at) VALUES (10, 10, $1, $2) RETURNING id`,
      [status, createdAt],
    );
    ids.push(rows[0]!.id);
  }
  return ids;
}

async function addWorker(id: string, lastSeenSecondsAgo = 0, speedFactor = 2): Promise<void> {
  await pool.query(
    `INSERT INTO workers (id, speed_factor, last_seen_at) VALUES ($1, $2, now() - make_interval(secs => $3))`,
    [id, speedFactor, lastSeenSecondsAgo],
  );
}

async function addItem(jobId: string, filesCovered: number, claim?: { by: string; leaseSeconds: number }, createdBy?: string) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO items (job_id, path, files_covered, claimed_by, claimed_at, lease_expires_at, created_by)
     VALUES ($1, 'p', $2, $3, CASE WHEN $3::text IS NOT NULL THEN now() END,
             now() + make_interval(secs => $4), $5)
     RETURNING id`,
    [jobId, filesCovered, claim?.by ?? null, claim?.leaseSeconds ?? 0, createdBy ?? null],
  );
  return rows[0]!.id;
}

describe("GET /jobs", () => {
  test("pages through jobs sharing one timestamp without skipping or repeating any", async () => {
    // Same microsecond timestamp for all: only the id tiebreak orders them.
    const ids = await insertJobsAt("2026-10-11 12:00:00.123456+00", Array(7).fill("running"));
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await request(app()).get("/jobs").query({ limit: 3, ...(cursor && { cursor }) });
      expect(res.status).toBe(200);
      seen.push(...res.body.jobs.map((j: { id: string }) => j.id));
      cursor = res.body.nextCursor;
    } while (cursor);

    expect(seen).toHaveLength(7);
    expect(new Set(seen)).toEqual(new Set(ids));
  });

  test("newest first, with progress, and no cursor on the last page", async () => {
    const [older] = await insertJobsAt("2026-10-11 10:00:00+00", ["done"]);
    const [newer] = await insertJobsAt("2026-10-11 11:00:00+00", ["generating"]);
    const res = await request(app()).get("/jobs");
    expect(res.body.jobs.map((j: { id: string }) => j.id)).toEqual([newer, older]);
    expect(res.body.jobs[1].progress).toBe(1);
    expect(res.body.nextCursor).toBeNull();
  });

  test("status filter: active means generating or running", async () => {
    await insertJobsAt("2026-10-11 10:00:00+00", ["generating", "running", "done", "failed"]);
    const statuses = async (status: string) =>
      (await request(app()).get("/jobs").query({ status })).body.jobs.map((j: { status: string }) => j.status).sort();
    expect(await statuses("active")).toEqual(["generating", "running"]);
    expect(await statuses("failed")).toEqual(["failed"]);
  });

  test.each([{ cursor: "garbage" }, { limit: "0" }, { limit: "101" }, { status: "running" }])(
    "rejects %o",
    async (query) => {
      expect((await request(app()).get("/jobs").query(query)).status).toBe(400);
    },
  );
});

describe("GET /jobs/:id/snapshot", () => {
  test("items carry their worker only while the lease is live, and their producer", async () => {
    const jobId = await insertJobRow(pool, { fileCount: 6, status: "running" });
    await addWorker("w-live");
    const held = await addItem(jobId, 1, { by: "w-live", leaseSeconds: 30 });
    const expired = await addItem(jobId, 1, { by: "w-dead", leaseSeconds: -5 });
    const partial = await addItem(jobId, 4, undefined, "w-live");

    const res = await request(app()).get(`/jobs/${jobId}/snapshot`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { id: partial, filesCovered: 4, workerId: null, createdBy: "w-live" },
      { id: held, filesCovered: 1, workerId: "w-live", createdBy: null },
      { id: expired, filesCovered: 1, workerId: null, createdBy: null },
    ]);
    expect(res.body.workers).toEqual([
      expect.objectContaining({ id: "w-live", task: expect.objectContaining({ jobId, inputs: 1, filesCovered: 1 }) }),
    ]);
  });

  test("omits items for jobs too large to draw", async () => {
    const jobId = await insertJobRow(pool, { fileCount: 101, status: "running" });
    await addItem(jobId, 1);
    const res = await request(app()).get(`/jobs/${jobId}/snapshot`);
    expect(res.body.items).toBeNull();
    expect(res.body.job.id).toBe(jobId);
  });
});

describe("GET /jobs/:id/result/preview", () => {
  async function doneJobWithResult(lines: number): Promise<string> {
    const csv = Array.from({ length: lines }, (_, i) => `${i}.5`).join("\n") + "\n";
    await blobs.put("results/preview.csv", Buffer.from(csv));
    return insertJobRow(pool, { fileCount: 4, valuesPerFile: lines, status: "done", resultPath: "results/preview.csv" });
  }

  test("returns the first means in file order, and how many there are in total", async () => {
    const jobId = await doneJobWithResult(50);
    const res = await request(app()).get(`/jobs/${jobId}/result/preview`).query({ limit: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ means: [0.5, 1.5, 2.5], total: 50 });
  });

  test("defaults to 20 and returns all of a shorter result", async () => {
    expect((await request(app()).get(`/jobs/${await doneJobWithResult(50)}/result/preview`)).body.means).toHaveLength(20);
    expect((await request(app()).get(`/jobs/${await doneJobWithResult(4)}/result/preview`)).body.means).toEqual([
      0.5, 1.5, 2.5, 3.5,
    ]);
  });

  test("409 until the job is done; 400 on a bad limit", async () => {
    const running = await insertJobRow(pool, { fileCount: 4, status: "running" });
    expect((await request(app()).get(`/jobs/${running}/result/preview`)).status).toBe(409);
    const done = await doneJobWithResult(5);
    expect((await request(app()).get(`/jobs/${done}/result/preview`).query({ limit: 0 })).status).toBe(400);
  });
});

describe("GET /jobs/:id/tasks", () => {
  test("counts each worker's attempts on this job only, most merges first", async () => {
    const jobId = await insertJobRow(pool, { fileCount: 10, status: "done" });
    const otherJob = await insertJobRow(pool, { fileCount: 10, status: "running" });
    await pool.query(
      `INSERT INTO tasks (job_id, worker_id, inputs, files_covered, values_read, final, outcome, claimed_at, finished_at)
       VALUES ($1, 'bbbbbbbbbbbb-1-0001', 5, 5, 50, false, 'committed', now() - interval '2 s', now()),
              ($1, 'aaaaaaaaaaaa-1-0002', 5, 5, 50, false, 'committed', now() - interval '1 s', now()),
              ($1, 'aaaaaaaaaaaa-1-0002', 2, 6, 20, true,  'committed', now() - interval '1 s', now()),
              ($1, 'aaaaaaaaaaaa-1-0002', 3, 3, 30, false, 'lost',      now() - interval '1 s', now()),
              ($1, 'bbbbbbbbbbbb-1-0001', 2, 2, 20, false, 'failed',    now() - interval '1 s', now()),
              ($2, 'cccccccccccc-1-0003', 5, 5, 50, false, 'committed', now() - interval '1 s', now())`,
      [jobId, otherJob],
    );

    const res = await request(app()).get(`/jobs/${jobId}/tasks`);

    expect(res.status).toBe(200);
    expect(res.body.workers).toEqual([
      expect.objectContaining({ label: "aaaaaaaaaaaa", committed: 2, lost: 1, failed: 0, valuesRead: 70 }),
      expect.objectContaining({ label: "bbbbbbbbbbbb", committed: 1, lost: 0, failed: 1, valuesRead: 50 }),
    ]);
  });
});

describe("GET /workers", () => {
  test("lists only workers seen recently, with their stats", async () => {
    const jobId = await insertJobRow(pool, { fileCount: 10, status: "running" });
    await addWorker("aaaaaaaaaaaa-1-ab12", 0, 1.5);
    await addWorker("stale-1-ffff", 60);
    await pool.query(
      `INSERT INTO tasks (job_id, worker_id, inputs, files_covered, values_read, final, outcome, claimed_at, finished_at)
       VALUES ($1, 'aaaaaaaaaaaa-1-ab12', 5, 5, 500, false, 'committed', now() - interval '2 s', now()),
              ($1, 'aaaaaaaaaaaa-1-ab12', 5, 5, 500, false, 'committed', now() - interval '3 s', now()),
              ($1, 'aaaaaaaaaaaa-1-ab12', 2, 2, 200, false, 'lost', now() - interval '5 s', now())`,
      [jobId],
    );

    const res = await request(app()).get("/workers");

    expect(res.body.workers).toHaveLength(1);
    const [worker] = res.body.workers;
    expect(worker).toMatchObject({ label: "aaaaaaaaaaaa", speedFactor: 1.5, task: null });
    expect(worker.stats).toMatchObject({ committed: 2, lost: 1, failed: 0, valuesRead: 1000 });
    expect(worker.stats.busySeconds).toBeCloseTo(10, 0);
    expect(worker.stats.valuesPerBusySecond).toBeCloseTo(100, -1);
  });
});
