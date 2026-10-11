import type { Readable } from "node:stream";

export interface BlobStore {
  /** Atomic: readers see either the previous content or the full new content, never a partial write. */
  put(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Rejects if the blob doesn't exist, before any data is streamed. */
  openRead(path: string): Promise<Readable>;
  /** A direct download URL, or null if clients must stream through the API. */
  getDownloadUrl(path: string): Promise<string | null>;
}
