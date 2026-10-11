import { describe, expect, test } from "vitest";
import { createLimiter } from "../../src/lib/limiter.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("createLimiter", () => {
  test("runs exactly `concurrency` tasks at a time and completes all of them", async () => {
    const limit = createLimiter(3);
    let active = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await tick();
          active--;
          return i;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  test("starts waiting tasks in submission order", async () => {
    const limit = createLimiter(1);
    const order: number[] = [];
    await Promise.all([1, 2, 3, 4].map((n) => limit(async () => order.push(n))));
    expect(order).toEqual([1, 2, 3, 4]);
  });

  test("a failing task releases its slot", async () => {
    const limit = createLimiter(1);
    const failed = limit(async () => {
      throw new Error("boom");
    });
    const next = limit(async () => "ran");
    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ran");
  });
});
