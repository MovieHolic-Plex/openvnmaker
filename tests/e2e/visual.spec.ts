import { expect, test } from "@playwright/test";
import { imageLoaded, vnState } from "./helpers.js";

const SIZES = [
  { name: "desktop-1280x720", width: 1280, height: 720 },
  { name: "mobile-390x844", width: 390, height: 844 },
] as const;

for (const size of SIZES) {
  test(`${size.name}: 타이틀·대사·선택지·엔딩 화면을 캡처한다`, async ({ page }) => {
    const dir = `evidence/visual-qa/${size.name}`;
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/");

    await expect(page.getByTestId("title-screen")).toBeVisible();
    await expect.poll(async () => imageLoaded(page, "bg-image"), { timeout: 20_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: `${dir}/01-title.png` });

    await page.getByTestId("start-button").click();
    await expect(page.getByTestId("dialogue-box")).toBeVisible();
    // 스프라이트가 붙은 씬까지 진행해 합성 상태를 캡처한다.
    for (let i = 0; i < 40; i += 1) {
      if ((await imageLoaded(page, "sprite-center")) > 0) break;
      await page.getByTestId("advance-button").click();
    }
    await expect(page.getByTestId("dialogue-text")).not.toBeEmpty();
    await page.screenshot({ path: `${dir}/02-dialogue.png` });

    // 첫 선택지까지 진행한다.
    for (let i = 0; i < 400; i += 1) {
      const state = await vnState(page);
      if (state.phase === "choice") break;
      await page.getByTestId("advance-button").click();
    }
    await expect(page.getByTestId("choice-menu")).toBeVisible();
    await page.screenshot({ path: `${dir}/03-choices.png` });

    await page.getByTestId("history-button").click();
    await expect(page.getByTestId("history-panel")).toBeVisible();
    await page.screenshot({ path: `${dir}/04-history.png` });
    await page.keyboard.press("Escape");

    await page.getByTestId("choice-0").click();
    for (let i = 0; i < 4000; i += 1) {
      const state = await vnState(page);
      if (state.phase === "ending") break;
      if (state.phase === "choice") {
        await page.getByTestId("choice-0").click();
        continue;
      }
      await page.getByTestId("advance-button").click();
    }
    await expect(page.getByTestId("ending-screen")).toBeVisible();
    await page.screenshot({ path: `${dir}/05-ending.png` });
  });
}
