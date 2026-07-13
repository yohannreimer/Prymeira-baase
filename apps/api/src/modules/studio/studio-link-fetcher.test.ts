import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  captureStudioLinkSnapshot,
  isGloballyRoutableAddress,
  type StudioLinkFetcher,
  type StudioLinkResolver
} from "./studio-link-fetcher";

describe("Studio safe link fetcher", () => {
  it.each([
    ["loopback", "127.0.0.1"],
    ["carrier NAT", "100.64.0.1"],
    ["documentation", "192.0.2.1"],
    ["IPv6 documentation", "2001:db8::1"],
    ["NAT64 well-known", "64:ff9b::c0a8:101"],
    ["NAT64 local-use", "64:ff9b:1::c0a8:101"],
    ["6to4 private", "2002:c0a8:101::"],
    ["Teredo", "2001:0000:4136:e378:8000:63bf:3fff:fdd2"],
    ["mapped private", "::ffff:192.168.1.1"],
    ["compatible private", "::192.168.1.1"],
    ["zone id", "fe80::1%en0"]
  ])("rejects non-global or transition address: %s", (_label, address) => {
    expect(isGloballyRoutableAddress(address)).toBe(false);
  });

  it.each(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"])(
    "accepts global unicast address %s",
    (address) => expect(isGloballyRoutableAddress(address)).toBe(true)
  );

  it("rejects a host when any DNS answer is unsafe and never starts transport", async () => {
    const resolver: StudioLinkResolver = vi.fn(async () => ["93.184.216.34", "10.0.0.8"]);
    const fetcher: StudioLinkFetcher = vi.fn();
    await expect(captureStudioLinkSnapshot("https://example.com", {
      resolver,
      fetcher,
      now: () => new Date("2026-07-13T12:00:00.000Z")
    })).rejects.toMatchObject({ code: "STUDIO_LINK_TARGET_FORBIDDEN" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects credentials in the initial URL and every redirect", async () => {
    const resolver: StudioLinkResolver = vi.fn(async () => ["93.184.216.34"]);
    const fetcher: StudioLinkFetcher = vi.fn(async () => ({
      statusCode: 302,
      headers: { location: "https://user:secret@example.net/private" },
      body: Readable.from([])
    }));
    await expect(captureStudioLinkSnapshot("https://user:secret@example.com", {
      resolver, fetcher, now: () => new Date()
    })).rejects.toMatchObject({ code: "STUDIO_LINK_CREDENTIALS_FORBIDDEN" });
    expect(fetcher).not.toHaveBeenCalled();

    await expect(captureStudioLinkSnapshot("https://example.com", {
      resolver, fetcher, now: () => new Date()
    })).rejects.toMatchObject({ code: "STUDIO_LINK_CREDENTIALS_FORBIDDEN" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("caps persisted link text with explicit truncation metadata", async () => {
    const snapshot = await captureStudioLinkSnapshot("https://example.com", {
      resolver: async () => ["93.184.216.34"],
      fetcher: async () => ({
        statusCode: 200,
        headers: { "content-type": "text/plain" },
        body: Readable.from("x".repeat(500_100))
      }),
      now: () => new Date("2026-07-13T12:00:00.000Z")
    });
    expect(snapshot.extractedText).toHaveLength(500_000);
    expect(snapshot.textTruncated).toBe(true);
    expect(snapshot.originalCharacterCount).toBe(500_100);
  });
});
