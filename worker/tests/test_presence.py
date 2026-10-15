import logging
import time

from worker.presence import Presence


def wait_until(predicate, timeout=3.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


def test_registers_keeps_fresh_and_removes_itself(database_url, conn):
    presence = Presence(database_url, "w-presence", 2.5, interval=0.05, log=logging.getLogger("test"))
    presence.start()
    try:
        assert wait_until(lambda: conn.execute("SELECT 1 FROM workers WHERE id = 'w-presence'").fetchone())
        first = conn.execute("SELECT last_seen_at, speed_factor FROM workers WHERE id = 'w-presence'").fetchone()
        assert first[1] == 2.5
        assert wait_until(
            lambda: conn.execute("SELECT last_seen_at FROM workers WHERE id = 'w-presence'").fetchone()[0] > first[0]
        ), "last_seen_at keeps moving while the worker runs"
    finally:
        presence.stop()
    assert conn.execute("SELECT 1 FROM workers WHERE id = 'w-presence'").fetchone() is None
