import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { z } from "zod";

export const ResultPreviewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Reads only the first `limit` lines and closes the stream, so a large result costs a few KB. */
export async function readFirstMeans(stream: Readable, limit: number): Promise<number[]> {
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const means: number[] = [];
  try {
    for await (const line of lines) {
      if (line === "") continue;
      means.push(Number(line));
      if (means.length >= limit) break;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return means;
}
