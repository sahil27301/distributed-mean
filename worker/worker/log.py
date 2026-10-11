import logging


def setup_logging(level: str, worker_id: str) -> logging.Logger:
    logging.basicConfig(
        level=level,
        format=f"%(asctime)s %(levelname)s worker={worker_id} %(name)s: %(message)s",
    )
    return logging.getLogger("worker")
