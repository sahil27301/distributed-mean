import express, { type Express } from "express";
import type pg from "pg";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";
import type { BlobStore } from "./blob/blobStore.js";
import type { GenerationRunner } from "./generation/runner.js";
import { errorHandler } from "./http/errorHandler.js";
import { createJobsRouter } from "./jobs/routes.js";
import { createWorkersRouter } from "./workers/routes.js";

export interface AppDeps {
  pool: pg.Pool;
  logger: Logger;
  blobs: BlobStore;
  runner: GenerationRunner;
}

export function createApp({ pool, logger, blobs, runner }: AppDeps): Express {
  const app = express();
  app.use(pinoHttp({ logger }));
  app.use(express.json());

  app.get("/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  });
  app.use("/jobs", createJobsRouter({ pool, blobs, runner }));
  app.use("/workers", createWorkersRouter({ pool }));

  app.use(errorHandler);
  return app;
}
