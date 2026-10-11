import { MAX_VALUE } from "../jobs/limits.js";
import { fnv1a32, mulberry32 } from "./prng.js";

/** Values for raw file `index` of a job as little-endian int32. Same inputs, same bytes. */
export function generateFile(jobId: string, index: number, valuesPerFile: number): Buffer {
  const next = mulberry32(fnv1a32(`${jobId}:${index}`));
  const buf = Buffer.allocUnsafe(valuesPerFile * 4);
  for (let i = 0; i < valuesPerFile; i++) {
    buf.writeInt32LE(next() % (MAX_VALUE + 1), i * 4);
  }
  return buf;
}
