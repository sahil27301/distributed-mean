import logging
import signal
import time

import psycopg

from worker.blob_store import LocalBlobStore
from worker.config import Config, load_config
from worker.log import setup_logging
from worker.loop import WorkerContext, step
from worker.speed import SpeedSimulator


def connect_with_retry(database_url: str, log: logging.Logger, attempts: int = 30) -> psycopg.Connection:
    for attempt in range(1, attempts + 1):
        try:
            return psycopg.connect(database_url, autocommit=True)
        except psycopg.OperationalError as exc:
            log.warning("postgres not ready (attempt %d/%d): %s", attempt, attempts, exc)
            time.sleep(1)
    raise RuntimeError("could not connect to postgres")


def build_context(config: Config, log: logging.Logger) -> WorkerContext:
    return WorkerContext(
        config=config,
        conn=connect_with_retry(config.database_url, log),
        heartbeat_conn=connect_with_retry(config.database_url, log),
        blobs=LocalBlobStore(config.blob_root),
        speed=SpeedSimulator(config.speed_factor, config.seconds_per_million_values, config.task_overhead_seconds),
        log=log,
    )


def close_context(ctx: WorkerContext) -> None:
    for conn in (ctx.conn, ctx.heartbeat_conn):
        try:
            conn.close()
        except Exception:
            pass


def main() -> None:
    config = load_config()
    log = setup_logging(config.log_level, config.worker_id)

    stopping = False

    def request_stop(signum, _frame):
        nonlocal stopping
        log.info("received signal %d, stopping after current task", signum)
        stopping = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    ctx = build_context(config, log)
    log.info(
        "started blob_root=%s speed_factor=%.2f seconds_per_million_values=%.2f task_overhead=%.2fs "
        "lease=%ss heartbeat=%ss",
        config.blob_root, config.speed_factor, config.seconds_per_million_values, config.task_overhead_seconds,
        config.lease_seconds, config.heartbeat_seconds,
    )

    while not stopping:
        try:
            if not step(ctx):
                time.sleep(config.idle_poll_seconds)
        except psycopg.OperationalError:
            log.exception("lost database connection; reconnecting")
            close_context(ctx)
            ctx = build_context(config, log)
        except Exception:
            # Leases on anything we held expire on their own; dying would just lose a worker.
            log.exception("unexpected error; continuing")
            time.sleep(config.idle_poll_seconds)

    close_context(ctx)
    log.info("stopped")


if __name__ == "__main__":
    main()
