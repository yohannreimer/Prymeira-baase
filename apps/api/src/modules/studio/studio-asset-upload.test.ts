import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  createStudioUploadSemaphore,
  inspectStudioUploadFile,
  spoolStudioAssetUpload
} from "./studio-asset-upload";

describe("Studio bounded upload inspection", () => {
  it.each([
    ["application/pdf", Buffer.from("%PDF-1.7\n")],
    ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ["image/webp", Buffer.from("RIFF0000WEBP")],
    ["audio/wav", Buffer.from("RIFF0000WAVE")],
    ["audio/ogg", Buffer.from("OggS0000OpusHead")],
    ["audio/webm", Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("webm0000A_OPUS")])],
    ["audio/mpeg", Buffer.from("ID3audio")],
    ["audio/mp4", Buffer.from("0000ftypM4A ")]
  ])("sniffs canonical %s signatures", async (mimeType, body) => {
    await withTempFile(body, async (path) => {
      expect(await inspectStudioUploadFile(path, mimeType)).toMatchObject({ mimeType });
    });
  });

  it("rejects spoofed PDF/audio and binary text", async () => {
    await withTempFile(Buffer.from("not a pdf"), async (path) => {
      await expect(inspectStudioUploadFile(path, "application/pdf"))
        .rejects.toMatchObject({ code: "STUDIO_ASSET_MIME_MISMATCH" });
    });
    await withTempFile(Buffer.from("not audio"), async (path) => {
      await expect(inspectStudioUploadFile(path, "audio/mpeg"))
        .rejects.toMatchObject({ code: "STUDIO_ASSET_MIME_MISMATCH" });
    });
    await withTempFile(Buffer.from([0x61, 0, 0x62]), async (path) => {
      await expect(inspectStudioUploadFile(path, "text/plain"))
        .rejects.toMatchObject({ code: "STUDIO_ASSET_TEXT_INVALID" });
    });
  });

  it("bounds concurrent temp-file spools without queueing request bodies", () => {
    const semaphore = createStudioUploadSemaphore(1);
    const release = semaphore.tryAcquire();
    expect(release).toBeTypeOf("function");
    expect(semaphore.tryAcquire()).toBeNull();
    release!();
    expect(semaphore.tryAcquire()).toBeTypeOf("function");
  });

  it("always removes the private temp spool after its callback", async () => {
    let capturedPath = "";
    await spoolStudioAssetUpload({
      file: Readable.from("private text"),
      declaredMimeType: "text/plain"
    }, async (file) => {
      capturedPath = file.path;
      await access(file.path);
    });
    await expect(access(capturedPath)).rejects.toThrow();
  });
});

async function withTempFile(body: Buffer, run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "baase-upload-test-"));
  const path = join(directory, "upload");
  try {
    await writeFile(path, body);
    await run(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
