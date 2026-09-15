import { test, expect } from "@playwright/test";

// 원고 대사 상한(20,000자) 바로 아래.
const longText = "아주 긴 대사가 화면을 넘지 않고 상자 안에서 스크롤되어야 한다. ".repeat(540);

test("동작 줄이기 설정에서는 타이프라이터·전환·흔들림이 즉시 완료된다", async ({ page }) => {
  test.setTimeout(30000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    sessionStorage.setItem("vnmaker.previewScript", JSON.stringify({ title: "동작 줄이기", subtitle: "", start: "s", characters: [], scenes: [{ id: "s", background: "title", lines: [{ speaker: null, text: "이 문장은 한 글자씩 나타나지 않고 한 번에 보인다. ".repeat(6), shake: true }], next: "t" }, { id: "t", background: "title", backgroundUrl: "/assets/art/rain-library.png", transition: "dissolve", lines: [{ speaker: null, text: "전환도 즉시" }], ending: "끝" }] }));
    localStorage.setItem("vnmaker:settings", JSON.stringify({ textSpeed: 90 }));
  });
  await page.goto("/?preview=1");
  await expect.poll(() => page.evaluate(() => window.__vn?.reducedMotion)).toBe(true);
  expect(await page.evaluate(() => window.__vn?.typing)).toBe(false);
  await expect(page.getByTestId("dialogue-text")).toContainText("한 번에 보인다");
  await expect(page.locator(".stage.is-shaking")).toHaveCSS("animation-name", "none");
  await page.getByTestId("advance-button").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.sceneId)).toBe("t");
  await expect(page.locator(".scene-content")).toHaveCSS("animation-name", "none");
  await expect(page.getByTestId("bg-image")).toHaveAttribute("src", /\/assets\/art\/rain-library\.png$/);
  await expect.poll(() => page.getByTestId("bg-image").evaluate(node => getComputedStyle(node).animationName)).toBe("none");
  await expect(page.getByTestId("bg-image")).toHaveCSS("opacity", "1");
});

test("대사는 스크린리더 실시간 영역으로 한 번에 읽히고, 선택지 등장도 알린다", async ({ page }) => {
  test.setTimeout(30000);
  await page.addInitScript(() => {
    sessionStorage.setItem("vnmaker.previewScript", JSON.stringify({ title: "접근성", subtitle: "", start: "s", characters: [{ id: "actor", name: "이서하", color: "#ffffff", bio: "" }], scenes: [{ id: "s", background: "title", lines: [{ speaker: "actor", text: "천천히 타이핑되는 동안에도 전체 문장이 실시간 영역에 있다. ".repeat(4) }], choices: [{ text: "네", next: "s" }, { text: "아니오", next: "s" }] }] }));
    localStorage.setItem("vnmaker:settings", JSON.stringify({ textSpeed: 90 }));
  });
  await page.goto("/?preview=1");
  expect(await page.evaluate(() => window.__vn?.typing)).toBe(true);
  const live = page.getByTestId("dialogue-live");
  await expect(live).toHaveAttribute("aria-live", "polite");
  await expect(live).toContainText("이서하: 천천히 타이핑되는 동안에도");
  expect((await live.textContent())!.length).toBeGreaterThan((await page.getByTestId("dialogue-text").textContent())!.length);
  await expect(page.getByTestId("dialogue-text")).toHaveAttribute("aria-hidden", "true");
  await page.getByTestId("advance-button").click(); await page.getByTestId("advance-button").click();
  await expect(page.getByTestId("choice-menu")).toBeVisible();
  await expect(page.locator(".choice-scrim [aria-live=polite]")).toContainText("선택지 2개");
});

test("2만 자 대사도 화면을 넘지 않고 상자 안에서 스크롤되며 12초 안에 다 쓰인다", async ({ page }) => {
  test.setTimeout(45000);
  await page.addInitScript(text => {
    sessionStorage.setItem("vnmaker.previewScript", JSON.stringify({ title: "긴 대사", subtitle: "", start: "s", characters: [], scenes: [{ id: "s", background: "title", lines: [{ speaker: null, text }, { speaker: null, text: "짧은 줄" }], ending: "끝" }] }));
    localStorage.setItem("vnmaker:settings", JSON.stringify({ textSpeed: 28 }));
  }, longText);
  await page.goto("/?preview=1");
  expect(longText.length).toBeGreaterThanOrEqual(19_000);
  const started = Date.now();
  // 타이프라이터 상한 12초 + 로드·부하 여유. 예전 규칙(28ms/자)이면 9분이 걸린다.
  await expect.poll(() => page.evaluate(() => window.__vn?.typing), { timeout: 25_000 }).toBe(false);
  expect(Date.now() - started).toBeLessThan(20_000);
  const dialogue = page.getByTestId("dialogue-text");
  const box = await dialogue.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.height).toBeLessThan(viewport.height * 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  expect(await dialogue.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await expect(dialogue).toHaveClass(/is-overflowing/);
  await expect(page.getByTestId("settings-button")).toBeInViewport();
  // 넘치는 본문을 눌러도 진행된다.
  await dialogue.click({ position: { x: 20, y: 20 } });
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(1);
  await expect(dialogue).not.toHaveClass(/is-overflowing/);
});

test("대사·제목 폰트는 로드한 한글 웹폰트를 쓰고 플랫폼 기본 한글 글꼴로 물러난다", async ({ page }) => {
  test.setTimeout(30000);
  await page.addInitScript(() => sessionStorage.setItem("vnmaker.previewScript", JSON.stringify({ title: "폰트", subtitle: "", start: "s", characters: [], scenes: [{ id: "s", background: "title", lines: [{ speaker: null, text: "글꼴" }], ending: "끝" }] })));
  await page.goto("/?preview=1");
  const family = await page.getByTestId("dialogue-text").evaluate(node => getComputedStyle(node).fontFamily);
  expect(family).toMatch(/^"?IBM Plex Sans KR"?/);
  expect(family).toContain("Apple SD Gothic Neo");
  expect(family).toContain("Noto Sans KR");
  expect(family).not.toMatch(/^"?Segoe UI/);
  const toolbar = await page.getByTestId("skip-button").evaluate(node => getComputedStyle(node).fontFamily);
  expect(toolbar).toMatch(/^"?IBM Plex Sans KR"?/);
});
