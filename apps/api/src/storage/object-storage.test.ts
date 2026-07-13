import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createInMemoryObjectStorage } from "./in-memory-object-storage";
import { objectBodyToNodeReadable } from "./s3-object-storage";

describe("ObjectStorage private reads", () => {
  it("returns an independent private stream and metadata from memory storage", async () => {
    const storage = createInMemoryObjectStorage();
    await storage.put({
      key: "private/key",
      body: Readable.from("secret"),
      contentType: "text/plain",
      sizeBytes: 6
    });
    const object = await storage.get("private/key");
    const chunks: Buffer[] = [];
    for await (const chunk of object.body) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toBe("secret");
    expect(object).toMatchObject({ contentType: "text/plain", sizeBytes: 6 });
  });

  it("normalizes SDK streams and byte arrays to Node Readable", async () => {
    for (const sdkBody of [Readable.from("node"), new Uint8Array(Buffer.from("bytes"))]) {
      const stream = objectBodyToNodeReadable(sdkBody);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      expect(["node", "bytes"]).toContain(Buffer.concat(chunks).toString("utf8"));
    }
  });

  it("honors cancellation before and after a private memory read", async () => {
    const storage = createInMemoryObjectStorage();
    await storage.put({
      key: "private/key",
      body: Readable.from("secret"),
      contentType: "text/plain",
      sizeBytes: 6
    });
    const before = new AbortController();
    before.abort(new Error("cancelled"));
    await expect(storage.get("private/key", { signal: before.signal })).rejects.toThrow("cancelled");

    const after = new AbortController();
    const object = await storage.get("private/key", { signal: after.signal });
    after.abort();
    expect(object.body.destroyed).toBe(true);
  });

  it("honors cancellation for memory puts and deletes without committing late state", async () => {
    const storage = createInMemoryObjectStorage();
    const stalled = new Readable({ read() {} });
    const putController = new AbortController();
    const pendingPut = storage.put({
      key: "private/stalled",
      body: stalled,
      contentType: "text/plain",
      sizeBytes: 6
    }, { signal: putController.signal });
    putController.abort(new Error("put cancelled"));
    await expect(pendingPut).rejects.toThrow("put cancelled");
    expect(stalled.destroyed).toBe(true);
    expect(storage.keys()).toEqual([]);

    await storage.put({
      key: "private/existing",
      body: Readable.from("secret"),
      contentType: "text/plain",
      sizeBytes: 6
    });
    const deleteController = new AbortController();
    deleteController.abort(new Error("delete cancelled"));
    await expect(storage.delete("private/existing", { signal: deleteController.signal }))
      .rejects.toThrow("delete cancelled");
    expect(storage.keys()).toEqual(["private/existing"]);
  });
});
