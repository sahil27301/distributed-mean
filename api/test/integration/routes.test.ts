import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../src/app.js";
import type { BlobStore } from "../../src/blob/blobStore.js";
import { LocalBlobStore } from "../../src/blob/localBlobStore.js";
import type { GenerationRunner } from "../../src/generation/runner.js";
import type { JobSpec } from "../../src/jobs/repo.js";
import { createTestPool, insertItems, insertJobRow, resetDb, silentLogger } from "./db.js";

let pool: pg.Pool;
let root: string;
let started: JobSpec[];

const recordingRunner: GenerationRunner = { start: async (job) => void started.push(job) };

function appWith(blobs: BlobStore = new LocalBlobStore(root)) {
  return createApp({ pool, logger: silentLogger, blobs, runner: recordingRunner });
}

beforeAll(() => {
  pool = createTestPool();
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetDb(pool);
  root = await mkdtemp(path.join(tmpdir(), "routes-"));
  started = [];
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("POST /jobs", () => {
  test("creates a generating job, starts generation, and points at the status URL", async () => {
    const res = await request(appWith()).post("/jobs").send({ fileCount: 12, valuesPerFile: 34 });

    expect(res.status).toBe(202);
    expect(res.headers.location).toBe(`/jobs/${res.body.id}`);
    expect(res.body).toMatchObject({ status: "generating", fileCount: 12, valuesPerFile: 34, progress: 0 });
    expect(started).toEqual([{ id: res.body.id, fileCount: 12, valuesPerFile: 34 }]);

    const { rows } = await pool.query(`SELECT status FROM jobs WHERE id = $1`, [res.body.id]);
    expect(rows).toEqual([{ status: "generating" }]);
  });

  test.each([
    { fileCount: 1, valuesPerFile: 10 },
    { fileCount: 100_000, valuesPerFile: 10 },
    { fileCount: "10", valuesPerFile: 10 },
    {},
  ])("rejects %o without creating a job", async (body) => {
    const res = await request(appWith()).post("/jobs").send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
    expect(started).toHaveLength(0);
    expect((await pool.query(`SELECT 1 FROM jobs`)).rowCount).toBe(0);
  });

  test("malformed JSON is a 400, not a 500", async () => {
    const res = await request(appWith()).post("/jobs").set("content-type", "application/json").send("{bad");
    expect(res.status).toBe(400);
  });
});

describe("GET /jobs/:id", () => {
  test("404 for an unknown job, 400 for a malformed id", async () => {
    expect((await request(appWith()).get(`/jobs/${randomUUID()}`)).status).toBe(404);
    expect((await request(appWith()).get("/jobs/not-a-uuid")).status).toBe(400);
  });

  test("progress counts removed items over the F − 1 removals a job needs", async () => {
    const jobId = await insertJobRow(pool, { fileCount: 5, status: "running" });
    await insertItems(pool, jobId, [3, 1, 1]);

    const res = await request(appWith()).get(`/jobs/${jobId}`);

    expect(res.status).toBe(200);
    expect(res.body.progress).toBe(0.5);
    expect(res.body).not.toHaveProperty("resultUrl");
  });

  test("a done job reports full progress and its result URL", async () => {
    const jobId = await insertJobRow(pool, { fileCount: 5, status: "done", resultPath: "results/x.csv" });

    const res = await request(appWith()).get(`/jobs/${jobId}`);

    expect(res.body).toMatchObject({ status: "done", progress: 1, resultUrl: `/jobs/${jobId}/result` });
    expect(res.body.completedAt).toEqual(expect.any(String));
  });
});

describe("GET /jobs/:id/result", () => {
  test("409 while the job is not done", async () => {
    const jobId = await insertJobRow(pool, { fileCount: 5, status: "running" });
    const res = await request(appWith()).get(`/jobs/${jobId}/result`);
    expect(res.status).toBe(409);
    expect(res.body.status).toBe("running");
  });

  test("streams the CSV when storage has no direct URL", async () => {
    const blobs = new LocalBlobStore(root);
    const jobId = await insertJobRow(pool, { fileCount: 2, status: "done", resultPath: "results/r.csv" });
    await blobs.put("results/r.csv", Buffer.from("1.5\n2.5\n"));

    const res = await request(appWith(blobs)).get(`/jobs/${jobId}/result`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.text).toBe("1.5\n2.5\n");
  });

  test("redirects when storage provides a direct URL", async () => {
    class DirectUrlStore extends LocalBlobStore {
      override async getDownloadUrl(p: string): Promise<string> {
        return `https://blobs.example/${p}?sig=abc`;
      }
    }
    const jobId = await insertJobRow(pool, { fileCount: 2, status: "done", resultPath: "results/r.csv" });

    const res = await request(appWith(new DirectUrlStore(root))).get(`/jobs/${jobId}/result`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://blobs.example/results/r.csv?sig=abc");
  });
});
