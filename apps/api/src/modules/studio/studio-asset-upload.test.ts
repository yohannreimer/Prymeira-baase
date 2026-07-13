import { access, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  createStudioUploadSemaphore,
  inspectStudioUploadFile,
  scavengeStaleStudioUploadDirectories,
  spoolStudioAssetUpload
} from "./studio-asset-upload";

describe("Studio bounded upload inspection", () => {
  it.each([
    ["application/pdf", Buffer.from("%PDF-1.7\n")],
    ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ["image/webp", Buffer.from("RIFF0000WEBP")]
  ])("sniffs canonical %s signatures", async (mimeType, body) => {
    await withTempFile(body, async (path) => {
      expect(await inspectStudioUploadFile(path, mimeType)).toMatchObject({ mimeType });
    });
  });

  it.each([
    ["audio/wav", validWav(), "audio/wav"],
    ["audio/x-wav", validWav(), "audio/wav"],
    ["audio/ogg", Buffer.from(validOggBase64, "base64"), "audio/ogg"],
    ["audio/webm", Buffer.from(validWebmBase64, "base64"), "audio/webm"]
  ])("validates maintained audio parser structure for %s", async (declared, body, canonical) => {
    await withTempFile(body, async (path) => {
      expect(await inspectStudioUploadFile(path, declared)).toEqual({ mimeType: canonical });
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

  it("accepts a structurally valid MP3 frame and rejects reserved or free-format headers", async () => {
    const valid = Buffer.alloc(417);
    valid.set([0xff, 0xfb, 0x90, 0x64]);
    await withTempFile(valid, async (path) => {
      expect(await inspectStudioUploadFile(path, "audio/mpeg")).toEqual({ mimeType: "audio/mpeg" });
    });
    for (const header of [
      [0xff, 0xfb, 0x00, 0x64],
      [0xff, 0xfb, 0xfc, 0x64],
      [0xff, 0xe0, 0x90, 0x64]
    ]) {
      const invalid = Buffer.alloc(417);
      invalid.set(header);
      await withTempFile(invalid, async (path) => {
        await expect(inspectStudioUploadFile(path, "audio/mpeg"))
          .rejects.toMatchObject({ code: "STUDIO_ASSET_MIME_MISMATCH" });
      });
    }
  });

  it("accepts an MP3 frame after a valid ID3 tag larger than the inspection prefix", async () => {
    const tagSize = 70 * 1024;
    const body = Buffer.concat([
      Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00,
        (tagSize >> 21) & 0x7f, (tagSize >> 14) & 0x7f, (tagSize >> 7) & 0x7f, tagSize & 0x7f]),
      Buffer.alloc(tagSize),
      Buffer.from([0xff, 0xfb, 0x90, 0x64]),
      Buffer.alloc(2_048)
    ]);
    await withTempFile(body, async (path) => {
      expect(await inspectStudioUploadFile(path, "audio/mpeg")).toEqual({ mimeType: "audio/mpeg" });
    });
  });

  it("rejects malformed or out-of-range ID3 frame offsets", async () => {
    for (const header of [
      Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00]),
      Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x7f, 0x7f, 0x7f, 0x7f])
    ]) {
      await withTempFile(Buffer.concat([header, Buffer.alloc(128)]), async (path) => {
        await expect(inspectStudioUploadFile(path, "audio/mpeg"))
          .rejects.toMatchObject({ code: "STUDIO_ASSET_MIME_MISMATCH" });
      });
    }
  });

  it("accepts an isom-branded M4A with an audio track and rejects MP4 spoofing or video", async () => {
    await withTempFile(Buffer.from(validM4aBase64, "base64"), async (path) => {
      expect(await inspectStudioUploadFile(path, "audio/mp4")).toEqual({ mimeType: "audio/mp4" });
    });
    await withTempFile(Buffer.from("0000ftypisomarbitrary payload"), async (path) => {
      await expect(inspectStudioUploadFile(path, "audio/mp4"))
        .rejects.toMatchObject({ code: "STUDIO_ASSET_MIME_MISMATCH" });
    });
    await withTempFile(Buffer.from(videoMp4Base64, "base64"), async (path) => {
      await expect(inspectStudioUploadFile(path, "audio/mp4"))
        .rejects.toMatchObject({ code: "STUDIO_ASSET_MIME_MISMATCH" });
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

  it("reports temp cleanup failure without replacing callback success or primary error", async () => {
    const cleanupErrors: unknown[] = [];
    const cleanupPaths: string[] = [];
    const removeDirectory = async () => { throw new Error("rm unavailable"); };
    await expect(spoolStudioAssetUpload({
      file: Readable.from("private text"), declaredMimeType: "text/plain"
    }, async () => "saved", {
      removeDirectory: removeDirectory as typeof rm,
      onCleanupError: (error, path) => { cleanupErrors.push(error); cleanupPaths.push(path); }
    })).resolves.toBe("saved");
    await expect(spoolStudioAssetUpload({
      file: Readable.from("private text"), declaredMimeType: "text/plain"
    }, async () => { throw new Error("primary failure"); }, {
      removeDirectory: removeDirectory as typeof rm,
      onCleanupError: (error, path) => { cleanupErrors.push(error); cleanupPaths.push(path); }
    })).rejects.toThrow("primary failure");
    expect(cleanupErrors).toHaveLength(2);
    await Promise.all(cleanupPaths.map((path) => rm(path, { recursive: true, force: true })));
  });

  it("scavenges only bounded stale real upload directories and never follows symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "baase-scavenger-test-"));
    const oldDirectory = join(root, "baase-studio-upload-old");
    const freshDirectory = join(root, "baase-studio-upload-fresh");
    const outside = join(root, "outside-private");
    const linked = join(root, "baase-studio-upload-link");
    try {
      await mkdir(oldDirectory);
      await mkdir(freshDirectory);
      await writeFile(outside, "do not remove");
      await symlink(outside, linked);
      await utimes(oldDirectory, new Date(0), new Date(0));
      const result = await scavengeStaleStudioUploadDirectories({
        root,
        now: () => 2 * 24 * 60 * 60_000,
        olderThanMs: 24 * 60 * 60_000,
        maxEntries: 10
      });
      expect(result.removed).toBe(1);
      await expect(access(oldDirectory)).rejects.toThrow();
      await access(freshDirectory);
      await access(linked);
      await access(outside);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies the batch cap after filtering unrelated temp entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "baase-scavenger-filter-test-"));
    try {
      await Promise.all(Array.from({ length: 125 }, (_, index) =>
        mkdir(join(root, `aaa-unrelated-${String(index).padStart(3, "0")}`))));
      const studioDirectories = Array.from({ length: 3 }, (_, index) =>
        join(root, `baase-studio-upload-${String(index).padStart(3, "0")}`));
      await Promise.all(studioDirectories.map(async (path) => {
        await mkdir(path);
        await utimes(path, new Date(0), new Date(0));
      }));
      const result = await scavengeStaleStudioUploadDirectories({
        root,
        now: () => 2 * 24 * 60 * 60_000,
        olderThanMs: 24 * 60 * 60_000,
        maxEntries: 2
      });
      expect(result.removed).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rotates bounded batches until every stale Studio directory is visited", async () => {
    const root = await mkdtemp(join(tmpdir(), "baase-scavenger-rotation-test-"));
    try {
      await Promise.all(Array.from({ length: 125 }, (_, index) =>
        mkdir(join(root, `aaa-unrelated-${String(index).padStart(3, "0")}`))));
      const studioDirectories = Array.from({ length: 205 }, (_, index) =>
        join(root, `baase-studio-upload-${String(index).padStart(3, "0")}`));
      await Promise.all(studioDirectories.map(async (path) => {
        await mkdir(path);
        await utimes(path, new Date(0), new Date(0));
      }));
      let cursor: string | null = null;
      let removed = 0;
      for (let batch = 0; batch < 3; batch += 1) {
        const result = await scavengeStaleStudioUploadDirectories({
          root,
          cursor,
          now: () => 2 * 24 * 60 * 60_000,
          olderThanMs: 24 * 60 * 60_000,
          maxEntries: 100
        });
        removed += result.removed;
        cursor = result.nextCursor;
      }
      expect(removed).toBe(205);
      await Promise.all(studioDirectories.map(async (path) => {
        await expect(access(path)).rejects.toThrow();
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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

function validWav() {
  const dataBytes = 8;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8_000, 24);
  buffer.writeUInt32LE(16_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

const validOggBase64 = "T2dnUwACAAAAAAAAAAAivpJuAAAAANYk9P4BE09wdXNIZWFkAQE4AUAfAAAAAABPZ2dTAAAAAAAAAAAAACK+km4BAAAAcTAdygE+T3B1c1RhZ3MNAAAATGF2ZjYyLjEyLjEwMQEAAAAdAAAAZW5jb2Rlcj1MYXZjNjIuMjguMTAxIGxpYm9wdXNPZ2dTAASYCgAAAAAAACK+km4CAAAAaZit9gMDAwOY//6Y//6Y//4=";
const validWebmBase64 = "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////EU2bdKtNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggFC7AEAAAAAAABoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAxV0GNTGF2ZjYyLjEyLjEwMUSJiEBJAAAAAAAAFlSua+WuAQAAAAAAAFzXgQFzxYgj0jA6ArUt6ZyBACK1nIN1bmSIgQCGhkFfT1BVU1aqg2MuoFa7hATEtACDgQLhkZ+BAbWIQL9AAAAAAABiZIEQY6KTT3B1c0hlYWQBATgBQB8AAAAAABJUw2fZc3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2Mi4xMi4xMDFzc7NjwItjxYgj0jA6ArUt6WfIokWjh0VOQ09ERVJEh5VMYXZjNjIuMjguMTAxIGxpYm9wdXMfQ7Z1qeeBAKOHgQAAgJj//qOHgQAVgJj//qCSoYeBACkAmP/+m4ERdaKDNWfg";
const validM4aBase64 = "AAAAIGZ0eXBpc29tAAACAGlzb21pc282aXNvMm1wNDEAAAK9bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAAAAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAb90cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAEBAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAFbbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAfQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHNvdW4AAAAAAAAAAAAAAABTb3VuZEhhbmRsZXIAAAABBm1pbmYAAAAQc21oZAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAAynN0YmwAAAB+c3RzZAAAAAAAAAABAAAAbm1wNGEAAAAAAAAAAQAAAAAAAAAAAAEAEAAAAAAfQAAAAAAANmVzZHMAAAAAA4CAgCUAAQAEgICAF0AVAAAAAAA+gAAAPoAFgICABRWIVuUABoCAgAECAAAAFGJ0cnQAAAAAAAA+gAAAPoAAAAAQc3R0cwAAAAAAAAAAAAAAEHN0c2MAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAChtdmV4AAAAIHRyZXgAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYyLjEyLjEwMQAAAHxtb29mAAAAEG1maGQAAAAAAAAAAQAAAGR0cmFmAAAAJHRmaGQAAAA5AAAAAQAAAAAAAALdAAAEAAAAABUCAAAAAAAAFHRmZHQBAAAAAAAAAAAAAAAAAAAkdHJ1bgAAAwEAAAACAAAAhAAABAAAAAAVAAABkAAAAAQAAAAhbWRhdN4CAExhdmM2Mi4yOC4xMDEAAjBADgEYIAcAAABDbWZyYQAAACt0ZnJhAQAAAAAAAAEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAt0BAQEAAAAQbWZybwAAAAAAAABD";
const videoMp4Base64 = "AAAAJGZ0eXBpc29tAAACAGlzb21pc282aXNvMmF2YzFtcDQxAAAC5W1vb3YAAABsbXZoZAAAAAAAAAAAAAAAAAAAA+gAAAAAAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAHndHJhawAAAFx0a2hkAAAAAwAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAQAAAAEAAAAAABg21kaWEAAAAgbWRoZAAAAAAAAAAAAAAAAAAAQAAAAAAAVcQAAAAAAC1oZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAVmlkZW9IYW5kbGVyAAAAAS5taW5mAAAAFHZtaGQAAAABAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAADuc3RibAAAAKJzdHNkAAAAAAAAAAEAAACSYXZjMQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAQABAASAAAAEgAAAAAAAAAARVMYXZjNjIuMjguMTAxIGxpYngyNjQAAAAAAAAAAAAAABj//wAAACxhdmNDAULACv/hABVnQsAK2nsBEAAAAwAQAAADACDxImoBAARozg/IAAAAEHBhc3AAAAABAAAAAQAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAAKG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAAAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjIuMTIuMTAxAAAAcG1vb2YAAAAQbWZoZAAAAAAAAAABAAAAWHRyYWYAAAAkdGZoZAAAADkAAAABAAAAAAAAAwkAAEAAAAACZQEBAAAAAAAUdGZkdAEAAAAAAAAAAAAAAAAAABh0cnVuAAAABQAAAAEAAAB4AgAAAAAAAm1tZGF0AAACUwYF//9P3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTAgcmVmPTEgZGVibG9jaz0wOjA6MCBhbmFseXNlPTA6MCBtZT1kaWEgc3VibWU9MCBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0wIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MCA4eDhkY3Q9MCBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0wIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD0yNTAga2V5aW50X21pbj0xIHNjZW5lY3V0PTAgaW50cmFfcmVmcmVzaD0wIHJjPWNyZiBtYnRyZWU9MCBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0wIGtleWludD0yNTAga2V5aW50X21pbj0xIHNjZW5lY3V0PTAgaW50cmFfcmVmcmVzaD0wIHJjPWNyZiBtYnRyZWU9MCBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0wAIAAAAAKZYiEOiYoAAkC4AAAAENtZnJhAAAAK3RmcmEBAAAAAAAAAQAAAAAAAAABAAAAAAAAAAAAAAAAAAADCQEBAQAAABBtZnJvAAAAAAAAAEM=";
