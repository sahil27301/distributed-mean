import type { SnapshotItem, Worker } from "../api/types";

export interface Placement {
  queue: SnapshotItem[];
  /** Items per worker id, including workers that hold a lease but stopped reporting presence. */
  held: Map<string, SnapshotItem[]>;
  /** Workers holding leases on this job without a presence row: killed, but leases not expired yet. */
  silent: string[];
}

/**
 * Decides where each chip is drawn. `arriving` lists partials seen for the first time: they are
 * drawn inside the worker that produced them for one frame, so they visibly travel back to the queue.
 */
export function placeItems(items: SnapshotItem[], workers: Worker[], arriving: ReadonlySet<string>): Placement {
  const live = new Set(workers.map((w) => w.id));
  const queue: SnapshotItem[] = [];
  const held = new Map<string, SnapshotItem[]>();

  for (const item of items) {
    const producer = arriving.has(item.id) && item.createdBy && live.has(item.createdBy) ? item.createdBy : null;
    const owner = item.workerId ?? producer;
    if (owner === null) {
      queue.push(item);
      continue;
    }
    const list = held.get(owner) ?? [];
    list.push(item);
    held.set(owner, list);
  }

  const silent = [...held.keys()].filter((id) => !live.has(id));
  return { queue, held, silent };
}

/** Ids present now but not in the previous snapshot that were produced by a worker. */
export function newPartials(previous: ReadonlySet<string> | null, items: SnapshotItem[]): Set<string> {
  if (previous === null) return new Set();
  return new Set(items.filter((i) => i.createdBy !== null && !previous.has(i.id)).map((i) => i.id));
}
