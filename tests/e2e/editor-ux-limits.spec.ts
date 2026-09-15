import { expect, test, type Page } from "@playwright/test";
import { EDITION } from "../../packages/app/src/storage/edition.js";

// 에디터는 파서 상한(대사 20,000자·씬 300개·씬당 2,000줄)을 입력 시점에 막아야 한다. 예전에는 메모리에 들어간 뒤
// 저장만 거부되어, 새로고침하면 샘플 원고가 열리고 그 이후 편집이 전부 사라졌다.
const KEY = "vnmaker.studio.project.v1";
const story = (extra: Record<string, unknown> = {}) => ({
  title: "상한 검증", subtitle: "", start: "a", flags: {}, characters: [{ id: "hero", name: "주인공", color: "#aabbcc", bio: "", expressionImages: {} }],
  scenes: [
    { id: "a", chapter: "A 장면", background: "title", lines: [{ speaker: "hero", text: "첫 문장." }, { speaker: null, text: "둘째 문장." }], next: "b" },
    { id: "b", chapter: "B 장면", background: "campus-gate", lines: [{ speaker: null, text: "끝 문장." }], ending: "끝" },
  ],
  ...extra,
});
async function seed(page: Page, value: unknown) {
  await page.addInitScript(({ value, edition, key }) => { localStorage.setItem("vnmaker.edition", edition); if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value)); }, { value, edition: EDITION, key: KEY });
}
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
/** maxlength 는 타이핑·붙여넣기를 자르지만 프로그램으로 넣은 값은 막지 못한다 — 편집 문이 두 번째 방어선이다. */
async function inject(page: Page, selector: string, value: string) {
  await page.locator(selector).evaluate((node, text) => {
    const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, text);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
async function openLine(page: Page, sceneId: string, index: number) {
  await page.getByTestId(`studio-scene-${sceneId}`).click();
  await page.getByTestId(`studio-line-${index}`).click();
  await expect(page.getByTestId("studio-line-text")).toBeVisible();
}

test("a dialogue longer than the parser limit is refused with a reason and the manuscript reloads intact", async ({ page }) => {
  await seed(page, story()); await page.goto("/studio.html"); await openLine(page, "a", 0);
  await expect(page.getByTestId("studio-line-text")).toHaveAttribute("maxlength", "20000");
  await page.getByTestId("studio-line-text").fill("정상 저장 확인.");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.getByTestId("studio-line-text").fill("가".repeat(20_001));
  expect((await page.getByTestId("studio-line-text").inputValue()).length).toBe(20_000);
  await expect(page.getByTestId("studio-line-capacity")).toContainText("0자 남음");
  await page.getByTestId("studio-line-text").fill("정상 저장 확인.");
  await inject(page, '[data-testid="studio-line-text"]', "가".repeat(20_001));
  await expect(page.getByRole("status")).toContainText("적용하지 않았습니다");
  await expect(page.getByTestId("studio-line-text")).toHaveValue("정상 저장 확인.");
  await openLine(page, "a", 1);
  await page.getByTestId("studio-line-text").fill("긴 붙여넣기 이후에 쓴 문장은 살아남는다.");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.reload();
  await expect(page.getByLabel("작품 제목")).toHaveValue("상한 검증");
  await expect(page.locator(".project-recovery")).toHaveCount(0);
  const manuscript = await saved(page);
  expect(manuscript.scenes[0].lines.map((line: { text: string }) => line.text)).toEqual(["정상 저장 확인.", "긴 붙여넣기 이후에 쓴 문장은 살아남는다."]);
});

test("scene names, choice labels and the title are capped at input time and refused beyond the parser limit", async ({ page }) => {
  await seed(page, story()); await page.goto("/studio.html"); await openLine(page, "a", 0);
  const chapter = page.getByLabel("씬 이름", { exact: true });
  await expect(chapter).toHaveAttribute("maxlength", /\d+/);
  await chapter.fill("장".repeat(20_001));
  const capped = await chapter.inputValue();
  expect(capped.length).toBeLessThanOrEqual(200);
  await inject(page, 'input[aria-label="씬 이름"]', "장".repeat(20_001));
  await expect(page.getByRole("status")).toContainText("적용하지 않았습니다");
  await expect(chapter).toHaveValue(capped);
  await expect(page.getByLabel("작품 제목")).toHaveAttribute("maxlength", /\d+/);
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.reload();
  expect((await saved(page)).scenes[0].chapter).toBe(capped);
});

test("the 301st scene is refused with a visible notice, the capacity is shown and 300 scenes survive a reload", async ({ page }) => {
  const scenes = Array.from({ length: 300 }, (_, index) => ({ id: `s${index}`, chapter: `장면 ${index}`, background: "title", lines: [{ speaker: null, text: `문장 ${index}` }], ...(index === 299 ? { ending: "끝" } : { next: `s${index + 1}` }) }));
  await seed(page, { title: "삼백", subtitle: "", start: "s0", flags: {}, characters: [], scenes });
  await page.goto("/studio.html");
  await expect(page.getByTestId("studio-scene-count")).toHaveText("300/300");
  await page.getByTestId("studio-scene-s299").click();
  await page.getByTestId("studio-add-scene").click();
  await expect(page.getByRole("status")).toContainText("최대 300개");
  await expect(page.getByTestId("studio-scene-list").locator("li")).toHaveCount(300);
  await page.getByTestId("scene-duplicate").click();
  await expect(page.getByTestId("studio-scene-list").locator("li")).toHaveCount(300);
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.reload();
  await expect(page.getByLabel("작품 제목")).toHaveValue("삼백");
  await expect(page.getByTestId("studio-scene-list").locator("li")).toHaveCount(300);
  await expect(page.locator(".project-recovery")).toHaveCount(0);
});

test("the 2,001st line of a scene is refused and the line capacity is shown near the limit", async ({ page }) => {
  const lines = Array.from({ length: 2000 }, (_, index) => ({ speaker: null, text: `줄 ${index}` }));
  await seed(page, story({ scenes: [{ id: "a", chapter: "긴 장면", background: "title", lines, ending: "끝" }] }));
  await page.goto("/studio.html");
  await page.getByTestId("studio-scene-a").click();
  await expect(page.getByTestId("studio-line-count")).toHaveText("2000/2000");
  await page.getByTestId("studio-add-line").click();
  await expect(page.getByRole("status")).toContainText("2,000줄");
  expect((await saved(page)).scenes[0].lines).toHaveLength(2000);
});
