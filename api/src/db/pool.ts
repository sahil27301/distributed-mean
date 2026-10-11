import pg from "pg";
import type { Logger } from "pino";

export function createPool(databaseUrl: string, logger: Logger): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  pool.on("error", (err) => logger.error({ err }, "idle postgres client error"));
  return pool;
}
