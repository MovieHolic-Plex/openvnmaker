import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { script as novel } from "../../packages/content/src/index.js";

const calls = new WeakMap<Page, string[]>();
async function screenshotReady(page: Page) {
  await expect.poll(() => page.locator("img:visible").evaluateAll(images => images.filter(image => { const rect=image.getBoundingClientRect(); return rect.bottom>0 && rect.top<innerHeight && rect.right>0 && rect.left<innerWidth; }).every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth>0))).toBe(true);
  await expect(page.locator('canvas[data-src]:visible:not([data-loaded="true"])')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

test.beforeEach(async ({ page }) => {
  const script = structuredClone(novel);
  await page.addInitScript(script => { localStorage.setItem("vnmaker.edition", "rain-blank-2026-09-05-r1"); if (!localStorage.getItem("vnmaker.studio.project.v1")) localStorage.setItem("vnmaker.studio.project.v1", JSON.stringify(script)); }, script);
  const requests: string[]=[]; calls.set(page,requests);
  await page.route("**/api/**", route => { if(new URL(route.request().url()).pathname.startsWith("/api/")){requests.push(route.request().url());return route.abort();}return route.continue(); });
  await mkdir("evidence/longform", { recursive: true });
});
test.afterEach(async ({ page }) => { expect(calls.get(page), "현대화된 편집기 UI는 내부 AI 요청을 보내지 않는다").toEqual([]); });

test("modern home separates actual manuscript from90-minute target and keyboard search opens matching line", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/studio.html");
  await page.getByTestId("workspace-overview").click();
  await expect(page.getByTestId("project-overview")).toContainText("현재 원고 · 공백 제외 320자/분");
  await screenshotReady(page);
  await page.screenshot({ path: "evidence/longform/modern-overview-1440.png" });
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("장면 또는 대사 검색").fill(novel.scenes.at(-1)!.lines[2]!.text);
  await expect(page.locator(".command-results button")).toHaveCount(1);
  await screenshotReady(page);
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
  await page.getByTestId("studio-line-4").click();
  const before = (await page.getByTestId("studio-stage").boundingBox())!;
  await page.getByRole("button", { name: "집중 모드", exact: true }).click();
  await expect(page.locator(".studio-inspector")).not.toBeVisible();
  await expect.poll(async () => (await page.getByTestId("studio-stage").boundingBox())!.width).toBeGreaterThan(before.width + 100);
  await screenshotReady(page);
  await page.screenshot({ path: "evidence/longform/modern-editor-focus.png" });
  await page.reload();
  await expect(page.getByTestId("workspace-stage")).toHaveClass(/is-active/);
  await expect(page.getByTestId("studio-line-4")).toHaveClass(/is-selected/);
  await expect(page.locator(".studio-inspector")).not.toBeVisible();
  await page.getByRole("button", { name: "패널 열기", exact: true }).click();
  await expect(page.getByTestId("studio-line-text")).toBeVisible();
  await expect(page.getByTestId("studio-line-text")).toHaveValue(novel.scenes[0]!.lines[4]!.text);
  await screenshotReady(page);
  await page.screenshot({ path: "evidence/longform/modern-editor-1440.png" });
});

for (const [width, height] of [[1280, 800], [768, 1024], [390, 844]]) test(`modern responsive home ${width} has reachable controls without horizontal overflow`, async ({ page }) => {
  await page.setViewportSize({ width: width!, height: height! });
  await page.goto("/studio.html");
  if (width! <= 1000) await page.getByRole("button", { name: "씬 목록 열기", exact: true }).click();
  await page.getByTestId("workspace-overview").click();
  await expect(page.getByRole("button", { name: "원고·분량 검수", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshotReady(page);
  await page.screenshot({ path: `evidence/longform/modern-overview-${width}.png` });
  await page.getByRole("button", { name: "원고·분량 검수", exact: true }).click();
  await expect(page.getByTestId("manuscript-review")).toBeVisible();
  await expect(page.getByTestId("manuscript-review")).toContainText("실제 원고와 이미지");
});
