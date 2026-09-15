import { expect, test, type Page } from "@playwright/test";
import { vnState } from "./helpers.js";

/** 게임 시작 후 첫 선택지(s05)까지 클릭으로만 진행한다. */
async function gotoFirstChoice(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("stage")).toBeVisible();
  for (let i = 0; i < 4000; i += 1) {
    const state = await vnState(page);
    if (state.phase === "choice") return;
    if (state.phase === "ending") throw new Error("선택지 전에 엔딩에 도달했다");
    await page.getByTestId("advance-button").click();
  }
  throw new Error("4000번 진행해도 선택지에 도달하지 못했다");
}

test("H를 누르면 대사창이 숨겨지고 다시 누르면 돌아온다", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("dialogue-box")).toBeVisible();

  await page.keyboard.press("h");
  await expect(page.getByTestId("dialogue-box")).toBeHidden();

  await page.keyboard.press("h");
  await expect(page.getByTestId("dialogue-box")).toBeVisible();
});

test("선택지에서 1을 누르면 첫 번째 선택지가 골라진다", async ({ page }) => {
  await gotoFirstChoice(page);
  await expect(page.getByTestId("choice-menu")).toBeVisible();

  await page.keyboard.press("1");
  await expect
    .poll(async () => (await vnState(page)).sceneId, { timeout: 15_000 })
    .toBe("s06a");
});

test("선택지 메뉴는 dimmed scrim 위에 화면 안쪽으로 뜬다", async ({ page }) => {
  await gotoFirstChoice(page);
  const scrim = page.getByTestId("choice-scrim");
  const menu = page.getByTestId("choice-menu");
  await expect(scrim).toBeVisible();
  await expect(menu).toBeVisible();

  // 수채화 플레이어는 메뉴를 오른쪽 아래에 두므로 위치가 아니라 "화면 안에 온전히 보이는지"를 본다.
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const box = await menu.boundingBox();
  expect(box, "choice-menu bounding box가 있어야 한다").not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  const scrimBox = await scrim.boundingBox();
  expect(scrimBox!.width).toBeGreaterThan(viewport.width * 0.8);
});

test("내레이션에는 이름표가 없고 대사창이 시각적으로 구분된다", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-button").click();
  // 샘플 「비가 남긴 빈칸」의 s01 첫 줄은 내레이션(speaker null)이다.
  await expect(page.getByTestId("dialogue-box")).toBeVisible();
  await expect(page.getByTestId("speaker-name")).toHaveCount(0);
  await expect(page.getByTestId("dialogue-box")).toHaveClass(/is-narration/);
  await expect(page.getByTestId("dialogue-text")).toHaveClass(/is-narration/);
});

test("대사 텍스트는 선택 가능하다", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-button").click();
  const text = page.getByTestId("dialogue-text");
  await expect(text).toBeVisible();
  const pointerEvents = await text.evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pointerEvents).not.toBe("none");
  const userSelect = await text.evaluate((el) => getComputedStyle(el).userSelect);
  expect(userSelect).not.toBe("none");
});

test("오토 모드에서는 AUTO 뱃지가 보인다", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-button").click();
  await page.getByTestId("auto-button").click();
  await expect(page.getByTestId("auto-badge")).toBeVisible();
});
