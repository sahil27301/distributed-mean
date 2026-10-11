import random
import time
from dataclasses import dataclass, field


@dataclass
class SpeedSimulator:
    """Makes workers artificially slow.

    delay = factor * jitter * (overhead + values_read / 1e6 * seconds_per_million_values)

    The per-value term models I/O, which dominates real cost and grows linearly with bytes read.
    The fixed overhead makes speed differences visible on small jobs without distorting large ones.
    """

    factor: float
    seconds_per_million_values: float
    overhead_seconds: float = 0.0
    rng: random.Random = field(default_factory=random.Random)

    def delay_for(self, values_read: int) -> float:
        jitter = self.rng.uniform(0.8, 1.5)
        base = self.overhead_seconds + values_read / 1_000_000 * self.seconds_per_million_values
        return self.factor * jitter * base

    def wait(self, values_read: int) -> None:
        delay = self.delay_for(values_read)
        if delay > 0:
            time.sleep(delay)
