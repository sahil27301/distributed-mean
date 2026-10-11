import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { BlobStore } from "./blobStore.js";

export class LocalBlobStore implements BlobStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  resolve(blobPath: string): string {
    const full = path.resolve(this.root, blobPath);
    if (!full.startsWith(this.root + path.sep)) {
      throw new Error(`blob path escapes root: ${blobPath}`);
    }
    return full;
  }

  async put(blobPath: string, data: Uint8Array): Promise<void> {
    const full = this.resolve(blobPath);
    await mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.tmp-${randomUUID()}`;
    try {
      const file = await open(tmp, "w");
      try {
        await file.writeFile(data);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(tmp, full);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async exists(blobPath: string): Promise<boolean> {
    try {
      return (await stat(this.resolve(blobPath))).isFile();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }

  async openRead(blobPath: string): Promise<Readable> {
    const file = await open(this.resolve(blobPath), "r");
    return file.createReadStream();
  }

  async getDownloadUrl(_blobPath: string): Promise<string | null> {
    return null;
  }
}
