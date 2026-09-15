import { test, expect } from "@playwright/test";
import { vnState } from "./helpers.js";

/** 저장 데이터가 원고와 어긋났을 때의 복원 — 2026-09-14 적대적 리뷰 회귀. */
const gated = { title: "복원 검증", subtitle: "", start: "a", flags: { score: 0 }, characters: [], scenes: [
  { id: "a", background: "title", lines: [{ speaker: null, text: "첫 줄" }, { speaker: null, text: "둘째 줄" }], choices: [{ text: "비밀 통로", next: "b", when: { all: ["secret"] } }, { text: "잠긴 문", next: "b", disable: true }, { text: "점수 올리기", next: "b", add: { score: 1 } }] },
  { id: "b", background: "title", lines: [{ speaker: null, text: "도착" }], ending: "끝" },
] };

test("choice 저장본을 고를 선택지가 없는 원고로 불러오면 소프트락 대신 복구 화면이 뜬다", async ({ page }) => {
  test.setTimeout(30000);
  // 「점수 올리기」는 score 가 문자열이면 증감 오류로 닫히고, 나머지는 조건·잠금으로 닫힌다 → 고를 수 있는 선택지 0개.
  await page.addInitScript(source => {
    sessionStorage.setItem("vnmaker.previewScript", JSON.stringify(source));
    localStorage.setItem("vnmaker:slots:preview", JSON.stringify([{ sceneId: "a", lineIndex: 1, affection: 0, savedAt: Date.now(), phase: "choice", flags: { score: "abc" }, preview: "둘째 줄", chapter: null, thumbnail: null }]));
    localStorage.setItem("vnmaker:settings", JSON.stringify({ textSpeed: 5 }));
  }, { ...gated, flags: {} });
  await page.goto("/?preview=1");
  await page.getByTestId("load-button").click();
  await page.getByTestId("slot-load-0").click();
  await expect(page.getByTestId("fatal")).toContainText("선택할 수 있는 선택지가 없습니다");
  await expect(page.getByTestId("choice-menu")).toHaveCount(0);
  await page.getByTestId("fatal-title").click();
  await expect(page.getByTestId("title-screen")).toBeVisible();
});

test("타입이 어긋난 선택 기억은 원고 초기값으로 되돌려 선택지 버튼이 죽지 않는다", async ({ page }) => {
  test.setTimeout(30000);
  await page.addInitScript(source => {
    sessionStorage.setItem("vnmaker.previewScript", JSON.stringify(source));
    localStorage.setItem("vnmaker:slots:preview", JSON.stringify([{ sceneId: "a", lineIndex: 1, affection: 0, savedAt: Date.now(), phase: "choice", flags: { score: "abc", secret: true }, script: source, preview: "둘째 줄", chapter: null, thumbnail: null }]));
    localStorage.setItem("vnmaker:settings", JSON.stringify({ textSpeed: 5 }));
  }, gated);
  await page.goto("/?preview=1");
  await page.getByTestId("load-button").click();
  await page.getByTestId("slot-load-0").click();
  await expect(page.getByTestId("choice-menu")).toBeVisible();
  expect((await vnState(page)).flags).toEqual({ score: 0, secret: true });
  await expect(page.getByTestId("choice-2")).toBeEnabled();
  await expect(page.getByTestId("choice-1")).toBeDisabled();
  await expect(page.getByTestId("choice-1")).toHaveAttribute("title", /선택할 수 없는/);
  await page.getByTestId("choice-2").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.sceneId)).toBe("b");
  expect((await vnState(page)).flags).toEqual({ score: 1, secret: true });
});

test("퀵 세이브(F5)·퀵 로드(F9) 뒤에도 롤백 기록이 살아 있어 「이전」이 동작한다", async ({ page }) => {
  test.setTimeout(30000);
  await page.addInitScript(() => {
    sessionStorage.setItem("vnmaker.previewScript", JSON.stringify({ title: "롤백 저장", subtitle: "", start: "s", characters: [], scenes: [{ id: "s", background: "title", lines: [{ speaker: null, text: "하나" }, { speaker: null, text: "둘" }, { speaker: null, text: "셋" }, { speaker: null, text: "넷" }], ending: "끝" }] }));
    localStorage.setItem("vnmaker:settings", JSON.stringify({ textSpeed: 5 }));
  });
  await page.goto("/?preview=1");
  for (const index of [1, 2]) { await expect.poll(() => page.evaluate(() => window.__vn?.typing)).toBe(false); await page.getByTestId("advance-button").click(); await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(index); }
  await page.keyboard.press("F5");
  await expect(page.getByRole("status")).toContainText("퀵 세이브");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("vnmaker:quick:preview")!).rollback.length)).toBe(2);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(0);
  await page.keyboard.press("F9");
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(2);
  expect((await page.evaluate(() => window.__vn!)).pastLength).toBe(2);
  await expect(page.getByTestId("back-button")).toBeEnabled();
  await page.getByTestId("back-button").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(1);
  await expect(page.getByTestId("dialogue-text")).toHaveText("둘");
  await page.getByTestId("load-button").click();
  await expect(page.getByTestId("slot-row-quick")).toContainText("퀵 세이브");
  await page.keyboard.press("Escape");
});

test("자동 저장 스냅숏은 원고를 내장하지 않고 보관함 지문을 가리키며, 이전 형식의 저장도 계속 읽힌다", async ({ page }) => {
  test.setTimeout(30000);
  await page.addInitScript(source => {
    sessionStorage.setItem("vnmaker.previewScript", JSON.stringify(source));
    localStorage.setItem("vnmaker:settings", JSON.stringify({ textSpeed: 5 }));
    localStorage.setItem("vnmaker:slots:preview", JSON.stringify([null, { sceneId: "a", lineIndex: 1, affection: 0, savedAt: 1, script: source, preview: "이전 형식", chapter: null, thumbnail: null }]));
  }, gated);
  await page.goto("/?preview=1");
  await expect.poll(() => page.evaluate(() => window.__vn?.typing)).toBe(false);
  await page.getByTestId("advance-button").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(1);
  const auto = await page.evaluate(() => localStorage.getItem("vnmaker:auto:preview")!);
  expect(auto).not.toContain('"title":"복원 검증"');
  expect(JSON.parse(auto).scriptKey).toMatch(/^[a-z0-9]+$/);
  expect(auto.length).toBeLessThan(1200);
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("vnmaker:manuscripts:preview")!)).length)).toBe(1);
  await page.getByTestId("load-button").click();
  await expect(page.getByTestId("slot-row-1")).toContainText("이전 형식");
  await page.getByTestId("slot-load-1").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(1);
});

test("저장 공간이 꽉 차면 자동 저장 실패를 한 번만 알리고, 진행은 계속되며 공간이 생기면 다시 저장한다", async ({ page }) => {
  test.setTimeout(45000);
  await page.addInitScript(() => {
    sessionStorage.setItem("vnmaker.previewScript", JSON.stringify({ title: "저장 공간 부족", subtitle: "", start: "s", characters: [], scenes: [{ id: "s", background: "title", lines: [{ speaker: null, text: "하나" }, { speaker: null, text: "둘" }, { speaker: null, text: "셋" }, { speaker: null, text: "넷" }, { speaker: null, text: "다섯" }], ending: "끝" }] }));
    localStorage.setItem("vnmaker:settings", JSON.stringify({ textSpeed: 5 }));
    if (!localStorage.getItem("junk-0")) {
      // 한도까지 채운다 — 첫 실패 뒤에는 남은 공간을 512자 단위로 더 채워 사실상 0 으로 만든다.
      const chunk = "x".repeat(256 * 1024);
      for (let i = 0; i < 64; i += 1) { try { localStorage.setItem(`junk-${i}`, chunk); } catch { break; } }
      const small = "y".repeat(512);
      for (let i = 0; i < 4096; i += 1) { try { localStorage.setItem(`fill-${i}`, small); } catch { break; } }
    }
  });
  await page.goto("/?preview=1");
  await expect.poll(() => page.evaluate(() => window.__vn?.typing)).toBe(false);
  await page.getByTestId("advance-button").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(1);
  const notice = page.getByRole("status");
  await expect(notice).toContainText("자동 저장하지 못했습니다");
  await expect(notice).toHaveCount(0, { timeout: 6000 });
  // 같은 실패가 반복돼도 매 진행마다 다시 띄우지 않는다.
  await page.getByTestId("advance-button").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(2);
  await page.getByTestId("advance-button").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(3);
  await page.waitForTimeout(600);
  await expect(notice).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("vnmaker:auto:preview"))).toBeNull();
  // 공간이 생기면 다음 진행에서 자동 저장이 살아난다.
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith("junk-") || key.startsWith("fill-")) localStorage.removeItem(key); });
  await page.getByTestId("advance-button").click();
  await expect.poll(() => page.evaluate(() => window.__vn?.lineIndex)).toBe(4);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("vnmaker:auto:preview") ?? "null")?.lineIndex)).toBe(4);
});
