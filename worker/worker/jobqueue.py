"""Postgres-backed work queue: claim, renew, release, commit (design §6.2, §6.3)."""

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

import psycopg

log = logging.getLogger("worker.queue")


class FanInExceeded(RuntimeError):
    """The claim query locked more items than allowed; the transaction is rolled back."""


@dataclass(frozen=True)
class Input:
    id: UUID
    path: str
    files_covered: int


@dataclass(frozen=True)
class Task:
    job_id: UUID
    file_count: int
    values_per_file: int
    inputs: tuple[Input, ...]
    claimed_at: datetime

    @property
    def item_ids(self) -> list[UUID]:
        return [i.id for i in self.inputs]

    @property
    def values_read(self) -> int:
        return len(self.inputs) * self.values_per_file

    @property
    def files_covered(self) -> int:
        return sum(i.files_covered for i in self.inputs)

    @property
    def is_final(self) -> bool:
        return self.files_covered == self.file_count


PICK_JOB = """
SELECT j.id, j.file_count, j.values_per_file
FROM jobs j
WHERE j.status = 'running'
  AND (SELECT count(*) FROM (
         SELECT 1 FROM items i
         WHERE i.job_id = j.id AND (i.claimed_by IS NULL OR i.lease_expires_at < now())
         LIMIT 2) t) = 2
ORDER BY j.last_claimed_at, j.created_at
LIMIT 1
FOR UPDATE SKIP LOCKED
"""

# MATERIALIZED forces the locking subquery to run exactly once. As a plain `WHERE id IN (...)`
# the planner may rescan it per outer row, and each rescan locks a fresh batch past LIMIT.
CLAIM_ITEMS = """
WITH picked AS MATERIALIZED (
  SELECT id FROM items
  WHERE job_id = %(job)s AND (claimed_by IS NULL OR lease_expires_at < now())
  ORDER BY files_covered DESC
  LIMIT %(limit)s
  FOR UPDATE SKIP LOCKED
)
UPDATE items
SET claimed_by = %(worker)s,
    claimed_at = now(),
    lease_expires_at = now() + make_interval(secs => %(lease)s),
    attempts = attempts + 1
FROM picked
WHERE items.id = picked.id
RETURNING items.id, items.path, items.files_covered, items.attempts, now()
"""


def claim(
    conn: psycopg.Connection,
    worker_id: str,
    lease_seconds: float,
    max_fan_in: int,
    max_attempts: int,
) -> Task | None:
    """Claims 2..max_fan_in items of the least recently served job. None if there is no work."""
    task = None
    with conn.transaction():
        job = conn.execute(PICK_JOB).fetchone()
        if job is None:
            return None
        job_id, file_count, values_per_file = job

        rows = conn.execute(
            CLAIM_ITEMS, {"worker": worker_id, "lease": lease_seconds, "job": job_id, "limit": max_fan_in}
        ).fetchall()
        if len(rows) > max_fan_in:
            log.error("claim returned %d items for job %s, limit is %d; rolling back", len(rows), job_id, max_fan_in)
            raise FanInExceeded(f"claimed {len(rows)} items, limit is {max_fan_in}")
        if len(rows) < 2:
            # Rows locked by an in-flight commit are skipped; a 1-input merge is pointless, so retry later.
            raise psycopg.Rollback()
        conn.execute("UPDATE jobs SET last_claimed_at = now() WHERE id = %s", [job_id])

        # Attribution is best-effort: items grouped with a bad one collect attempts too, and with
        # several bad items a good one can cross the limit first. The job fails either way.
        poisoned = [r[1] for r in rows if r[3] > max_attempts]
        if poisoned:
            error = (
                f"{len(poisoned)} item(s) exceeded {max_attempts} attempts: {', '.join(poisoned)} "
                "(a bad input is among these or was claimed together with them)"
            )
            fail_job(conn, job_id, error)
            log.error("job %s failed: %s", job_id, error)
            return None

        task = Task(
            job_id=job_id,
            file_count=file_count,
            values_per_file=values_per_file,
            inputs=tuple(Input(id=r[0], path=r[1], files_covered=r[2]) for r in rows),
            claimed_at=rows[0][4],
        )
    return task


def renew_leases(conn: psycopg.Connection, item_ids: list[UUID], worker_id: str, lease_seconds: float) -> int:
    """Extends leases only on items this worker still holds. Returns how many were renewed."""
    cur = conn.execute(
        """UPDATE items SET lease_expires_at = now() + make_interval(secs => %s)
           WHERE id = ANY(%s) AND claimed_by = %s""",
        [lease_seconds, item_ids, worker_id],
    )
    return cur.rowcount


def release(conn: psycopg.Connection, item_ids: list[UUID], worker_id: str) -> None:
    """Makes items claimable again right away instead of waiting for the lease to expire."""
    conn.execute(
        """UPDATE items SET claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL
           WHERE id = ANY(%s) AND claimed_by = %s""",
        [item_ids, worker_id],
    )


def commit(conn: psycopg.Connection, task: Task, output_path: str, worker_id: str) -> bool:
    """Consumes all inputs and records the output atomically (ITD 3). False if another attempt won."""
    committed = False
    with conn.transaction():
        deleted = conn.execute("DELETE FROM items WHERE id = ANY(%s)", [task.item_ids]).rowcount
        if deleted != len(task.inputs):
            raise psycopg.Rollback()

        if task.is_final:
            done = conn.execute(
                """UPDATE jobs SET status = 'done', result_path = %s, completed_at = now()
                   WHERE id = %s AND status = 'running'""",
                [output_path, task.job_id],
            ).rowcount
            if done != 1:
                raise psycopg.Rollback()
        else:
            conn.execute(
                "INSERT INTO items (job_id, path, files_covered, created_by) VALUES (%s, %s, %s, %s)",
                [task.job_id, output_path, task.files_covered, worker_id],
            )
        record_task(conn, task, worker_id, "committed")
        committed = True
    return committed


Outcome = Literal["committed", "lost", "failed"]


def record_task(
    conn: psycopg.Connection, task: Task, worker_id: str, outcome: Outcome, error: str | None = None
) -> None:
    conn.execute(
        """INSERT INTO tasks (job_id, worker_id, inputs, files_covered, values_read, final, outcome, error, claimed_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        [
            task.job_id, worker_id, len(task.inputs), task.files_covered, task.values_read,
            task.is_final, outcome, error, task.claimed_at,
        ],
    )


def fail_job(conn: psycopg.Connection, job_id: UUID, error: str) -> None:
    conn.execute(
        "UPDATE jobs SET status = 'failed', error = %s WHERE id = %s AND status = 'running'",
        [error, job_id],
    )
