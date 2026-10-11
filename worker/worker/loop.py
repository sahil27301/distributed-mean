import logging
import time
from dataclasses import dataclass

import psycopg

from worker import jobqueue
from worker.blob_store import BlobStoreError, LocalBlobStore
from worker.config import Config
from worker.heartbeat import heartbeat
from worker.jobqueue import Task
from worker.merge import execute
from worker.speed import SpeedSimulator


@dataclass
class WorkerContext:
    config: Config
    conn: psycopg.Connection
    heartbeat_conn: psycopg.Connection
    blobs: LocalBlobStore
    speed: SpeedSimulator
    log: logging.Logger


def step(ctx: WorkerContext) -> bool:
    """Claims and processes one task. Returns False if there was no work."""
    cfg = ctx.config
    task = jobqueue.claim(ctx.conn, cfg.worker_id, cfg.lease_seconds, cfg.max_fan_in, cfg.max_attempts)
    if task is None:
        return False

    ctx.log.info(
        "claimed job=%s inputs=%d files_covered=%d/%d final=%s",
        task.job_id, len(task.inputs), task.files_covered, task.file_count, task.is_final,
    )
    started = time.monotonic()
    try:
        with heartbeat(
            ctx.heartbeat_conn, task.item_ids, cfg.worker_id, cfg.lease_seconds, cfg.heartbeat_seconds, ctx.log
        ):
            output_path = execute(task, ctx.blobs, ctx.speed)
    except Exception as exc:
        ctx.log.exception("task failed job=%s items=%s; releasing leases", task.job_id, task.item_ids)
        jobqueue.release(ctx.conn, task.item_ids, cfg.worker_id)
        jobqueue.record_task(ctx.conn, task, cfg.worker_id, "failed", error=f"{type(exc).__name__}: {exc}")
        return True

    _commit(ctx, task, output_path, time.monotonic() - started)
    return True


def _commit(ctx: WorkerContext, task: Task, output_path: str, duration: float) -> None:
    if not jobqueue.commit(ctx.conn, task, output_path, ctx.config.worker_id):
        ctx.log.warning("commit lost job=%s: another attempt consumed some inputs first", task.job_id)
        jobqueue.record_task(ctx.conn, task, ctx.config.worker_id, "lost")
        if not task.is_final:
            # Nobody references our partial. The final CSV is never deleted: the winner wrote the same path.
            _delete_best_effort(ctx, output_path)
        return

    if task.is_final:
        ctx.log.info("job done job=%s result=%s duration=%.3fs", task.job_id, output_path, duration)
    else:
        ctx.log.info(
            "committed job=%s output=%s files_covered=%d duration=%.3fs",
            task.job_id, output_path, task.files_covered, duration,
        )
    _delete_consumed_partials(ctx, task)


def _delete_consumed_partials(ctx: WorkerContext, task: Task) -> None:
    """Raw files (files_covered = 1) are kept; partials are garbage once consumed."""
    for item in task.inputs:
        if item.files_covered > 1:
            _delete_best_effort(ctx, item.path)


def _delete_best_effort(ctx: WorkerContext, path: str) -> None:
    """The commit already happened, so a failed delete only leaves an orphan file behind."""
    try:
        ctx.blobs.delete(path)
    except BlobStoreError:
        ctx.log.warning("could not delete %s; left as an orphan", path, exc_info=True)
