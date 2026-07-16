import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const reviewDirectory = "/tmp/baase-task27-visual-review";
const targetViewports = [
  { width: 1440, height: 1000, mode: "sidecar" },
  { width: 1024, height: 900, mode: "sheet" },
  { width: 768, height: 900, mode: "sheet" },
  { width: 390, height: 844, mode: "sheet" }
] as const;

test.beforeAll(() => mkdirSync(reviewDirectory, { recursive: true }));

test.describe("Owner Studio responsive acceptance", () => {
  for (const viewport of targetViewports) {
    test(`${viewport.width}px keeps navigation, focus and the AI surface usable without page overflow`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/#estudio");

      const studio = page.getByRole("region", { name: "Estúdio" });
      const navigation = studio.getByRole("navigation", { name: "Seções do Estúdio" });
      const home = navigation.getByRole("button", { name: "Início", exact: true });
      const privacy = navigation.getByRole("button", { name: "Privacidade", exact: true });
      await expect(studio.getByRole("heading", { level: 1, name: "Estúdio" })).toBeVisible();
      await expect(navigation.getByRole("button")).toHaveCount(11);
      await expect(home).toHaveAttribute("aria-current", "page");
      await expectNoPageOverflow(page);
      if (viewport.width <= 768) await expectMinimumTouchTarget(home);
      if (viewport.width === 390) {
        const navWidth = await navigation.evaluate((element) => ({
          client: element.clientWidth,
          scroll: element.scrollWidth
        }));
        expect(navWidth.scroll).toBeGreaterThan(navWidth.client);
      }

      await home.focus();
      await page.keyboard.press("End");
      await expect(privacy).toBeFocused();
      await privacy.click();
      await expect(page.getByRole("heading", { name: "Privacidade do Estúdio" })).toBeVisible();
      await home.click();
      await expect(page.getByRole("heading", { name: "Um espaço para pensar com clareza." })).toBeVisible();

      const thought = `Revisão responsiva ${viewport.width} ${Date.now()}`;
      await page.getByRole("textbox", { name: "Registre um pensamento" }).fill(thought);
      await page.getByRole("button", { name: "Guardar", exact: true }).click();
      const editor = page.getByRole("textbox", { name: "Conteúdo do documento" });
      await expect(editor).toContainText(thought);
      const editorBox = await editor.boundingBox();
      expect(editorBox, "the writing surface must have a rendered box").not.toBeNull();
      expect(editorBox!.width).toBeGreaterThanOrEqual(300);

      await page.screenshot({
        path: `${reviewDirectory}/studio-${viewport.width}.png`,
        fullPage: true
      });

      if (viewport.mode === "sheet") {
        const sheet = page.getByRole("dialog", { name: "Copiloto do Estúdio" });
        const composer = sheet.getByLabel("O que você quer entender melhor?");
        await expect(sheet).toBeVisible();
        await expect(composer).toBeFocused();
        await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
        await expectMinimumTouchTarget(sheet.getByRole("button", { name: "Recolher copiloto" }));
        await page.keyboard.press("Escape");
        const reopen = page.getByRole("button", { name: "Abrir Copiloto" });
        await expect(reopen).toBeFocused();
        await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
        await expectNoPageOverflow(page);
      } else {
        const sidecar = page.getByRole("complementary", { name: "Copiloto do Estúdio" });
        await expect(sidecar).toBeVisible();
        await expect(sidecar.getByRole("separator", { name: "Redimensionar copiloto" })).toBeVisible();
        await sidecar.getByRole("button", { name: "Recolher copiloto" }).click();
        const reopen = page.getByRole("button", { name: "Abrir Copiloto" });
        await expect(reopen).toBeFocused();
        await reopen.click();
        await expect(page.getByRole("complementary", { name: "Copiloto do Estúdio" })).toBeVisible();
      }
    });
  }
});

async function expectNoPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }))).toEqual(expect.objectContaining({
    clientWidth: page.viewportSize()?.width,
    scrollWidth: page.viewportSize()?.width
  }));
}

async function expectMinimumTouchTarget(locator: ReturnType<Page["getByRole"]>) {
  const box = await locator.boundingBox();
  expect(box, "touch target must have a rendered box").not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}
