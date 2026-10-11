import { describe, expect, test } from "vitest";
import { CreateJobSchema } from "../../src/jobs/schemas.js";

describe("CreateJobSchema", () => {
  test.each([
    { fileCount: 2, valuesPerFile: 2 },
    { fileCount: 99_999, valuesPerFile: 999_999 },
  ])("accepts boundary values %o", (body) => {
    expect(CreateJobSchema.safeParse(body).success).toBe(true);
  });

  test.each([
    ["fileCount below min", { fileCount: 1, valuesPerFile: 10 }],
    ["fileCount above max", { fileCount: 100_000, valuesPerFile: 10 }],
    ["valuesPerFile below min", { fileCount: 10, valuesPerFile: 1 }],
    ["valuesPerFile above max", { fileCount: 10, valuesPerFile: 1_000_000 }],
    ["non-integer", { fileCount: 2.5, valuesPerFile: 10 }],
    ["numeric string", { fileCount: "10", valuesPerFile: 10 }],
    ["missing field", { fileCount: 10 }],
    ["null", null],
  ])("rejects %s", (_name, body) => {
    expect(CreateJobSchema.safeParse(body).success).toBe(false);
  });
});
