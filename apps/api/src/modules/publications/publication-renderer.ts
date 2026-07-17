import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import type { PublicationRenderer } from "./publication.types";

export function createChromiumPublicationRenderer(): PublicationRenderer {
  return {
    async renderPdf(html) {
      const configured = process.env.BAASE_CHROMIUM_EXECUTABLE_PATH;
      const executablePath = configured || ["/usr/bin/chromium-browser", "/usr/bin/chromium"]
        .find((candidate) => existsSync(candidate));
      const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
      try {
        const context = await browser.newContext({ locale: "pt-BR" });
        await context.route("**/*", (route) => route.abort());
        const page = await context.newPage();
        await page.setContent(html, { waitUntil: "domcontentloaded" });
        return Buffer.from(await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true }));
      } finally {
        await browser.close();
      }
    }
  };
}
