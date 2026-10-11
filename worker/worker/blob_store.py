import os
import uuid
from pathlib import Path


class BlobStoreError(Exception):
    """Backend failure (disk, network, permissions). Callers never see backend-specific exceptions."""


class LocalBlobStore:
    """Blob storage on a local (shared) directory. Paths must match the API's (ITD 7)."""

    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()

    def resolve(self, path: str) -> Path:
        full = (self.root / path).resolve()
        if self.root not in full.parents:
            raise ValueError(f"blob path escapes root: {path!r}")
        return full

    def get(self, path: str) -> bytes:
        full = self.resolve(path)
        try:
            return full.read_bytes()
        except OSError as exc:
            raise BlobStoreError(f"get {path}: {exc}") from exc

    def put(self, path: str, data: bytes) -> None:
        """Atomic: temp file, fsync, rename. A file under its final name is always complete."""
        full = self.resolve(path)
        tmp = full.with_name(f"{full.name}.tmp-{uuid.uuid4().hex}")
        try:
            full.parent.mkdir(parents=True, exist_ok=True)
            with open(tmp, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, full)
        except OSError as exc:
            tmp.unlink(missing_ok=True)
            raise BlobStoreError(f"put {path}: {exc}") from exc

    def delete(self, path: str) -> None:
        """Idempotent: deleting a missing blob is not an error."""
        full = self.resolve(path)
        try:
            full.unlink(missing_ok=True)
        except OSError as exc:
            raise BlobStoreError(f"delete {path}: {exc}") from exc
