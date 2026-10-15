import { useCallback, useEffect, useRef, useState } from "react";

interface Polled<T> {
  data: T | null;
  error: Error | null;
  refresh: () => void;
}

/**
 * Fetches immediately, then every `intervalMs` after the previous response lands (never overlapping).
 * Pauses while the tab is hidden. Changing `key` restarts it and drops the old data.
 */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number, key: string): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const tickRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setData(null);
    setError(null);

    const tick = async () => {
      clearTimeout(timer);
      if (document.hidden) {
        timer = setTimeout(tick, intervalMs);
        return;
      }
      try {
        const next = await fetcherRef.current();
        if (!cancelled) {
          setData(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err as Error);
      }
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    };
    tickRef.current = () => void tick();
    void tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, intervalMs]);

  const refresh = useCallback(() => tickRef.current(), []);
  return { data, error, refresh };
}

/** Fetches once per `key`; a null key skips fetching (e.g. until a job finishes). */
export function useFetchOnce<T>(fetcher: () => Promise<T>, key: string | null): { data: T | null; error: Error | null } {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: Error | null }>({
    key: null,
    data: null,
    error: null,
  });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    fetcherRef.current().then(
      (data) => !cancelled && setState({ key, data, error: null }),
      (error: Error) => !cancelled && setState({ key, data: null, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state.key === key ? { data: state.data, error: state.error } : { data: null, error: null };
}

/** Re-renders every `intervalMs`, for elapsed-time labels. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
