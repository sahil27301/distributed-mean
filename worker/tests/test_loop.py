import threading
import time

import numpy as np
import pytest

from conftest import create_running_job, make_context
from worker.blob_store import BlobStoreError, LocalBlobStore
from worker.loop import step


def run_workers(conn, contexts, job_ids, timeout=30.0):
    """Runs each context's step loop on its own thread until every job is done or failed."""
    finished = threading.Event()
    errors: list[BaseException] = []

    def loop(ctx):
        try:
            while not finished.is_set():
                if not step(ctx):
                    time.sleep(0.01)
        except BaseException as exc:
            errors.append(exc)
            finished.set()

    threads = [threading.Thread(target=loop, args=(ctx,)) for ctx in contexts]
    for t in threads:
        t.start()

    deadline = time.monotonic() + timeout
    try:
        while time.monotonic() < deadline:
            statuses = conn.execute(
                "SELECT status FROM jobs WHERE id = ANY(%s::uuid[])", [job_ids]
            ).fetchall()
            if all(s in ("done", "failed") for (s,) in statuses):
                break
            time.sleep(0.05)
    finally:
        finished.set()
        for t in threads:
            t.join()
        for ctx in contexts:
            ctx.conn.close()
            ctx.heartbeat_conn.close()
    assert not errors, errors


def read_result(conn, blobs, job_id) -> np.ndarray:
    status, path = conn.execute("SELECT status, result_path FROM jobs WHERE id = %s", [job_id]).fetchone()
    assert status == "done"
    return np.array([float(x) for x in blobs.get(path).decode().split()])


def task_rows(conn, job_id, outcome):
    return conn.execute(
        "SELECT inputs, final, worker_id FROM tasks WHERE job_id = %s AND outcome = %s", [job_id, outcome]
    ).fetchall()


class FlakyBlobStore(LocalBlobStore):
    """Fails a fraction of reads, deterministically, to exercise the release-and-retry path."""

    def __init__(self, root, fail_every: int):
        super().__init__(root)
        self.fail_every = fail_every
        self.reads = 0
        self.failures = 0
        self.lock = threading.Lock()

    def get(self, path):
        with self.lock:
            self.reads += 1
            fail = self.reads % self.fail_every == 0
            self.failures += fail
        if fail:
            raise BlobStoreError(f"simulated read failure on {path}")
        return super().get(path)


class UndeletableBlobStore(LocalBlobStore):
    def delete(self, path):
        raise BlobStoreError(f"simulated delete failure on {path}")


@pytest.mark.parametrize("file_count", [2, 5, 6, 37])
def test_workers_compute_exact_per_index_mean(database_url, conn, blobs, file_count):
    job_id, matrix = create_running_job(conn, blobs, file_count, 64, seed=file_count)
    contexts = [make_context(database_url, blobs, f"w{i}") for i in range(4)]

    run_workers(conn, contexts, [job_id])

    expected = matrix.astype(np.int64).sum(axis=0) / file_count
    assert np.array_equal(read_result(conn, blobs, job_id), expected)

    committed = task_rows(conn, job_id, "committed")
    assert sum(inputs - 1 for inputs, _, _ in committed) == file_count - 1, "each k-way merge removes k-1 items"
    assert sum(final for _, final, _ in committed) == 1


def test_concurrent_jobs_all_finish_correctly(database_url, conn, blobs):
    jobs = [create_running_job(conn, blobs, f, c, seed=f) for f, c in [(23, 16), (40, 8), (7, 100)]]
    contexts = [make_context(database_url, blobs, f"w{i}") for i in range(3)]

    run_workers(conn, contexts, [j for j, _ in jobs])

    for job_id, matrix in jobs:
        expected = matrix.astype(np.int64).sum(axis=0) / matrix.shape[0]
        assert np.array_equal(read_result(conn, blobs, job_id), expected)


def test_failed_tasks_are_retried_without_double_counting(database_url, conn, tmp_path):
    flaky = FlakyBlobStore(tmp_path / "blobs", fail_every=7)
    job_id, matrix = create_running_job(conn, flaky, 30, 32, seed=1)
    contexts = [make_context(database_url, flaky, f"w{i}", max_attempts=50) for i in range(3)]

    run_workers(conn, contexts, [job_id])

    expected = matrix.astype(np.int64).sum(axis=0) / 30
    assert np.array_equal(read_result(conn, flaky, job_id), expected)
    assert flaky.failures > 0
    assert len(task_rows(conn, job_id, "failed")) == flaky.failures


def test_consumed_partials_are_deleted_and_raw_files_kept(database_url, conn, blobs):
    job_id, _ = create_running_job(conn, blobs, 26, 4)
    run_workers(conn, [make_context(database_url, blobs, "w1")], [job_id])

    assert len(list((blobs.root / "raw" / job_id).iterdir())) == 26
    partials = blobs.root / "partials" / job_id
    assert not partials.exists() or list(partials.iterdir()) == []


def test_failed_partial_deletes_do_not_stop_the_job(database_url, conn, tmp_path):
    store = UndeletableBlobStore(tmp_path / "blobs")
    job_id, matrix = create_running_job(conn, store, 26, 8)

    run_workers(conn, [make_context(database_url, store, "w1")], [job_id])

    assert np.array_equal(read_result(conn, store, job_id), matrix.astype(np.int64).sum(axis=0) / 26)


def test_corrupted_file_fails_the_job_instead_of_retrying_forever(database_url, conn, blobs):
    job_id, _ = create_running_job(conn, blobs, 12, 16)
    blobs.put(f"raw/{job_id}/3.bin", b"truncated")
    contexts = [make_context(database_url, blobs, f"w{i}") for i in range(2)]

    run_workers(conn, contexts, [job_id], timeout=15)

    status, error = conn.execute("SELECT status, error FROM jobs WHERE id = %s", [job_id]).fetchone()
    assert status == "failed"
    assert f"raw/{job_id}/3.bin" in error
