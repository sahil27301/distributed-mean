import os
import random
import socket
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    database_url: str
    blob_root: str
    log_level: str
    worker_id: str
    idle_poll_seconds: float = 0.5
    lease_seconds: float = 30
    heartbeat_seconds: float = 10
    max_fan_in: int = 5
    max_attempts: int = 3
    # Simulated slowness (see SpeedSimulator).
    speed_factor: float = 1.0
    seconds_per_million_values: float = 1.0
    task_overhead_seconds: float = 0.0


def load_config(env: dict[str, str] | None = None) -> Config:
    env = dict(os.environ) if env is None else env
    missing = [key for key in ("DATABASE_URL", "BLOB_ROOT") if not env.get(key)]
    if missing:
        raise ValueError(f"Missing required environment variables: {', '.join(missing)}")
    config = Config(
        database_url=env["DATABASE_URL"],
        blob_root=env["BLOB_ROOT"],
        log_level=env.get("LOG_LEVEL", "INFO"),
        worker_id=env.get("WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}",
        idle_poll_seconds=float(env.get("IDLE_POLL_SECONDS", "0.5")),
        lease_seconds=float(env.get("LEASE_SECONDS", "30")),
        heartbeat_seconds=float(env.get("HEARTBEAT_SECONDS", "10")),
        # Replicas share one environment, so each process draws its own factor unless pinned.
        speed_factor=float(env.get("WORKER_SPEED_FACTOR") or random.uniform(1.0, 4.0)),
        seconds_per_million_values=float(env.get("SECONDS_PER_MILLION_VALUES") or "1.0"),
        task_overhead_seconds=float(env.get("TASK_OVERHEAD_SECONDS") or "0.0"),
    )
    if config.heartbeat_seconds * 2 > config.lease_seconds:
        # One missed heartbeat must not cost a live worker its leases.
        raise ValueError(
            f"HEARTBEAT_SECONDS ({config.heartbeat_seconds}) must be at most half of LEASE_SECONDS "
            f"({config.lease_seconds})"
        )
    return config
