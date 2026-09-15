import { test, expect } from "@playwright/test";
import { script } from "../../packages/content/src/index.js";

const missingPng = `/assets/user/${"0".repeat(64)}.png`, missingMp3 = `/assets/user/${"0".repeat(64)}.mp3`;

test("없는 미디어는 검은 화면 대신 기본 배경·빈 자리·안내로 물러난다", async ({ page }) => {
  test.setTimeout(30000);
  await page.route("**/assets/user/**", route => route.abort());
  await page.addInitScript(({ png, mp3 }) => {
    sessionStorage.setItem("vnmaker.previewScript", JSON.stringify({ title: "미디어 누락", subtitle: "", start: "s", characters: [{ id: "actor", name: "배우", color: "#ffffff", bio: "" }], scenes: [{ id: "s", background: "title", backgroundUrl: png, bgm: mp3, sprites: [{ slot: "center", character: "actor", poseUrl: png }], lines: [{ speaker: "actor", text: "파일이 없어도 장면은 보여야 한다." }], ending: "끝" }] }));
    localStorage.setItem("vnmaker:settings", JSON.stringify({ textSpeed: 5 }));
  }, { png: missingPng, mp3: missingMp3 });
  await page.goto("/?preview=1");
  const background = page.getByTestId("bg-image");
  await expect(background).toHaveAttribute("data-art-fallback", "true");
  await expect(background).toHaveAttribute("src", /\/assets\/bg\/title\.png$/);
  await expect.poll(() => background.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByTestId("sprite-center")).toHaveAttribute("data-art-error", "true");
  await expect(page.getByTestId("sprite-center")).toBeHidden();
  await page.getByTestId("history-button").click(); await page.keyboard.press("Escape"); // 첫 제스처 → 음악 재생 시도(진행은 하지 않는다)
  await expect(page.getByTestId("media-notice")).toContainText("배경음악");
  expect(await page.evaluate(() => window.__vn?.error)).toBeNull();
});

test("배경도 기본 배경도 없으면 어두운 판을 그리고 오류를 표시한다", async ({ page }) => {
  test.setTimeout(30000);
  await page.route("**/assets/bg/**", route => route.abort());
  await page.route("**/assets/user/**", route => route.abort());
  await page.addInitScript(png => {
    sessionStorage.setItem("vnmaker.previewScript", JSON.stringify({ title: "배경 없음", subtitle: "", start: "s", characters: [], scenes: [{ id: "s", background: "title", backgroundUrl: png, lines: [{ speaker: null, text: "어두운 판이라도 대사는 읽힌다." }], ending: "끝" }] }));
  }, missingPng);
  await page.goto("/?preview=1");
  await expect(page.getByTestId("bg-image")).toHaveAttribute("data-art-error", "true");
  await expect(page.getByTestId("bg-image")).toHaveAttribute("src", /^data:image\/svg\+xml/);
  await expect(page.getByTestId("dialogue-box")).toBeVisible();
});

test("느린 네트워크에서 씬이 바뀌어도 이전 배경이 남고 불러오는 중 표시가 뜬다 · 다음 씬 배경은 미리 받는다", async ({ page }) => {
  test.setTimeout(45000);
  const first = "/assets/art/nocturne-atrium.png", second = "/assets/art/rain-library.png";
  const requested: string[] = [];
  page.on("request", request => { const path = new URL(request.url()).pathname; if (path === second) requested.push(path); });
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${second}`, async route => { await gate; await route.continue(); });
  await page.addInitScript(({ first, second }) => {
    sessionStorage.setItem("vnmaker.previewScript", JSON.stringify({ title: "느린 전환", subtitle: "", start: "one", characters: [], scenes: [
      { id: "one", background: "title", backgroundUrl: first, lines: [{ speaker: null, text: "첫 장면" }], next: "two" },
      { id: "two", background: "title", backgroundUrl: second, lines: [{ speaker: null, text: "두 번째 장면" }], ending: "끝" },
    ] }));
    localStorage.setItem("vnmaker:settings", JSON.stringify({ textSpeed: 5 }));
  }, { first, second });
  await page.goto("/?preview=1");
  await expect(page.getByTestId("bg-image")).toHaveAttribute("src", new RegExp(`${first}$`));
  await expect.poll(() => page.getByTestId("bg-image").evaluate(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true);
  // 첫 장면에 머무는 동안 다음 장면의 배경을 미리 요청한다.
  await expect.poll(() => requested.length, { timeout: 5000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__vn?.typing)).toBe(false);
  await page.getByTestId("advance-button").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.sceneId)).toBe("two");
  // 새 배경이 도착하기 전: 이전 배경이 그대로 보이고, 불러오는 중 표시가 뜬다.
  const previous = page.getByTestId("bg-image-previous");
  await expect(previous).toHaveAttribute("src", new RegExp(`${first}$`));
  expect(await previous.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(previous).toHaveCSS("opacity", "1");
  await expect(page.getByTestId("bg-loading")).toBeVisible();
  await expect(page.getByTestId("bg-image")).toHaveAttribute("src", new RegExp(`${second}$`));
  await expect(page.getByTestId("dialogue-text")).toHaveText("두 번째 장면");
  release!();
  await expect(page.getByTestId("bg-loading")).toHaveCount(0);
  await expect(previous).toHaveCount(0);
  await expect.poll(() => page.getByTestId("bg-image").evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByTestId("bg-image")).toHaveCSS("opacity", "1");
  expect(await page.evaluate(() => window.__vn?.error)).toBeNull();
  expect(script.scenes.length).toBeGreaterThan(0);
});
