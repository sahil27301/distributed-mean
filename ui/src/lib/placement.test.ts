import { describe, expect, test } from "vitest";
import type { SnapshotItem, Worker } from "../api/types";
import { newPartials, placeItems } from "./placement";

const item = (id: string, workerId: string | null = null, createdBy: string | null = null): SnapshotItem => ({
  id,
  filesCovered: 1,
  workerId,
  createdBy,
});
const worker = (id: string): Worker => ({ id, label: id, speedFactor: 1, startedAt: "", task: null });

describe("placeItems", () => {
  test("held items go to their worker, the rest stay queued in order", () => {
    const p = placeItems([item("a"), item("b", "w1"), item("c"), item("d", "w1")], [worker("w1")], new Set());
    expect(p.queue.map((i) => i.id)).toEqual(["a", "c"]);
    expect(p.held.get("w1")?.map((i) => i.id)).toEqual(["b", "d"]);
    expect(p.silent).toEqual([]);
  });

  test("a just-produced partial starts in its producer, then belongs to the queue", () => {
    const items = [item("p", null, "w2")];
    expect(placeItems(items, [worker("w2")], new Set(["p"])).held.get("w2")?.[0]?.id).toBe("p");
    expect(placeItems(items, [worker("w2")], new Set()).queue[0]?.id).toBe("p");
  });

  test("a partial whose producer has since gone starts in the queue, not in a phantom station", () => {
    const p = placeItems([item("p", null, "gone")], [worker("w1")], new Set(["p"]));
    expect(p.queue.map((i) => i.id)).toEqual(["p"]);
    expect(p.silent).toEqual([]);
  });

  test("leases held by a worker with no presence are reported as silent", () => {
    const p = placeItems([item("a", "ghost")], [worker("w1")], new Set());
    expect(p.silent).toEqual(["ghost"]);
    expect(p.queue).toEqual([]);
  });
});

describe("newPartials", () => {
  test("only worker-produced items that weren't there before; nothing on the first snapshot", () => {
    const items = [item("raw"), item("old", null, "w1"), item("new", null, "w1")];
    expect(newPartials(null, items)).toEqual(new Set());
    expect(newPartials(new Set(["raw", "old"]), items)).toEqual(new Set(["new"]));
  });
});
