import logging
import threading

import psycopg

UPSERT = """
INSERT INTO workers (id, speed_factor) VALUES (%s, %s)
ON CONFLICT (id) DO UPDATE SET last_seen_at = now(), speed_factor = EXCLUDED.speed_factor
"""


class Presence:
    """Keeps this worker's row in `workers` fresh so the UI can show idle workers too.

    Runs on its own thread and connection: a long task must not make the worker look dead,
    and nothing about correctness depends on it.
    """

    def __init__(self, database_url: str, worker_id: str, speed_factor: float, interval: float, log: logging.Logger):
        self.database_url = database_url
        self.worker_id = worker_id
        self.speed_factor = speed_factor
        self.interval = interval
        self.log = log
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="presence", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join()
        try:
            with psycopg.connect(self.database_url, autocommit=True) as conn:
                conn.execute("DELETE FROM workers WHERE id = %s", [self.worker_id])
        except psycopg.Error:
            self.log.warning("could not remove presence row; it will age out", exc_info=True)

    def _run(self) -> None:
        conn: psycopg.Connection | None = None
        while not self._stop.is_set():
            try:
                if conn is None or conn.closed:
                    conn = psycopg.connect(self.database_url, autocommit=True)
                conn.execute(UPSERT, [self.worker_id, self.speed_factor])
            except psycopg.Error:
                self.log.warning("presence update failed; retrying", exc_info=True)
                conn = None
            self._stop.wait(self.interval)
        if conn is not None:
            conn.close()
