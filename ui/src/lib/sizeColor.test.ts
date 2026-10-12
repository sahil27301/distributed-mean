import { describe, expect, test } from "vitest";
import { sizeShare } from "./sizeColor";

describe("sizeShare", () => {
  test("raw files sit at the light end and the full result at the dark end", () => {
    expect(sizeShare(1, 100)).toBe(0);
    expect(sizeShare(100, 100)).toBe(1);
  });

  test("each 5-way merge level is an equal step", () => {
    const steps = [1, 5, 25, 125].map((n) => sizeShare(n, 625));
    [0, 0.25, 0.5, 0.75].forEach((expected, i) => expect(steps[i]).toBeCloseTo(expected, 10));
  });

  test("clamps out-of-range sizes instead of producing invalid colours", () => {
    expect(sizeShare(200, 100)).toBe(1);
    expect(sizeShare(0.5, 100)).toBe(0);
  });
});
