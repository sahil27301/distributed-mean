import type pg from "pg";
import { z } from "zod";
import { JOB_COLUMNS, toRecord, type JobRecord, type JobRow, type JobStatus } from "./repo.js";

const STATUS_FILTERS: Record<string, JobStatus[]> = {
  active: ["generating", "running"],
  done: ["done"],
  failed: ["failed"],
};

export const ListJobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  status: z.enum(["active", "done", "failed"]).optional(),
});

export type ListJobsQuery = z.infer<typeof ListJobsQuerySchema>;

interface Cursor {
  createdAt: string;
  id: string;
}

const CursorSchema = z.tuple([z.string(), z.uuid()]);

/**
 * The cursor carries Postgres's own text form of created_at (microsecond precision). A JS Date
 * would round to milliseconds and skip or repeat rows created within the same millisecond.
 */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id])).toString("base64url");
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed = CursorSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return parsed.success ? { createdAt: parsed.data[0], id: parsed.data[1] } : null;
  } catch {
    return null;
  }
}

export interface JobPage {
  jobs: JobRecord[];
  nextCursor: string | null;
}

export async function listJobs(pool: pg.Pool, query: ListJobsQuery, cursor: Cursor | null): Promise<JobPage> {
  const statuses = query.status ? STATUS_FILTERS[query.status]! : null;
  const { rows } = await pool.query<JobRow & { cursor_ts: string }>(
    `SELECT ${JOB_COLUMNS}, j.created_at::text AS cursor_ts,
            (SELECT count(*) FROM items i WHERE i.job_id = j.id)::int AS items_remaining
     FROM jobs j
     WHERE ($1::text[] IS NULL OR j.status = ANY($1::text[]))
       AND ($2::timestamptz IS NULL OR (j.created_at, j.id) < ($2::timestamptz, $3::uuid))
     ORDER BY j.created_at DESC, j.id DESC
     LIMIT $4`,
    [statuses, cursor?.createdAt ?? null, cursor?.id ?? null, query.limit + 1],
  );

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    jobs: page.map(toRecord),
    nextCursor: rows.length > query.limit && last ? encodeCursor({ createdAt: last.cursor_ts, id: last.id }) : null,
  };
}
