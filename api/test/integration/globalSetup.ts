import { readFile } from "node:fs/promises";
import pg from "pg";
import { TEST_DATABASE_URL } from "./db.js";

const SCHEMA_PATH = new URL("../../../db/001_init.sql", import.meta.url);

/** Recreates the test database from the real schema on every run, so tests never drift from it. */
export async function setup(): Promise<void> {
  const target = new URL(TEST_DATABASE_URL);
  const dbName = target.pathname.slice(1);
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(await readFile(SCHEMA_PATH, "utf8"));
  } finally {
    await client.end();
  }
}
