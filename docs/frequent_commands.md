# Frequent commands

Run these from the repo root.

## Stack

```bash
docker compose up -d --build                              # postgres, api, 4 workers
WORKERS=8 docker compose up -d                            # scale the worker fleet
docker compose ps
docker compose down                                       # stop; keeps volumes
docker compose down -v                                    # also wipe postgres + blobs
```

`down -v` is required after changing `db/001_init.sql`. The schema is only applied to an empty volume.

## Workers

`restart` keeps the environment the container was created with. Recreate to change speed:

```bash
SECONDS_PER_MILLION_VALUES=5 docker compose up -d --no-deps --force-recreate worker
WORKERS=8 WORKER_SPEED_FACTOR=1 SECONDS_PER_MILLION_VALUES=5 \
  docker compose up -d --no-deps --force-recreate worker
```

| Variable                     | Default         | Effect                                              |
| ---------------------------- | --------------- | --------------------------------------------------- |
| `WORKERS`                    | 4               | Replica count. Pass it again or the fleet drops to 4. |
| `WORKER_SPEED_FACTOR`        | random 1–4 each | A number makes every worker equally fast.           |
| `SECONDS_PER_MILLION_VALUES` | 1.0             | Scales every worker equally.                        |
| `TASK_OVERHEAD_SECONDS`      | 0               | Fixed cost per task.                                |

## Logs

```bash
docker compose logs -f --tail=100          # everything
docker compose logs -f --tail=100 worker   # all worker replicas
docker compose logs -f --tail=100 api
docker compose logs -f api | npx pino-pretty
```

One replica: `docker compose ps`, then `docker logs -f <container>`.

## Database

```bash
docker compose exec postgres psql -U mean -d mean
```

One shot, no pager:

```bash
docker compose exec -T postgres psql -U mean -d mean -c 'SELECT id, status FROM jobs ORDER BY created_at DESC LIMIT 5;'
```

User `mean`, database `mean`, password `mean`, host port `5432`.

## Task stats

Every finished attempt is a row in `tasks` (`committed`, `lost`, or `failed`). A crash before commit leaves no row; that shows up as `items.attempts`.

Per worker:

```sql
SELECT worker_id,
       count(*) FILTER (WHERE outcome = 'committed')  AS committed,
       count(*) FILTER (WHERE outcome <> 'committed') AS wasted,
       round(sum(values_read) / 1e6
             / nullif(sum(extract(epoch FROM finished_at - claimed_at)), 0), 2) AS mvalues_per_busy_sec
FROM tasks
GROUP BY worker_id
ORDER BY committed DESC;
```

Per job:

```sql
SELECT j.id, j.file_count, j.values_per_file, j.status,
       round(extract(epoch FROM j.running_at - j.created_at), 1)   AS generation_s,
       round(extract(epoch FROM j.completed_at - j.running_at), 1) AS merge_s,
       count(t.*) FILTER (WHERE t.outcome = 'committed')           AS tasks,
       count(t.*) FILTER (WHERE t.outcome <> 'committed')          AS wasted,
       sum(t.inputs - 1) FILTER (WHERE t.outcome = 'committed') = j.file_count - 1 AS invariant_ok,
       round(max(extract(epoch FROM t.finished_at - t.claimed_at)), 2) AS slowest_task_s
FROM jobs j
LEFT JOIN tasks t ON t.job_id = j.id
GROUP BY j.id
ORDER BY j.created_at;
```

`invariant_ok`: a k-way merge removes k − 1 items, so committed tasks on a finished job must sum to F − 1.

Same job, split by worker (replace the id):

```sql
SELECT worker_id,
       count(*) FILTER (WHERE outcome = 'committed')  AS committed,
       count(*) FILTER (WHERE outcome <> 'committed') AS wasted,
       round(sum(values_read) / 1e6, 2) AS mvalues,
       round(max(extract(epoch FROM finished_at - claimed_at)), 2) AS slowest_s
FROM tasks
WHERE job_id = '<id>'
GROUP BY worker_id
ORDER BY committed DESC;
```

What is in flight right now:

```sql
SELECT j.id, j.status, j.file_count,
       count(i.*) AS items_left,
       count(i.*) FILTER (WHERE i.claimed_by IS NOT NULL) AS leased
FROM jobs j
LEFT JOIN items i ON i.job_id = j.id
WHERE j.status IN ('generating', 'running')
GROUP BY j.id;
```
