import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { script as novel } from "../../packages/content/src/index.js";

test.beforeEach(async ({ page }) => {
  const script = structuredClone(novel);
  await page.addInitScript(script => { localStorage.setItem("vnmaker.edition", "rain-blank-2026-09-05-r1"); localStorage.setItem("vnmaker.studio.project.v1", JSON.stringify(script)); }, script);
  await page.route("**/api/auth/status", route => route.fulfill({ json: { authenticated: true } }));
  await page.route("**/api/generate/config", route => route.fulfill({ json: { model: "qa-fixture-model" } }));
  await page.route("**/api/image/config", route => route.fulfill({ json: { model: "qa-fixture-image-model" } }));
});

test("modern home separates actual manuscript from90-minute target and keyboard search opens matching line", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/studio.html");
  await page.getByTestId("workspace-overview").click();
  await expect(page.getByTestId("project-overview")).toContainText("현재 원고 · 공백 제외 320자/분");
  const images = await page.getByTestId("project-overview").locator("img").evaluateAll(images => images.filter(image => image instanceof HTMLImageElement && !image.complete).length);
  if (images) await page.getByTestId("project-overview").locator(".overview-hero-art").evaluate(image => new Promise<void>(resolve => { if ((image as HTMLImageElement).complete) resolve(); else image.addEventListener("load", () => resolve(), { once: true }); }));
  await mkdir("evidence/longform", { recursive: true });
  await page.screenshot({ path: "evidence/longform/modern-overview-1440.png" });
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("장면 또는 대사 검색").fill(novel.scenes.at(-1)!.lines[2]!.text);
  await expect(page.locator(".command-results button")).toHaveCount(1);
  await page.screenshot({ path: "evidence/longform/modern-command.png" });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByTestId("studio-line-text")).toHaveValue(novel.scenes.at(-1)!.lines[2]!.text);
  await expect(page.getByTestId("studio-line-2")).toHaveClass(/is-selected/);
});

test("modern focus mode gives art more space and returns to editable inspector", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/studio.html");
  await page.getByTestId("workspace-stage").click();
  await expect(page.getByTestId("studio-stage").getByTestId("bg-image")).toHaveAttribute("src", novel.scenes[0]!.backgroundUrl!);
  const before = (await page.getByTestId("studio-stage").boundingBox())!;
  await page.getByRole("button", { name: "집중 모드", exact: true }).click();
  await expect(page.locator(".studio-inspector")).not.toBeVisible();
  await expect.poll(async () => (await page.getByTestId("studio-stage").boundingBox())!.width).toBeGreaterThan(before.width + 100);
  await page.screenshot({ path: "evidence/longform/modern-editor-focus.png" });
  await page.getByRole("button", { name: "연출 편집", exact: true }).click();
  await expect(page.getByTestId("studio-line-text")).toBeVisible();
  await page.screenshot({ path: "evidence/longform/modern-editor-1440.png" });
});

for (const [width, height] of [[1280, 800], [768, 1024], [390, 844]]) test(`modern responsive home ${width} has reachable controls without horizontal overflow`, async ({ page }) => {
  await page.setViewportSize({ width: width!, height: height! });
  await page.goto("/studio.html");
  if (width! <= 1000) await page.getByRole("button", { name: "씬 목록 열기", exact: true }).click();
  await page.getByTestId("workspace-overview").click();
  await expect(page.getByRole("button", { name: "원고·분량 검수", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `evidence/longform/modern-overview-${width}.png` });
  await page.getByRole("button", { name: "원고·분량 검수", exact: true }).click();
  await expect(page.getByTestId("manuscript-review")).toBeVisible();
  await expect(page.getByTestId("manuscript-review")).toContainText("실제 원고와 이미지");
});
