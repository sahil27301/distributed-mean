import numpy as np
import pytest

from worker.vectors import INT32_MAX, decode, encode_means_csv, encode_partial


def test_decode_reads_little_endian_int32():
    data = (1).to_bytes(4, "little") + (999).to_bytes(4, "little")
    assert decode(data, 2).tolist() == [1, 999]


@pytest.mark.parametrize("size", [0, 7, 12])
def test_decode_rejects_wrong_length(size):
    with pytest.raises(ValueError, match="expected 8 bytes"):
        decode(b"\x00" * size, 2)


def test_partial_round_trips():
    total = np.array([0, 5, 2_000_000_000], dtype=np.int64)
    assert decode(encode_partial(total), 3).tolist() == [0, 5, 2_000_000_000]


def test_partial_refuses_to_wrap_on_overflow():
    with pytest.raises(OverflowError):
        encode_partial(np.array([INT32_MAX + 1], dtype=np.int64))


def test_means_csv_is_exact_and_one_line_per_index():
    total = np.array([3, 1, 0, 999 * 7], dtype=np.int64)
    assert encode_means_csv(total, 2) == b"1.5\n0.5\n0.0\n3496.5\n"


def test_means_csv_round_trips_non_terminating_fractions():
    total = np.array([1, 2, 10], dtype=np.int64)
    parsed = np.array([float(x) for x in encode_means_csv(total, 3).decode().split()])
    assert np.array_equal(parsed, total / 3)
