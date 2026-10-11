import uuid

import numpy as np

from worker.blob_store import LocalBlobStore
from worker.jobqueue import Task
from worker.speed import SpeedSimulator
from worker.vectors import decode, encode_means_csv, encode_partial


def result_path(job_id) -> str:
    return f"results/{job_id}.csv"


def partial_path(job_id) -> str:
    """Unique per attempt, so a losing attempt never overwrites a committed partial (ITD 3)."""
    return f"partials/{job_id}/{uuid.uuid4()}.bin"


def execute(task: Task, blobs: LocalBlobStore, speed: SpeedSimulator) -> str:
    """Sums the task's inputs and writes the partial (or the final CSV). Returns the output path."""
    total = np.zeros(task.values_per_file, dtype=np.int64)
    for item in task.inputs:
        total += decode(blobs.get(item.path), task.values_per_file)

    speed.wait(values_read=len(task.inputs) * task.values_per_file)

    if task.is_final:
        path = result_path(task.job_id)
        blobs.put(path, encode_means_csv(total, task.file_count))
    else:
        path = partial_path(task.job_id)
        blobs.put(path, encode_partial(total))
    return path
