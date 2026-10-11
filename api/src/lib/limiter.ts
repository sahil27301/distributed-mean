export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/** Runs at most `concurrency` tasks at once; the rest wait in FIFO order. */
export function createLimiter(concurrency: number): Limiter {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async (task) => {
    if (active < concurrency) {
      active++;
    } else {
      // A finishing task hands its slot straight to us, so `active` is not incremented here.
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
