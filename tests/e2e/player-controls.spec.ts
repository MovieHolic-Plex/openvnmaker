import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("vnmaker.previewScript", JSON.stringify({ title: "조작 설정", subtitle: "", start: "s", characters: [], scenes: [{ id: "s", background: "title", bgm: "daily", lines: [{ speaker: null, text: "설정을 검증한다." }, { speaker: null, text: "둘째 줄" }], ending: "끝" }] }));
    if (!localStorage.getItem("vnmaker:settings")) localStorage.setItem("vnmaker:settings", JSON.stringify({ textSpeed: 5 }));
  });
  await page.goto("/?preview=1");
});

test("오토 속도·음소거·읽지 않은 대사 스킵 설정은 저장되고 새로고침 뒤에도 유지된다", async ({ page }) => {
  test.setTimeout(30000);
  await page.getByTestId("settings-button").click();
  await page.getByTestId("auto-speed").fill("10");
  await page.getByTestId("mute-toggle").check();
  await page.getByTestId("skip-unread-toggle").check();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mute-button")).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByTestId("mute-button")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("auto-speed")).toHaveValue("10");
  await expect(page.getByTestId("mute-toggle")).toBeChecked();
  await expect(page.getByTestId("skip-unread-toggle")).toBeChecked();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("vnmaker:settings")!));
  expect(saved).toMatchObject({ autoSpeed: 10, muted: true, skipUnread: true });
  await page.keyboard.press("Escape");
});

test("음소거 버튼은 음량 값을 지우지 않고 소리만 끄며, 다시 누르면 원래 음량으로 돌아온다", async ({ page }) => {
  test.setTimeout(30000);
  await page.getByTestId("advance-button").click(); // 첫 제스처 → 음악 시작
  const music = page.getByTestId("bgm-audio");
  await expect.poll(() => music.evaluate((audio: HTMLAudioElement) => audio.volume)).toBeGreaterThan(0.3);
  await page.getByTestId("mute-button").click();
  await expect(page.getByTestId("mute-button")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => music.evaluate((audio: HTMLAudioElement) => audio.volume)).toBe(0);
  expect(await music.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("bgm-volume")).toHaveValue("0.55");
  await page.keyboard.press("Escape");
  await page.getByTestId("mute-button").click();
  await expect.poll(() => music.evaluate((audio: HTMLAudioElement) => audio.volume)).toBe(0.55);
});

test("전체화면 버튼은 지원 환경에서 노출되고 상태를 표시한다", async ({ page }) => {
  test.setTimeout(30000);
  const supported = await page.evaluate(() => document.fullscreenEnabled);
  await expect(page.getByTestId("fullscreen-button")).toHaveCount(supported ? 1 : 0);
  if (!supported) return;
  await expect(page.getByTestId("fullscreen-button")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("fullscreen-button")).toHaveText("전체화면");
});

test("오토는 설정된 속도로 진행하고 대기 시간은 20초를 넘지 않는다", async ({ page }) => {
  test.setTimeout(30000);
  await page.getByTestId("settings-button").click();
  await page.getByTestId("auto-speed").fill("10");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__vn?.typing)).toBe(false);
  const started = Date.now();
  await page.getByTestId("auto-button").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex), { timeout: 5000 }).toBe(1);
  // 10자 × 10ms + 700ms 기본 대기 ≈ 0.8초. 예전 고정값(45ms/자)이면 1.15초.
  expect(Date.now() - started).toBeLessThan(2500);
  await page.getByTestId("auto-button").click();
});

test("모바일 폭에서도 툴바 버튼이 모두 화면 안에 있고 가로 스크롤이 생기지 않는다", async ({ page }) => {
  test.setTimeout(30000);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const id of ["back-button", "save-button", "skip-button", "settings-button", "mute-button", "title-button"]) await expect(page.getByTestId(id)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const toolbar = (await page.locator(".toolbar").boundingBox())!;
  const artView = (await page.getByTestId("art-view-button").boundingBox())!;
  await expect(page.getByTestId("art-view-button")).toBeInViewport();
  const overlap = artView.y < toolbar.y + toolbar.height && artView.y + artView.height > toolbar.y && artView.x < toolbar.x + toolbar.width && artView.x + artView.width > toolbar.x;
  expect(overlap, "원화 감상 버튼이 툴바와 겹치지 않는다").toBe(false);
  const dialogue = (await page.getByTestId("dialogue-box").boundingBox())!;
  expect(artView.y + artView.height).toBeLessThanOrEqual(dialogue.y + 1);
});
