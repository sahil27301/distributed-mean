# Distributed Mean

Computes the per-index mean across F files of C random integers, using an API, Postgres, and a fleet of W Python workers that each read at most 5 inputs per task.

Workers merge `(sum, files covered)` partials in a tree whose shape emerges at runtime: any 2–5 ready items of a job can be merged, largest partials first. Postgres is both the queue and the source of truth, and each commit consumes its inputs and records its output in one transaction, so every file is counted exactly once even when workers crash, stall, or race. Integer sums make the result exact.

The full design is in [`docs/design.md`](docs/design.md); the key decisions are in [`docs/decisions/`](docs/decisions/) (ITD 1–8).

## Quick start

Requires Docker.

```bash
docker compose up -d --build          # postgres, api, 4 workers, ui
WORKERS=8 docker compose up -d        # or any number of workers
```

Open [localhost:8080](http://localhost:8080) for the UI: create jobs (with presets, several at once), follow their progress, and watch jobs of up to 100 files merge live. The job page draws the queue, in claim order, above one station per worker. Files move into the worker that claimed them, and the partial it produces moves back, coloured by how many files it covers. The Workers page shows what each worker is doing now, plus its stats from `tasks`. Try `docker kill <worker name>` during a job: the station turns red until its lease expires and another worker picks the files up.

```bash
# create a job: 202 + Location header
curl -i -X POST localhost:3000/jobs -H 'content-type: application/json' \
  -d '{"fileCount": 1000, "valuesPerFile": 10000}'

# poll status and progress
curl localhost:3000/jobs/<id>

# download the result once status is "done" (one mean per line)
curl -L localhost:3000/jobs/<id>/result -o means.csv
```

For UI development, `cd ui && npm run dev` serves on port 5173 and proxies `/api` to the API on port 3000 (override with `API_URL`).

Logs: `docker compose logs -f api` and `docker compose logs -f worker`. API logs are JSON (pipe through `npx pino-pretty` to read them).

## API

| Method | Path               | Response                                                                                     |
| ------ | ------------------ | -------------------------------------------------------------------------------------------- |
| POST   | `/jobs`            | `202` with the job and `Location: /jobs/{id}`; `400` if invalid                              |
| GET    | `/jobs/:id`        | `200` with `status` (`generating` → `running` → `done`/`failed`), `progress` (0–1), `resultUrl` when done, `error` when failed; `404`/`400` |
| GET    | `/jobs/:id/result` | `200` CSV stream (local storage) or `302` to a direct URL (S3); `409` until done; `404`      |
| GET    | `/jobs?limit&cursor&status` | Newest first, keyset-paginated: `{ jobs, nextCursor }`; `status` is `active`, `done` or `failed` |
| GET    | `/jobs/:id/snapshot` | Job, its items (id, size, holder, producer) when F ≤ 100, and live workers; what the UI board polls |
| GET    | `/jobs/:id/result/preview?limit` | First 1–100 means (default 20) and the total count; reads only the start of the file; `409` until done |
| GET    | `/jobs/:id/tasks`  | Per-worker merges, lost leases, failed attempts, values read and busy time for this job |
| GET    | `/workers`         | Workers seen in the last 15 s, each with its current task and lifetime stats                 |

Limits: `fileCount` 2–99,999 and `valuesPerFile` 2–999,999 (the problem's 1 < F < 100k, 1 < C < 1M). Values are integers 0–999.

## How it works

1. `POST /jobs` stores the job as `generating` and returns. In the background the API writes F raw files (deterministic PRNG, int32 little-endian), then in one transaction flips the job to `running` and enqueues one item per file. If the API dies mid-generation, it resumes on startup.
2. Each worker loops: claim 2–5 unleased items from the least recently served running job (round robin), sum them, write one partial, commit. A 30 s lease, renewed every 10 s by a heartbeat thread, lets other workers take over from a crashed one.
3. The commit deletes the inputs and inserts the partial atomically; if any input is already gone, another attempt won and this one rolls back. The merge that covers all F files writes the CSV and marks the job `done` in the same transaction.
4. An item claimed more than 3 times (e.g. a corrupted file that crashes every worker) fails its job instead of retrying forever.

## Configuration

Worker speed is simulated so heterogeneity is visible: `delay = speed_factor × jitter(0.8–1.5) × (overhead + values_read / 1M × seconds_per_million_values)`.

| Variable                     | Default           | Effect                                                                   |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------ |
| `WORKERS`                    | 4                 | Number of worker replicas                                                |
| `WORKER_SPEED_FACTOR`        | random 1–4 each   | Set a number to make every worker equally fast                           |
| `SECONDS_PER_MILLION_VALUES` | 1.0               | Slows all workers equally; raise it to watch a job progress              |
| `TASK_OVERHEAD_SECONDS`      | 0                 | Fixed cost per task; makes speed differences visible on small jobs       |

Set them in the shell, e.g. `WORKER_SPEED_FACTOR=1 SECONDS_PER_MILLION_VALUES=5 docker compose up -d`. Lease, heartbeat and poll intervals are in [`worker/worker/config.py`](worker/worker/config.py); generation concurrency is `GENERATION_CONCURRENCY` on the API (default 2).

### Operating workers while jobs run

```bash
docker compose up -d --scale worker=6                  # add workers; running ones are untouched
docker compose up -d --scale worker=2                  # remove workers: SIGTERM, each finishes its current task first
docker kill <worker name>                              # crash one (name = container id, shown in the UI)
docker start <worker name>                             # bring it back as a new worker (new id, fresh stats)
WORKER_SPEED_FACTOR=4 docker compose up -d worker      # change speed: recreates all workers, gracefully
```

Speed settings are read at startup, so changing them recreates the workers. That's safe mid-job: on SIGTERM a worker finishes its current task, with up to 60 s (`stop_grace_period`) before compose kills it. If it is killed, its files return to the queue when the lease expires, so no work is lost either way. There's no restart policy, so a killed worker stays down until you start it again; that's deliberate, so a crash is visible on the board.

## Stats

Every finished task attempt is a row in `tasks` (committed, lost, or failed). The committed row is written in the same transaction as the merge itself, so it is exactly as reliable as the result. Query with `docker compose exec postgres psql -U mean -d mean`:

```sql
-- per worker: work done, wasted attempts, throughput while busy
SELECT worker_id,
       count(*) FILTER (WHERE outcome = 'committed')  AS committed,
       count(*) FILTER (WHERE outcome <> 'committed') AS wasted,
       round(sum(values_read) / 1e6 / sum(extract(epoch FROM finished_at - claimed_at)), 2) AS mvalues_per_busy_sec
FROM tasks GROUP BY worker_id ORDER BY committed DESC;

-- per job: generation vs merge time, tasks, waste, slowest task, and a correctness invariant
SELECT j.id, j.file_count, j.values_per_file, j.status,
       round(extract(epoch FROM j.running_at - j.created_at), 1)   AS generation_s,
       round(extract(epoch FROM j.completed_at - j.running_at), 1) AS merge_s,
       count(t.*) FILTER (WHERE t.outcome = 'committed')           AS tasks,
       count(t.*) FILTER (WHERE t.outcome <> 'committed')          AS wasted,
       sum(t.inputs - 1) FILTER (WHERE t.outcome = 'committed') = j.file_count - 1 AS invariant_ok,
       round(max(extract(epoch FROM t.finished_at - t.claimed_at)), 2) AS slowest_task_s
FROM jobs j LEFT JOIN tasks t ON t.job_id = j.id
GROUP BY j.id ORDER BY j.created_at;
```

`invariant_ok`: every k-way merge removes k − 1 items, so a finished job's committed tasks must sum to F − 1. Attempts cut short by a crash leave no row; they show up as `items.attempts` instead.

## Tests

Database-backed tests need Postgres from compose running (`docker compose up -d postgres`). Each suite creates its own database from `db/001_init.sql` and never touches the dev data.

```bash
cd api && npm install && npm test            # unit + integration (vitest)
cd worker && uv sync && uv run pytest        # unit + in-process multi-worker runs (pytest)
cd ui && npm install && npm test             # board placement and colour scale (vitest)
python3 scripts/e2e.py                       # against the running stack, ~2–3 min (--quick skips crash scenarios)
```

The end-to-end script checks validation and status codes, edge sizes (F = 2, 5, 6), four concurrent jobs, a worker killed with `SIGKILL` mid-job, and the API killed mid-generation. Every result is compared for exact equality with a numpy mean computed from the raw files, and the CSV downloaded through the API must match byte for byte.

## Layout

```
api/            Node + Express + TypeScript: endpoints, generation, resume
worker/         Python: claim / merge / heartbeat / commit loop, presence
ui/             React + Vite: jobs, live job board, workers (nginx in compose, proxies /api)
db/             schema (applied by postgres on first start)
scripts/e2e.py  end-to-end checks against the running stack
docs/           design doc, decisions (ITDs), notes
```

## Limitations

- Blobs live on a shared Docker volume, so everything runs on one host. Storage is behind a `BlobStore` interface; S3 is the multi-host path (ITD 7).
- One API instance (resume after a crash would duplicate generation work with several, though never enqueue a job twice).
- Orphan files (an attempt that wrote a partial and then lost or crashed before commit) are not garbage-collected yet.
- The schema only applies to an empty volume; after changing `db/001_init.sql`, run `docker compose down -v`.
