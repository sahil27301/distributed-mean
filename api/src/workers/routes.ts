import { Router } from "express";
import type pg from "pg";
import { EMPTY_STATS, toWorkerResponse } from "./serialize.js";
import { getWorkerStats, listLiveWorkers } from "./repo.js";

export function createWorkersRouter({ pool }: { pool: pg.Pool }): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    const workers = await listLiveWorkers(pool);
    const stats = await getWorkerStats(
      pool,
      workers.map((w) => w.id),
    );
    res.json({ workers: workers.map((w) => toWorkerResponse(w, stats.get(w.id) ?? EMPTY_STATS)) });
  });
  return router;
}
