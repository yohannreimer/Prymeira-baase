import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import type { PublicationRenderer } from "./publication.types";

type RenderPdf = (executablePath: string, html: string) => Promise<Buffer>;

export const publicationPdfOptions = {
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: '<div style="box-sizing:border-box;color:#858b83;font-family:Arial,sans-serif;font-size:10px;padding:0 17mm;text-align:right;width:100%"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
} as const;

export function createChromiumPublicationRenderer(options: {
  executableExists?: (path: string) => boolean;
  renderWithPlaywright?: RenderPdf;
  renderWithChromiumCli?: RenderPdf;
} = {}): PublicationRenderer {
  const executableExists = options.executableExists ?? existsSync;
  const renderWithPlaywright = options.renderWithPlaywright ?? renderUsingPlaywright;
  const renderWithChromiumCli = options.renderWithChromiumCli ?? renderUsingChromiumCli;
  return {
    async renderPdf(html) {
      const configured = process.env.BAASE_CHROMIUM_EXECUTABLE_PATH;
      const executablePath = [configured, "/usr/bin/chromium-browser", "/usr/bin/chromium"]
        .find((candidate): candidate is string => Boolean(candidate && executableExists(candidate)));
      if (!executablePath) throw new Error("PUBLICATION_CHROMIUM_NOT_FOUND");
      try {
        return await renderWithPlaywright(executablePath, html);
      } catch (playwrightError) {
        try {
          return await renderWithChromiumCli(executablePath, html);
        } catch (cliError) {
          throw new AggregateError([playwrightError, cliError], "PUBLICATION_CHROMIUM_RENDER_FAILED");
        }
      }
    }
  };
}

async function renderUsingPlaywright(executablePath: string, html: string) {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    timeout: 30_000,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  try {
    const context = await browser.newContext({ locale: "pt-BR" });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return Buffer.from(await page.pdf(publicationPdfOptions));
  } finally {
    await browser.close();
  }
}

async function renderUsingChromiumCli(executablePath: string, html: string) {
  const directory = await mkdtemp(join(tmpdir(), "baase-publication-"));
  const htmlPath = join(directory, "publication.html");
  const pdfPath = join(directory, "publication.pdf");
  try {
    await writeFile(htmlPath, html, "utf8");
    await executeChromium(executablePath, [
      "--headless",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-pdf-header-footer",
      `--user-data-dir=${join(directory, "profile")}`,
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href
    ]);
    const pdf = await readFile(pdfPath);
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("PUBLICATION_PDF_INVALID");
    return pdf;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function executeChromium(executablePath: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    execFile(executablePath, args, { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
