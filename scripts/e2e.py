#!/usr/bin/env python3
"""End-to-end checks against the running `docker compose` stack.

Usage:
    docker compose up -d --build
    python3 scripts/e2e.py            # everything, ~3 min
    python3 scripts/e2e.py --quick    # skip the crash scenarios

Standard library only. The reference mean is computed with numpy inside a worker container,
straight from the raw files on the shared volume, and compared for exact equality.
"""

import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = os.environ.get("API_URL", "http://localhost:3000")
ROOT = Path(__file__).resolve().parents[1]

VERIFY = r"""
import hashlib, json, sys
import numpy as np
job, F, C = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
total = np.zeros(C, np.int64)
for i in range(F):
    total += np.fromfile(f"/data/raw/{job}/{i}.bin", dtype="<i4")
data = open(f"/data/results/{job}.csv", "rb").read()
got = np.array([float(x) for x in data.split()])
exact = got.shape == total.shape and bool(np.array_equal(got, total / F))
print(json.dumps({"exact": exact, "sha256": hashlib.sha256(data).hexdigest()}))
"""

failures: list[str] = []


# ---------- helpers ----------

def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def check(name: str, ok: bool, detail: str = "") -> None:
    log(f"{'PASS' if ok else 'FAIL'}  {name}{f'  ({detail})' if detail else ''}")
    if not ok:
        failures.append(name)


def http(method: str, path: str, body: object | None = None) -> tuple[int, dict, bytes]:
    data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
    req = urllib.request.Request(API + path, data=data, method=method, headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status, dict(res.headers), res.read()
    except urllib.error.HTTPError as err:
        return err.code, dict(err.headers), err.read()


def compose(*args: str, check_rc: bool = True) -> str:
    out = subprocess.run(["docker", "compose", *args], cwd=ROOT, capture_output=True, text=True)
    if check_rc and out.returncode != 0:
        raise RuntimeError(f"docker compose {' '.join(args)} failed: {out.stderr.strip()}")
    return out.stdout


def create_job(file_count: int, values_per_file: int) -> str:
    status, headers, body = http("POST", "/jobs", {"fileCount": file_count, "valuesPerFile": values_per_file})
    assert status == 202, (status, body)
    job = json.loads(body)
    assert headers.get("Location") == f"/jobs/{job['id']}", headers
    log(f"created job {job['id']} F={file_count} C={values_per_file}")
    return job["id"]


def get_job(job_id: str) -> dict:
    status, _, body = http("GET", f"/jobs/{job_id}")
    assert status == 200, (status, body)
    return json.loads(body)


def wait_for(job_id: str, predicate, timeout: float, what: str) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            job = get_job(job_id)
            if predicate(job):
                return job
        except (urllib.error.URLError, ConnectionError, AssertionError):
            pass  # API restarting
        time.sleep(0.5)
    raise TimeoutError(f"job {job_id} never became {what}")


def wait_finished(job_id: str, timeout: float = 180) -> dict:
    return wait_for(job_id, lambda j: j["status"] in ("done", "failed"), timeout, "done/failed")


def verify(job_id: str, file_count: int, values_per_file: int, name: str) -> None:
    job = wait_finished(job_id)
    if job["status"] != "done":
        check(name, False, f"status={job['status']} error={job.get('error')}")
        return
    out = compose("exec", "-T", "--index", "1", "worker", ".venv/bin/python", "-c", VERIFY,
                  job_id, str(file_count), str(values_per_file))
    result = json.loads(out.strip().splitlines()[-1])
    status, headers, body = http("GET", job["resultUrl"])
    downloaded_ok = status == 200 and hashlib.sha256(body).hexdigest() == result["sha256"]
    check(name, result["exact"] and downloaded_ok and job["progress"] == 1,
          f"exact={result['exact']} download_matches={downloaded_ok} content-type={headers.get('Content-Type')}")


def wait_api(timeout: float = 60) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if http("GET", "/health")[0] == 200:
                return
        except (urllib.error.URLError, ConnectionError):
            pass
        time.sleep(0.5)
    raise TimeoutError("API not healthy")


# ---------- scenarios ----------

def scenario_validation() -> None:
    log("== validation and status codes")
    for body in ({"fileCount": 1, "valuesPerFile": 10}, {"fileCount": 100_000, "valuesPerFile": 10},
                 {"fileCount": 10, "valuesPerFile": 1_000_000}, {"fileCount": "10", "valuesPerFile": 10}):
        check(f"POST {body} -> 400", http("POST", "/jobs", body)[0] == 400)
    check("malformed JSON -> 400", http("POST", "/jobs", b"{bad")[0] == 400)
    check("unknown job -> 404", http("GET", "/jobs/00000000-0000-4000-8000-000000000000")[0] == 404)
    check("invalid id -> 400", http("GET", "/jobs/not-a-uuid")[0] == 400)

    job_id = create_job(40, 200_000)
    status, _, body = http("GET", f"/jobs/{job_id}/result")
    check("result before done -> 409", status == 409, body.decode())
    verify(job_id, 40, 200_000, "40 x 200k exact")


def scenario_edge_sizes() -> None:
    log("== edge sizes: single-task jobs, one file over the fan-in, C at minimum")
    for f, c in [(2, 2), (5, 10), (6, 10)]:
        verify(create_job(f, c), f, c, f"F={f} C={c} exact")


def scenario_concurrent_jobs() -> None:
    log("== concurrent jobs with different shapes")
    shapes = [(30, 50_000), (60, 20_000), (12, 100_000), (200, 1_000)]
    jobs = [(create_job(f, c), f, c) for f, c in shapes]
    for job_id, f, c in jobs:
        verify(job_id, f, c, f"concurrent F={f} C={c} exact")


def scenario_worker_killed() -> None:
    log("== SIGKILL a worker mid-job (its leases must expire and be re-claimed)")
    job_id = create_job(120, 200_000)
    job = wait_for(job_id, lambda j: j["status"] == "running" and j["progress"] >= 0.1, 120, "running at 10%")
    victim = compose("ps", "-q", "worker").split()[-1]
    log(f"killing worker container {victim[:12]} at progress {job['progress']:.2f}")
    subprocess.run(["docker", "kill", "-s", "KILL", victim], check=True, capture_output=True)
    try:
        verify(job_id, 120, 200_000, "exact after worker SIGKILL")
    finally:
        compose("up", "-d", "worker")


def scenario_api_killed() -> None:
    log("== kill the API mid-generation (generation must resume on restart)")
    job_id = create_job(300, 200_000)
    time.sleep(1.5)
    compose("kill", "api")
    compose("up", "-d", "api")
    wait_api()
    resumed = any(
        '"msg":"resuming generation"' in line and job_id in line
        for line in compose("logs", "--no-log-prefix", "api").splitlines()
    )
    check("restarted API resumed the interrupted job", resumed)
    verify(job_id, 300, 200_000, "exact after API kill during generation")


def main() -> int:
    quick = "--quick" in sys.argv
    wait_api(timeout=10)
    workers = len(compose("ps", "-q", "worker").split())
    log(f"API healthy, {workers} worker(s) running")
    if workers == 0:
        log("no workers running; start the stack with `docker compose up -d --build`")
        return 1

    started = time.monotonic()
    scenario_validation()
    scenario_edge_sizes()
    scenario_concurrent_jobs()
    if not quick:
        scenario_worker_killed()
        scenario_api_killed()

    log(f"finished in {time.monotonic() - started:.0f}s: {len(failures)} failure(s)")
    for name in failures:
        log(f"  failed: {name}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
