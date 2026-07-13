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
});
