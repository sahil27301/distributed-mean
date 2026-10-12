import threading

import psycopg
import pytest

from conftest import insert_job_with_items
from worker import jobqueue

LEASE = 30


def claim(conn, worker="w1", lease=LEASE, max_fan_in=5, max_attempts=3):
    return jobqueue.claim(conn, worker, lease, max_fan_in, max_attempts)


def job_status(conn, job_id):
    return conn.execute("SELECT status, error FROM jobs WHERE id = %s", [job_id]).fetchone()


def items_of(conn, job_id):
    return conn.execute("SELECT files_covered FROM items WHERE job_id = %s", [job_id]).fetchall()


def claimed_count(conn, job_id):
    return conn.execute(
        "SELECT count(*) FROM items WHERE job_id = %s AND claimed_by IS NOT NULL", [job_id]
    ).fetchone()[0]


@pytest.fixture
def items_churned(conn):
    """Stats of "pages exist, zero live rows", as after jobs finish and their items are deleted.

    With them the planner rescans an IN (... LIMIT ... SKIP LOCKED) subquery once per outer row, and
    each rescan skips rows the statement already locked, so it grabs a fresh batch. Autovacuum is off
    so it can't truncate the empty pages or re-analyze mid-test and flip the plan back.
    """
    conn.execute("ALTER TABLE items SET (autovacuum_enabled = false)")
    insert_job_with_items(conn, [1] * 50)
    conn.execute("DELETE FROM items")
    conn.execute("ANALYZE items")
    yield
    conn.execute("ALTER TABLE items RESET (autovacuum_enabled)")


IGNORES_LIMIT_CLAIM_ITEMS = """
UPDATE items SET claimed_by = %(worker)s, attempts = attempts + 1
WHERE job_id = %(job)s AND %(limit)s > 0
RETURNING id, path, files_covered, attempts, now()
"""


class TestClaim:
    def test_takes_up_to_five_items_largest_partials_first(self, conn):
        insert_job_with_items(conn, [1, 1, 3, 1, 7, 2, 1])
        task = claim(conn)
        assert sorted((i.files_covered for i in task.inputs), reverse=True) == [7, 3, 2, 1, 1]

    def test_fan_in_limit_holds_when_stats_say_table_is_empty(self, conn, items_churned):
        job = insert_job_with_items(conn, [1] * 30)
        task = claim(conn)
        assert len(task.inputs) == 5
        assert claimed_count(conn, job) == 5

    def test_over_claim_is_rolled_back_not_merged(self, conn, monkeypatch):
        monkeypatch.setattr(jobqueue, "CLAIM_ITEMS", IGNORES_LIMIT_CLAIM_ITEMS)
        job = insert_job_with_items(conn, [1] * 30)
        with pytest.raises(jobqueue.FanInExceeded):
            claim(conn)
        assert claimed_count(conn, job) == 0

    def test_needs_at_least_two_claimable_items(self, conn):
        job = insert_job_with_items(conn, [1, 1, 1])
        claim(conn, max_fan_in=2)
        assert claim(conn, worker="w2") is None, "only one unleased item left"
        assert len(items_of(conn, job)) == 3

    def test_ignores_jobs_that_are_not_running(self, conn):
        job = insert_job_with_items(conn, [1, 1])
        conn.execute("UPDATE jobs SET status = 'generating' WHERE id = %s", [job])
        assert claim(conn) is None

    def test_reclaims_items_whose_lease_expired(self, conn):
        insert_job_with_items(conn, [1, 1])
        first = claim(conn, worker="w1", lease=-1)
        second = claim(conn, worker="w2")
        assert second is not None
        assert set(second.item_ids) == set(first.item_ids)

    def test_round_robins_across_jobs(self, conn):
        a = insert_job_with_items(conn, [1] * 20)
        b = insert_job_with_items(conn, [1] * 20)
        served = [str(claim(conn, max_fan_in=2).job_id) for _ in range(6)]
        assert served == [a, b, a, b, a, b]

    def test_concurrent_claimers_never_get_the_same_item(self, database_url, conn):
        job = insert_job_with_items(conn, [1] * 200)
        claimed: list = []
        lock = threading.Lock()

        def run(worker):
            with psycopg.connect(database_url, autocommit=True) as c:
                while (task := claim(c, worker=worker)) is not None:
                    with lock:
                        claimed.extend(task.item_ids)

        threads = [threading.Thread(target=run, args=(f"w{i}",)) for i in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(claimed) == len(set(claimed))
        assert len(claimed) >= 199, "everything but at most one item gets claimed"
        assert len(items_of(conn, job)) == 200

    def test_poison_item_fails_the_job_after_max_attempts(self, conn):
        job = insert_job_with_items(conn, [1, 1])
        for _ in range(3):
            task = claim(conn, lease=-1)
            assert task is not None
        assert claim(conn, lease=-1) is None

        status, error = job_status(conn, job)
        assert status == "failed"
        assert "exceeded 3 attempts" in error
        assert claim(conn) is None


class TestCommit:
    def test_replaces_inputs_with_one_item_covering_their_sum(self, conn):
        job = insert_job_with_items(conn, [4, 2, 1], file_count=10)
        task = claim(conn)
        assert jobqueue.commit(conn, task, "partials/x.bin", "w1")
        assert items_of(conn, job) == [(7,)]

    def test_first_commit_wins_when_attempts_overlap(self, conn):
        job = insert_job_with_items(conn, [1, 1, 1], file_count=10)
        slow = claim(conn, worker="slow", lease=-1, max_fan_in=2)
        fast = claim(conn, worker="fast", max_fan_in=3)
        assert set(slow.item_ids) < set(fast.item_ids)

        assert jobqueue.commit(conn, fast, "partials/fast.bin", "fast")
        assert not jobqueue.commit(conn, slow, "partials/slow.bin", "slow")
        assert items_of(conn, job) == [(3,)], "files are counted exactly once"
        assert conn.execute("SELECT worker_id, outcome FROM tasks").fetchall() == [("fast", "committed")]

    def test_records_the_committed_task_in_the_same_transaction(self, conn):
        job = insert_job_with_items(conn, [4, 2, 1], file_count=10)
        task = claim(conn)
        jobqueue.commit(conn, task, "partials/x.bin", "w1")
        row = conn.execute(
            """SELECT job_id::text, worker_id, inputs, files_covered, values_read, final, outcome,
                      claimed_at <= finished_at
               FROM tasks"""
        ).fetchone()
        assert row == (job, "w1", 3, 7, 12, False, "committed", True)

    def test_final_merge_marks_job_done_without_inserting_an_item(self, conn):
        job = insert_job_with_items(conn, [3, 2])
        task = claim(conn)
        assert task.is_final
        assert jobqueue.commit(conn, task, "results/x.csv", "w1")
        assert items_of(conn, job) == []
        row = conn.execute("SELECT status, result_path, completed_at FROM jobs WHERE id = %s", [job]).fetchone()
        assert row[0] == "done" and row[1] == "results/x.csv" and row[2] is not None

    def test_final_merge_does_not_resurrect_a_failed_job(self, conn):
        job = insert_job_with_items(conn, [3, 2])
        task = claim(conn)
        jobqueue.fail_job(conn, task.job_id, "boom")
        assert not jobqueue.commit(conn, task, "results/x.csv", "w1")
        assert job_status(conn, job)[0] == "failed"
        assert len(items_of(conn, job)) == 2, "rolled back: inputs are still there"


class TestLeases:
    def test_renew_only_touches_items_still_held(self, conn):
        insert_job_with_items(conn, [1, 1, 1], file_count=10)
        mine = claim(conn, worker="w1", lease=-1, max_fan_in=3)
        claim(conn, worker="w2", max_fan_in=2)
        assert jobqueue.renew_leases(conn, mine.item_ids, "w1", LEASE) == 1

    def test_release_makes_items_claimable_immediately(self, conn):
        insert_job_with_items(conn, [1, 1])
        task = claim(conn, worker="w1")
        assert claim(conn, worker="w2") is None
        jobqueue.release(conn, task.item_ids, "w1")
        assert conn.execute("SELECT count(*) FROM items WHERE claimed_at IS NOT NULL").fetchone() == (0,)
        assert claim(conn, worker="w2") is not None


class TestUiColumns:
    def test_claim_stamps_claimed_at_and_commit_stamps_created_by(self, conn):
        job = insert_job_with_items(conn, [1, 1, 1], file_count=10)
        task = claim(conn, worker="w1", max_fan_in=2)
        claimed = conn.execute(
            "SELECT count(*) FROM items WHERE job_id = %s AND claimed_by = 'w1' AND claimed_at = %s",
            [job, task.claimed_at],
        ).fetchone()
        assert claimed == (2,)

        jobqueue.commit(conn, task, "partials/x.bin", "w1")
        rows = conn.execute(
            "SELECT files_covered, created_by FROM items WHERE job_id = %s ORDER BY files_covered", [job]
        ).fetchall()
        assert rows == [(1, None), (2, "w1")], "raw items have no producer; the partial records its worker"
