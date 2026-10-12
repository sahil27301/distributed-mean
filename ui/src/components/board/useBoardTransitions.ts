import { useEffect, useRef, useState } from "react";
import type { SnapshotItem } from "../../api/types";
import { newPartials } from "../../lib/placement";

export interface Spent {
  item: SnapshotItem;
  workerId: string;
}

const SPENT_VISIBLE_MS = 400;
const ARRIVAL_HOLD_MS = 80;

/**
 * Diffs consecutive snapshots into the two transitions the board animates:
 * - `arriving`: partials just produced, held in their producer briefly so they fly back to the queue;
 * - `spent`: inputs that disappeared while held by a worker, shown shrinking in that worker's station.
 */
export function useBoardTransitions(items: SnapshotItem[] | null): {
  arriving: ReadonlySet<string>;
  spent: Spent[];
} {
  const previous = useRef<Map<string, SnapshotItem> | null>(null);
  const [arriving, setArriving] = useState<ReadonlySet<string>>(new Set());
  const [spent, setSpent] = useState<Spent[]>([]);

  useEffect(() => {
    if (items === null) return;
    const prev = previous.current;
    const current = new Map(items.map((i) => [i.id, i]));
    previous.current = current;
    if (prev === null) return;

    const born = newPartials(new Set(prev.keys()), items);
    const gone: Spent[] = [...prev.values()]
      .filter((i) => i.workerId !== null && !current.has(i.id))
      .map((i) => ({ item: i, workerId: i.workerId! }));

    if (born.size > 0 || gone.length > 0) {
      console.debug("[board] transition", { born: born.size, spent: gone.length, items: items.length });
    }

    const timers: ReturnType<typeof setTimeout>[] = [];
    if (born.size > 0) {
      setArriving(born);
      timers.push(setTimeout(() => setArriving(new Set()), ARRIVAL_HOLD_MS));
    }
    if (gone.length > 0) {
      setSpent((s) => [...s, ...gone]);
      const ids = new Set(gone.map((g) => g.item.id));
      timers.push(setTimeout(() => setSpent((s) => s.filter((g) => !ids.has(g.item.id))), SPENT_VISIBLE_MS));
    }
    return () => timers.forEach(clearTimeout);
  }, [items]);

  return { arriving, spent };
}
