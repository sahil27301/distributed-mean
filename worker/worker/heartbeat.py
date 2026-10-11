import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from uuid import UUID

import psycopg

from worker.jobqueue import renew_leases


@contextmanager
def heartbeat(
    conn: psycopg.Connection,
    item_ids: list[UUID],
    worker_id: str,
    lease_seconds: float,
    interval: float,
    log: logging.Logger,
) -> Iterator[None]:
    """Renews leases on a background thread for as long as the block runs.

    `conn` must not be used by any other thread meanwhile; the worker keeps a dedicated one.
    """
    stop = threading.Event()

    def beat() -> None:
        warned = False
        while not stop.wait(interval):
            try:
                renewed = renew_leases(conn, item_ids, worker_id, lease_seconds)
            except Exception:
                log.exception("heartbeat failed")
                continue
            if renewed < len(item_ids) and not warned:
                warned = True
                log.warning(
                    "lost %d of %d leases; another worker re-claimed them, first commit wins",
                    len(item_ids) - renewed,
                    len(item_ids),
                )
            else:
                log.debug("renewed %d leases", renewed)

    thread = threading.Thread(target=beat, name="heartbeat", daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join()
