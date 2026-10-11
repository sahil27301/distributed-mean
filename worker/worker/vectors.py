"""On-disk vector format (ITD 8): raw little-endian int32, one value per index."""

import numpy as np

INT32 = np.dtype("<i4")
INT32_MAX = np.iinfo(np.int32).max


def decode(data: bytes, length: int) -> np.ndarray:
    if len(data) != length * INT32.itemsize:
        raise ValueError(f"expected {length * INT32.itemsize} bytes, got {len(data)}")
    return np.frombuffer(data, dtype=INT32)


def encode_partial(total: np.ndarray) -> bytes:
    if total.size and int(total.max()) > INT32_MAX:
        raise OverflowError("partial sum exceeds int32")
    return total.astype(INT32).tobytes()


def encode_means_csv(total: np.ndarray, file_count: int) -> bytes:
    """One mean per line. repr() is the shortest string that round-trips the float64 exactly."""
    means = (total / file_count).tolist()
    return ("\n".join(map(repr, means)) + "\n").encode()
