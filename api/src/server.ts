import { createApp } from "./app.js";
import { LocalBlobStore } from "./blob/localBlobStore.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { resumeGeneration } from "./generation/resume.js";
import { createGenerationRunner } from "./generation/runner.js";
import { createLogger } from "./logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const pool = createPool(config.DATABASE_URL, logger);

  await pool.query("SELECT 1");
  logger.info({ blobRoot: config.BLOB_ROOT }, "connected to postgres");

  const blobs = new LocalBlobStore(config.BLOB_ROOT);
  const runner = createGenerationRunner({ pool, blobs, logger, concurrency: config.GENERATION_CONCURRENCY });
  await resumeGeneration({ pool, runner, logger });

  const app = createApp({ pool, logger, blobs, runner });
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, "api listening");
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("api failed to start", err);
  process.exit(1);
});
