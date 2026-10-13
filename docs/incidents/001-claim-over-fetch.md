# Incident 001: one claim took a whole job

**Status:** fixed. **Impact:** the "at most 5 files per task" rule was violated; results stayed correct.

## Symptom

A job with 100 files was merged by one worker in one task:

```
claimed ... inputs=100 files_covered=100/100 final=True
job done ... duration=14.323s
```

The expected outcome is about 25 tasks of at most 5 inputs, spread across workers. The `tasks` row confirmed `inputs = 100`. The mean was still exact, because merging is associative (ITD 1); only the fan-in limit (ITD 4) and the parallelism were lost.

## Root cause

The claim used to look like this:

```sql
UPDATE items SET claimed_by = :worker, ...
WHERE id IN (
  SELECT id FROM items
  WHERE job_id = :job AND (claimed_by IS NULL OR lease_expires_at < now())
  ORDER BY files_covered DESC
  LIMIT 5
  FOR UPDATE SKIP LOCKED
)
```

It was only correct if Postgres ran the subquery once. Nothing guarantees that.

### 1. The planner picks how a query runs, from statistics

Postgres doesn't count rows before planning. It estimates them from saved statistics in `pg_class`:

- `relpages` is the number of 8 KB pages the table had at the last `ANALYZE`;
- `reltuples` is the number of live rows it had then.

The estimate is current pages × (`reltuples` / `relpages`).

`items` churns: every job inserts its files, and merges and completion delete them all. A `DELETE` doesn't erase a row. It leaves a dead row version in its page until `VACUUM` reclaims the space (MVCC). So the table often has pages but no live rows. If autovacuum's `ANALYZE` runs right after a job finishes, it records "N pages, 0 rows". Every later estimate then comes out as about 1 row, however many items exist by the time the next claim runs.

### 2. With an estimate of 1 row, the planner picks a nested loop

```
Update on items
  ->  Nested Loop Semi Join
        Join Filter: (items.id = "ANY_subquery".id)
        ->  Seq Scan on items                                  outer: each row of items...
        ->  Subquery Scan on "ANY_subquery"                    inner: ...rerun until it matches
              ->  Limit -> LockRows -> Sort -> Seq Scan on items
```

A nested loop reruns ("rescans") the inner side for every outer row. For a 1-row outer side that's the cheapest plan.

With healthy stats, the planner instead picks a `Hash Semi Join`. That plan runs the subquery once, hashes its 5 ids, and probes the hash table while scanning `items`. Both plans normally return the same result, and the choice is only about speed.

### 3. Rerunning a locking subquery inside an `UPDATE` gives a different answer each time

An `UPDATE` doesn't change a row in place. It writes a new version and marks the old one as replaced. Once the outer loop has updated r1, r1 exists in two versions, and the two steps of the inner query look at different ones:

- **The scan and filter** read through the statement's snapshot, the database as of statement start. The snapshot shows the old r1 with `claimed_by = NULL`, so r1 still passes `claimed_by IS NULL`.
- **`LockRows`** (the `FOR UPDATE` step) has to check a row's latest state, not the snapshot. It finds that this version was already replaced by the current command, and it deliberately skips the row. Locking it would let one statement update the same row twice (the "Halloween problem"). This is not a lock conflict: rows that this transaction has only locked, without updating them, are still the latest version, and re-locking a row you hold succeeds.

So each rerun returns the top 5 of the rows **not yet updated by this statement**. Without `FOR UPDATE` there is no `LockRows` step: every rerun filters the same snapshot and returns the same 5 rows, so the plan stays correct.

The window slides as the outer loop advances:

| Outer row | Inner rerun returns | Match? |
| --------- | ------------------- | ------ |
| r1        | r1–r5               | r1 updated |
| r2        | r2–r6 (r1 dropped)  | r2 updated |
| r3        | r3–r7               | r3 updated |
| …         | …                   | …      |

When all items are the same size (all leaves), the sort order matches the scan order, so every outer row matches and the whole job is claimed. With mixed sizes, some outer rows fall outside the current window, and the count lands somewhere between 5 and all of them.

Locks taken by `FOR UPDATE` last until the transaction ends. Here, rows that were locked but never updated stay locked until the claim commits.

### Verified behaviour

Each case below ran in a rolled-back transaction on the dev database, with stats reading "3 pages, 0 rows" and 30 new items of one job:

| Variant                                     | Rows updated with `LIMIT 5` |
| ------------------------------------------- | --------------------------- |
| `FOR UPDATE SKIP LOCKED`, equal sizes       | 30                          |
| `FOR UPDATE SKIP LOCKED`, mixed sizes       | 9                           |
| plain `FOR UPDATE`, equal sizes             | 30                          |
| no locking clause, same nested-loop plan    | 5                           |
| `MATERIALIZED` CTE (the fix)                | 5                           |
| Two `SKIP LOCKED` selects in one transaction | second returns the same 5 rows; own locks are not skipped |

The combination that breaks is "row locking in a subquery that gets rerun" plus "an outer `UPDATE`". `SKIP LOCKED` is not needed for it, and without locking there is no bug.

### Why the tests didn't catch it

The tests run on a freshly created or truncated table. A table with 0 pages makes the planner estimate rows from row width instead, which gives a bigger estimate and the safe hash plan. The bug needs the "pages exist, 0 live rows" state that only real churn produces.

## Fix

Pick the rows in a `MATERIALIZED` CTE. A CTE (common table expression) is a named subquery written in `WITH`. `MATERIALIZED` makes Postgres run it once and store the result, instead of folding it back into the main query:

```sql
WITH picked AS MATERIALIZED (
  SELECT id FROM items
  WHERE job_id = :job AND (claimed_by IS NULL OR lease_expires_at < now())
  ORDER BY files_covered DESC
  LIMIT 5
  FOR UPDATE SKIP LOCKED
)
UPDATE items SET claimed_by = :worker, ...
FROM picked
WHERE items.id = picked.id
RETURNING ...
```

The planner may still choose any algorithm (nested loop, hash, or merge) for the join between `items` and `picked`. All of them are safe: rescanning a CTE re-reads the stored rows and never reruns the locking query.

## Defenses added

- **Query:** the claim uses the CTE above (`worker/worker/jobqueue.py`, `CLAIM_ITEMS`).
- **Worker guard:** `claim()` raises `FanInExceeded` if a claim returns more than `max_fan_in` rows. The claim transaction rolls back, including the `attempts` increments, and the main loop logs the error and keeps going. A recurrence stalls the job loudly instead of silently breaking the limit.
- **Regression tests** (`worker/tests/test_jobqueue.py`):
  - `test_fan_in_limit_holds_when_stats_say_table_is_empty` recreates the churned stats. Its fixture turns autovacuum off for `items`, since autovacuum could otherwise truncate the empty pages or re-analyze mid-test and flip the plan back. The test failed with `30 == 5` before the fix.
  - `test_over_claim_is_rolled_back_not_merged` covers the guard.
- **End-to-end** (`scripts/e2e.py`, `check_task_shape`): for every job, committed tasks must have 2–5 inputs, exactly one must be final, and together they must reduce F items to one (sum of `inputs − 1` = F − 1).

After the fix, the same 100-file job ran as 26 tasks of at most 5 inputs across all 4 workers, in 11.5 s instead of 14.3 s.

## Lessons

- **Correctness must not depend on the plan.** Plans change with stats, data size, and Postgres version. Any subquery with side effects (`FOR UPDATE`, `nextval()`, `random()`, data-modifying statements) inside an `UPDATE` or `DELETE` belongs in a `MATERIALIZED` CTE.
- **Check invariants where they hold.** The commit check proved inputs were consumed exactly once. Nothing checked that the claim respected the fan-in. Now the worker and the e2e script both do.
- **Test against realistic table state.** Fresh test tables have different stats from a long-running queue table.
- **Other queries were reviewed.** `PICK_JOB` locks at the top level, which runs once. Its correlated subquery reruns per job, but it only reads. Lease renewal, release, and commit all target explicit ids.
