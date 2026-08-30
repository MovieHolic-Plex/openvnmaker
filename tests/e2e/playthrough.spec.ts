import { expect, test } from "@playwright/test";
import { bgmTime, imageLoaded, playToEnding, vnState } from "./helpers.js";

const EVIDENCE = "evidence/e2e-playthrough";

test("타이틀에서 시작해 엔딩까지 끊기지 않고 진행된다", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");
  await expect(page.getByTestId("title-screen")).toBeVisible();
  await expect(page.getByTestId("start-button")).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/01-title.png` });

  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("stage")).toBeVisible();
  await expect(page.getByTestId("dialogue-text")).not.toBeEmpty();

  const bgmStart = await bgmTime(page);
  expect(bgmStart).toBeGreaterThanOrEqual(0);

  const { visited, ending } = await playToEnding(
    page,
    () => 0,
    async (sceneId) => {
      // 씬마다 배경이 실제로 로드됐는지 확인하고 근거 스크린샷을 남긴다.
      await expect(page.getByTestId("bg-image")).toBeVisible();
      await expect
        .poll(async () => imageLoaded(page, "bg-image"), { timeout: 20_000 })
        .toBeGreaterThan(0);
      await page.screenshot({ path: `${EVIDENCE}/scene-${sceneId}.png` });
    },
  );

  expect(visited.length).toBeGreaterThanOrEqual(5);
  expect(["여름의 잔상", "각자의 계절", "미완의 스케치"]).toContain(ending.trim());
  await page.screenshot({ path: `${EVIDENCE}/99-ending.png` });

  await expect
    .poll(async () => bgmTime(page), { timeout: 20_000, message: "BGM currentTime 이 증가해야 한다" })
    .toBeGreaterThan(bgmStart);

  expect(consoleErrors, `콘솔 오류: ${consoleErrors.join(" | ")}`).toHaveLength(0);
});

test("각 막에서 배경과 스프라이트가 함께 합성된다", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-button").click();

  const slots = ["sprite-left", "sprite-center", "sprite-right"];
  const seen = new Set<string>();
  for (let step = 0; step < 4000; step += 1) {
    const state = await vnState(page);
    if (state.phase === "ending") break;
    if (!seen.has(state.sceneId)) {
      seen.add(state.sceneId);
      await expect
        .poll(async () => imageLoaded(page, "bg-image"), { timeout: 20_000 })
        .toBeGreaterThan(0);
      await expect
        .poll(
          async () => {
            let widest = 0;
            for (const slot of slots) {
              const width = await imageLoaded(page, slot);
              if (width > widest) widest = width;
            }
            return widest;
          },
          { timeout: 20_000, message: `${state.sceneId} 에 로드된 스프라이트가 없다` },
        )
        .toBeGreaterThan(0);
    }
    if (state.phase === "choice") {
      await page.getByTestId("choice-0").click();
      continue;
    }
    await page.getByTestId("advance-button").click();
  }
  expect(seen.size).toBeGreaterThanOrEqual(5);
});

test("두 번째 선택지를 고르면 다른 엔딩에 도달한다", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-button").click();
  const first = await playToEnding(page, () => 1);
  expect(first.ending.trim()).not.toBe("여름의 잔상");
  expect(first.visited).toContain("s05-corridor");
});

test("저장하고 불러오면 같은 위치로 돌아온다", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-button").click();
  for (let i = 0; i < 6; i += 1) await page.getByTestId("advance-button").click();
  const before = await vnState(page);
  await page.getByTestId("save-button").click();
  for (let i = 0; i < 4; i += 1) await page.getByTestId("advance-button").click();
  await page.getByTestId("load-button").click();
  const after = await vnState(page);
  expect(after.sceneId).toBe(before.sceneId);
  expect(after.lineIndex).toBe(before.lineIndex);
});
