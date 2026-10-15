import { describe, expect, test } from "vitest";
import { formatTimestamp } from "./format";

const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

describe("formatTimestamp", () => {
  const now = local(2026, 10, 12, 0, 30).getTime();

  test("uses calendar days, not 24-hour windows", () => {
    expect(formatTimestamp(local(2026, 10, 12, 0, 5).toISOString(), now)).toMatch(/^Today at /);
    // 1 hour before `now`, but on the previous calendar day.
    expect(formatTimestamp(local(2026, 10, 11, 23, 30).toISOString(), now)).toMatch(/^Yesterday at /);
    expect(formatTimestamp(local(2026, 10, 10, 23, 30).toISOString(), now)).not.toMatch(/^(Today|Yesterday)/);
  });

  test("adds the year only when it differs", () => {
    expect(formatTimestamp(local(2026, 3, 1).toISOString(), now)).not.toMatch(/2026/);
    expect(formatTimestamp(local(2025, 3, 1).toISOString(), now)).toMatch(/2025/);
  });
});
