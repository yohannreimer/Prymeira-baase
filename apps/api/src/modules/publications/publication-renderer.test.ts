import { afterEach, describe, expect, it, vi } from "vitest";
import { createChromiumPublicationRenderer } from "./publication-renderer";

describe("ChromiumPublicationRenderer", () => {
  const originalExecutable = process.env.BAASE_CHROMIUM_EXECUTABLE_PATH;

  afterEach(() => {
    if (originalExecutable === undefined) delete process.env.BAASE_CHROMIUM_EXECUTABLE_PATH;
    else process.env.BAASE_CHROMIUM_EXECUTABLE_PATH = originalExecutable;
  });

  it("falls back to Chromium CLI when Playwright cannot render in the runtime image", async () => {
    process.env.BAASE_CHROMIUM_EXECUTABLE_PATH = "/usr/bin/chromium-browser";
    const renderWithPlaywright = vi.fn().mockRejectedValue(new Error("browser launch failed"));
    const renderWithChromiumCli = vi.fn().mockResolvedValue(Buffer.from("%PDF-fallback"));
    const renderer = createChromiumPublicationRenderer({
      executableExists: (path) => path === "/usr/bin/chromium-browser",
      renderWithPlaywright,
      renderWithChromiumCli
    });

    await expect(renderer.renderPdf("<h1>Baase</h1>")).resolves.toEqual(Buffer.from("%PDF-fallback"));
    expect(renderWithPlaywright).toHaveBeenCalledWith("/usr/bin/chromium-browser", "<h1>Baase</h1>");
    expect(renderWithChromiumCli).toHaveBeenCalledWith("/usr/bin/chromium-browser", "<h1>Baase</h1>");
  });

  it("ignores an invalid configured path and uses an installed Chromium candidate", async () => {
    process.env.BAASE_CHROMIUM_EXECUTABLE_PATH = "/missing/chromium";
    const renderWithPlaywright = vi.fn().mockResolvedValue(Buffer.from("%PDF-primary"));
    const renderer = createChromiumPublicationRenderer({
      executableExists: (path) => path === "/usr/bin/chromium",
      renderWithPlaywright
    });

    await renderer.renderPdf("<p>Documento</p>");
    expect(renderWithPlaywright).toHaveBeenCalledWith("/usr/bin/chromium", "<p>Documento</p>");
  });
});
