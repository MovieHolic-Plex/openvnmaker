import { expect, test } from "@playwright/test";
import { vnState } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("vnmaker.edition", "rain-blank-2026-09-05-r1"));
  await page.route("**/api/**", route => new URL(route.request().url()).pathname.startsWith("/api/") ? route.abort() : route.continue());
});

test("저장 데이터가 깨져 있어도 타이틀에서 부팅한다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.addInitScript(() => {
    window.localStorage.setItem("vnmaker:save", '{"bogus":');
    window.localStorage.setItem("vnmaker:settings", "not json at all");
  });
  await page.goto("/");

  await expect(page.getByTestId("title-screen")).toBeVisible();
  await expect(page.getByTestId("continue-button")).toBeDisabled();
  expect(errors, `uncaught: ${errors.join(" | ")}`).toHaveLength(0);
});

test("설정 값이 범위를 벗어나 있으면 안전한 값으로 잘린다", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("vnmaker:settings", JSON.stringify({ bgmVolume: 99, sfxVolume: -5, textSpeed: 0 }));
  });
  await page.goto("/");
  await page.getByTestId("start-button").click();
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  const bgm = await page.getByTestId("bgm-volume").inputValue();
  const speed = await page.getByTestId("text-speed").inputValue();
  expect(Number(bgm)).toBeLessThanOrEqual(1);
  expect(Number(speed)).toBeGreaterThanOrEqual(5);
});

test("없는 씬 id 로 복원하면 죽지 않고 오류 문구를 보여준다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "vnmaker:save",
      JSON.stringify({ sceneId: "s99-does-not-exist", lineIndex: 0, affection: 0, savedAt: Date.now() }),
    );
  });
  await page.goto("/");
  await page.getByTestId("continue-button").click();

  await expect(page.locator(".fatal")).toBeVisible();
  const state = await vnState(page);
  expect(state.error).toContain("s99-does-not-exist");
  expect(errors, `uncaught: ${errors.join(" | ")}`).toHaveLength(0);
});
