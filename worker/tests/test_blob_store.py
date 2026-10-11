import os

import pytest

from worker.blob_store import BlobStoreError, LocalBlobStore


def test_put_get_round_trip_creates_directories(blobs):
    blobs.put("partials/job/a.bin", b"hello")
    assert blobs.get("partials/job/a.bin") == b"hello"


def test_put_replaces_and_leaves_no_temp_files(blobs):
    blobs.put("a/x.bin", b"first, longer content")
    blobs.put("a/x.bin", b"second")
    assert blobs.get("a/x.bin") == b"second"
    assert os.listdir(blobs.root / "a") == ["x.bin"]


def test_failed_put_cleans_up_temp_file_and_keeps_target(blobs):
    target = blobs.root / "a" / "x.bin"
    target.mkdir(parents=True)
    (target / "keep").write_text("keep")

    with pytest.raises(BlobStoreError):
        blobs.put("a/x.bin", b"new")

    assert os.listdir(blobs.root / "a") == ["x.bin"]
    assert os.listdir(target) == ["keep"]


def test_delete_is_idempotent(blobs):
    blobs.put("a/x.bin", b"x")
    blobs.delete("a/x.bin")
    blobs.delete("a/x.bin")
    with pytest.raises(BlobStoreError):
        blobs.get("a/x.bin")


def test_delete_wraps_backend_errors(blobs):
    (blobs.root / "a" / "dir.bin").mkdir(parents=True)
    with pytest.raises(BlobStoreError, match="delete a/dir.bin"):
        blobs.delete("a/dir.bin")


@pytest.mark.parametrize("path", ["../outside.bin", "a/../../outside.bin", "/etc/passwd", ""])
def test_rejects_paths_outside_root(tmp_path, path):
    store = LocalBlobStore(tmp_path)
    for op in (lambda: store.put(path, b"x"), lambda: store.get(path), lambda: store.delete(path)):
        with pytest.raises(ValueError, match="escapes root"):
            op()
