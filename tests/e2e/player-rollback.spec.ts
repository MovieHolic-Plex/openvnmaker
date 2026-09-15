import { test, expect } from "@playwright/test";

const story = { title: "롤백 조작", subtitle: "", start: "s", characters: [], scenes: [{ id: "s", background: "title", lines: [{ speaker: null, text: "하나" }, { speaker: null, text: "둘" }, { speaker: null, text: "셋" }, { speaker: null, text: "넷" }], next: "t" }, { id: "t", background: "title", lines: [{ speaker: null, text: "다음 씬" }], ending: "끝" }] };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(source => { sessionStorage.setItem("vnmaker.previewScript", JSON.stringify(source)); localStorage.setItem("vnmaker:settings", JSON.stringify({ textSpeed: 5 })); }, story);
  await page.goto("/?preview=1");
});
async function advanceTo(page: import("@playwright/test").Page, index: number) {
  await expect.poll(() => page.evaluate(() => window.__vn?.typing)).toBe(false);
  await page.getByTestId("advance-button").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(index);
}

test("「이전」 버튼·PageUp·휠 위로는 한 줄씩 되돌리고, 휠 아래로는 다음 줄로 간다", async ({ page }) => {
  test.setTimeout(30000);
  await expect(page.getByTestId("back-button")).toBeDisabled();
  await advanceTo(page, 1); await advanceTo(page, 2); await advanceTo(page, 3);
  await page.getByTestId("back-button").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(2);
  await expect(page.getByTestId("dialogue-text")).toHaveText("셋");
  await page.keyboard.press("PageUp");
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(1);
  const stage = await page.getByTestId("stage").boundingBox();
  await page.mouse.move(stage!.x + stage!.width / 2, stage!.y + stage!.height / 3);
  await page.mouse.wheel(0, -160);
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(0);
  await expect(page.getByTestId("back-button")).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.__vn?.typing)).toBe(false);
  await page.mouse.wheel(0, 160);
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(1);
  // 기록 창이 열려 있으면 휠은 진행·되돌리기를 하지 않는다.
  await page.getByTestId("history-button").click();
  await page.mouse.wheel(0, 200);
  expect(await page.evaluate(() => window.__vn?.lineIndex)).toBe(1);
  await page.keyboard.press("Escape");
});

test("게임 중 「타이틀」 버튼은 확인을 거쳐 타이틀로 돌아가고, 이어서 읽기로 그 자리에 돌아온다", async ({ page }) => {
  test.setTimeout(30000);
  await advanceTo(page, 1); await advanceTo(page, 2);
  await page.getByTestId("title-button").click();
  const dialog = page.getByTestId("title-confirm");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("자동 저장");
  await expect(page.getByTestId("title-confirm-cancel")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => window.__vn?.phase)).toBe("scene");
  await page.getByTestId("title-button").click();
  await page.getByTestId("title-confirm-confirm").click();
  await expect(page.getByTestId("title-screen")).toBeVisible();
  await expect(page.getByTestId("continue-button")).toBeEnabled();
  await page.getByTestId("continue-button").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(2);
  await expect(page.getByTestId("dialogue-text")).toHaveText("셋");
  await expect(page.getByTestId("back-button")).toBeEnabled();
});

test("스킵은 읽지 않은 대사 앞에서 멈추고 알려 주며, 읽은 대사는 씬 경계까지만 건너뛴다", async ({ page }) => {
  test.setTimeout(30000);
  await expect.poll(() => page.evaluate(() => window.__vn?.typing)).toBe(false);
  await page.getByTestId("skip-button").click();
  await expect(page.getByRole("status")).toContainText("읽지 않은 대사는 건너뛰지 않습니다");
  expect(await page.evaluate(() => window.__vn?.lineIndex)).toBe(0);
  await advanceTo(page, 1); await advanceTo(page, 2); await advanceTo(page, 3);
  // 처음으로 되돌린 뒤 스킵 — 이제 모두 읽은 대사다.
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("PageUp");
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(0);
  await page.getByTestId("skip-button").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.sceneId)).toBe("t");
  expect(await page.evaluate(() => window.__vn?.lineIndex)).toBe(0);
  expect(await page.evaluate(() => window.__vn?.phase)).toBe("scene");
  // 엔딩 씬에서 스킵은 엔딩을 열지 않는다.
  await page.getByTestId("skip-button").click();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__vn?.phase)).toBe("scene");
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__vn?.typing)).toBe(false);
  // 읽은 기록은 새로고침 뒤에도 남는다.
  await page.getByTestId("skip-button").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.sceneId)).toBe("t");
});

test("Ctrl 을 누르고 있으면 읽은 대사를 빨리 감고, 설정으로 읽지 않은 대사도 허용할 수 있다", async ({ page }) => {
  test.setTimeout(30000);
  await expect.poll(() => page.evaluate(() => window.__vn?.typing)).toBe(false);
  await page.keyboard.down("Control"); await page.waitForTimeout(500); await page.keyboard.up("Control");
  expect(await page.evaluate(() => window.__vn?.lineIndex)).toBe(0);
  await page.getByTestId("settings-button").click();
  await page.getByTestId("skip-unread-toggle").check();
  await page.keyboard.press("Escape");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.down("Control"); await page.waitForTimeout(700); await page.keyboard.up("Control");
  await expect.poll(() => page.evaluate(() => window.__vn?.sceneId)).toBe("t");
  expect(await page.evaluate(() => window.__vn?.phase)).toBe("scene");
  // 스킵도 이제 읽지 않은 대사를 건너뛴다.
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__vn?.typing)).toBe(false);
  await page.getByTestId("skip-button").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.sceneId)).toBe("t");
});
