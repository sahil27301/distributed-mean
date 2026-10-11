import { describe, expect, test } from "vitest";
import { generateFile } from "../../src/generation/generateFile.js";

const JOB = "00000000-0000-4000-8000-000000000001";

function decode(buf: Buffer): number[] {
  return Array.from({ length: buf.length / 4 }, (_, i) => buf.readInt32LE(i * 4));
}

describe("generateFile", () => {
  test("is deterministic for the same job and index", () => {
    expect(generateFile(JOB, 3, 1000).equals(generateFile(JOB, 3, 1000))).toBe(true);
  });

  test("differs across file indexes and across jobs", () => {
    const base = generateFile(JOB, 0, 1000);
    expect(base.equals(generateFile(JOB, 1, 1000))).toBe(false);
    expect(base.equals(generateFile("00000000-0000-4000-8000-000000000002", 0, 1000))).toBe(false);
  });

  test("writes exactly valuesPerFile int32 values", () => {
    expect(generateFile(JOB, 0, 7).length).toBe(28);
  });

  test("values cover [0, 999] and are roughly uniform", () => {
    const values = decode(generateFile(JOB, 0, 100_000));
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBe(999);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(490);
    expect(mean).toBeLessThan(509);
  });

  test("output is pinned, so changes to the generator are deliberate", () => {
    expect(decode(generateFile(JOB, 0, 5))).toEqual(GOLDEN);
  });
});

const GOLDEN = [681, 601, 381, 943, 452];
