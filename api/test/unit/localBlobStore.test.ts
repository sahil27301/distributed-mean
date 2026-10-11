import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { LocalBlobStore } from "../../src/blob/localBlobStore.js";

let root: string;
let store: LocalBlobStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "blobs-"));
  store = new LocalBlobStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("LocalBlobStore", () => {
  test("put then openRead round-trips bytes, creating nested directories", async () => {
    await store.put("raw/job/0.bin", Buffer.from("hello"));
    expect(await text(await store.openRead("raw/job/0.bin"))).toBe("hello");
  });

  test("put replaces existing content and leaves no temp files", async () => {
    await store.put("a/x.bin", Buffer.from("first, longer content"));
    await store.put("a/x.bin", Buffer.from("second"));
    expect(await text(await store.openRead("a/x.bin"))).toBe("second");
    expect(await readdir(path.join(root, "a"))).toEqual(["x.bin"]);
  });

  test("exists reflects whether a file is at the path", async () => {
    expect(await store.exists("a/x.bin")).toBe(false);
    await store.put("a/x.bin", Buffer.from("x"));
    expect(await store.exists("a/x.bin")).toBe(true);
    expect(await store.exists("a")).toBe(false);
  });

  test("a failed write cleans up its temp file and leaves the target untouched", async () => {
    // A non-empty directory at the target path makes the final rename fail.
    await mkdir(path.join(root, "a", "x.bin"), { recursive: true });
    await writeFile(path.join(root, "a", "x.bin", "keep"), "keep");

    await expect(store.put("a/x.bin", Buffer.from("new"))).rejects.toThrow();
    expect(await readdir(path.join(root, "a"))).toEqual(["x.bin"]);
    expect(await readdir(path.join(root, "a", "x.bin"))).toEqual(["keep"]);
  });

  test.each(["../outside.bin", "a/../../outside.bin", "/etc/passwd", ""])(
    "rejects paths outside the root: %j",
    async (blobPath) => {
      await expect(store.put(blobPath, Buffer.from("x"))).rejects.toThrow(/escapes root/);
      await expect(store.exists(blobPath)).rejects.toThrow(/escapes root/);
    },
  );

  test("openRead rejects for a missing blob before streaming", async () => {
    await expect(store.openRead("missing.bin")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
