import logging
import os
from pathlib import Path

import numpy as np
import psycopg
import pytest

from worker.blob_store import LocalBlobStore
from worker.config import Config
from worker.loop import WorkerContext
from worker.speed import SpeedSimulator

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://mean:mean@localhost:5432/mean_worker_test"
)
SCHEMA = Path(__file__).resolve().parents[2] / "db" / "001_init.sql"


@pytest.fixture(scope="session")
def database_url() -> str:
    """Recreates the test database from the real schema once per session."""
    db_name = TEST_DATABASE_URL.rsplit("/", 1)[1]
    admin_url = TEST_DATABASE_URL.rsplit("/", 1)[0] + "/postgres"
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(f'DROP DATABASE IF EXISTS "{db_name}" WITH (FORCE)')
        admin.execute(f'CREATE DATABASE "{db_name}"')
    with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as conn:
        conn.execute(SCHEMA.read_text())
    return TEST_DATABASE_URL


@pytest.fixture
def conn(database_url):
    with psycopg.connect(database_url, autocommit=True) as c:
        c.execute("TRUNCATE tasks, items, jobs, workers")
        yield c


@pytest.fixture
def blobs(tmp_path) -> LocalBlobStore:
    return LocalBlobStore(tmp_path / "blobs")


def make_config(worker_id: str = "w1", **overrides) -> Config:
    return Config(
        database_url=TEST_DATABASE_URL,
        blob_root="unused",
        log_level="DEBUG",
        worker_id=worker_id,
        **overrides,
    )


def make_context(database_url: str, blobs: LocalBlobStore, worker_id: str, **overrides) -> WorkerContext:
    return WorkerContext(
        config=make_config(worker_id, **overrides),
        conn=psycopg.connect(database_url, autocommit=True),
        heartbeat_conn=psycopg.connect(database_url, autocommit=True),
        blobs=blobs,
        speed=SpeedSimulator(factor=1.0, seconds_per_million_values=0.0),
        log=logging.getLogger(f"test.{worker_id}"),
    )


def create_running_job(
    conn: psycopg.Connection,
    blobs: LocalBlobStore,
    file_count: int,
    values_per_file: int,
    seed: int = 0,
) -> tuple[str, np.ndarray]:
    """Writes raw files the way the API does and enqueues them. Returns (job_id, matrix of all values)."""
    rng = np.random.default_rng(seed)
    matrix = rng.integers(0, 1000, size=(file_count, values_per_file), dtype=np.int32)
    job_id = conn.execute(
        "INSERT INTO jobs (file_count, values_per_file, status) VALUES (%s, %s, 'running') RETURNING id",
        [file_count, values_per_file],
    ).fetchone()[0]
    for i, row in enumerate(matrix):
        path = f"raw/{job_id}/{i}.bin"
        blobs.put(path, row.astype("<i4").tobytes())
        conn.execute(
            "INSERT INTO items (job_id, path, files_covered) VALUES (%s, %s, 1)", [job_id, path]
        )
    return str(job_id), matrix


def insert_job_with_items(conn: psycopg.Connection, files_covered: list[int], file_count: int | None = None) -> str:
    """A running job whose items have the given files_covered values; no blobs are written."""
    job_id = conn.execute(
        "INSERT INTO jobs (file_count, values_per_file, status) VALUES (%s, 4, 'running') RETURNING id",
        [file_count or sum(files_covered)],
    ).fetchone()[0]
    for i, covered in enumerate(files_covered):
        conn.execute(
            "INSERT INTO items (job_id, path, files_covered) VALUES (%s, %s, %s)",
            [job_id, f"partials/{job_id}/{i}.bin", covered],
        )
    return str(job_id)
