import pytest

from worker.config import load_config

BASE = {"DATABASE_URL": "postgresql://x", "BLOB_ROOT": "/data"}


def test_requires_database_url_and_blob_root():
    with pytest.raises(ValueError, match="DATABASE_URL, BLOB_ROOT"):
        load_config({})


def test_rejects_heartbeat_that_could_let_a_live_lease_expire():
    with pytest.raises(ValueError, match="at most half"):
        load_config({**BASE, "LEASE_SECONDS": "10", "HEARTBEAT_SECONDS": "6"})
    assert load_config({**BASE, "LEASE_SECONDS": "10", "HEARTBEAT_SECONDS": "5"}).lease_seconds == 10


def test_empty_speed_factor_draws_a_random_one_and_a_set_one_is_used():
    factor = load_config({**BASE, "WORKER_SPEED_FACTOR": ""}).speed_factor
    assert 1.0 <= factor <= 4.0
    assert load_config({**BASE, "WORKER_SPEED_FACTOR": "2.5"}).speed_factor == 2.5
