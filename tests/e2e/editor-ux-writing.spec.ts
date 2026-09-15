import { expect, test, type Page } from "@playwright/test";
import { EDITION } from "../../packages/app/src/storage/edition.js";

const KEY = "vnmaker.studio.project.v1";
const story = {
  title: "집필 흐름", subtitle: "", start: "a", flags: { trust: 0 },
  characters: [{ id: "hero", name: "주인공", color: "#aabbcc", bio: "", expressionImages: {} }],
  scenes: [
    { id: "a", chapter: "A 장면", background: "title", lines: [{ speaker: "hero", text: "첫 문장." }, { speaker: null, text: "둘째 문장." }], choices: [{ text: "왼쪽 문장", next: "b", add: { trust: 1 } }, { text: "오른쪽", next: "c" }] },
    { id: "b", chapter: "B 장면", background: "campus-gate", lines: [{ speaker: null, text: "B 문장." }], ending: "끝 B" },
    { id: "c", chapter: "C 장면", background: "campus-gate", lines: [{ speaker: null, text: "C 문장." }], ending: "끝 C" },
  ],
};
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(({ value, edition, key }) => { localStorage.setItem("vnmaker.edition", edition); if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value)); }, { value: story, edition: EDITION, key: KEY });
});
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
const lineTexts = async (page: Page, sceneId: string) => (await saved(page)).scenes.find((scene: { id: string }) => scene.id === sceneId).lines.map((line: { speaker: string | null; text: string }) => `${line.speaker ?? "-"}:${line.text}`);
async function openLine(page: Page, sceneId: string, index: number) {
  await page.goto("/studio.html");
  await page.getByTestId(`studio-scene-${sceneId}`).click();
  await page.getByTestId(`studio-line-${index}`).click();
  await expect(page.getByTestId("studio-line-text")).toBeVisible();
}

test("adding a line focuses its text, inherits the speaker, and typing right away lands in the new line", async ({ page }) => {
  await openLine(page, "a", 0);
  await page.getByTestId("studio-add-line").click();
  await expect(page.getByTestId("studio-line-text")).toBeFocused();
  await page.keyboard.type("바로 타이핑");
  await expect(page.getByTestId("studio-line-text")).toHaveValue("바로 타이핑");
  await expect(page.getByLabel("화자", { exact: true })).toHaveValue("hero");
  await expect(page.getByTestId("studio-line-list").locator("li")).toHaveCount(3);
  await expect.poll(() => lineTexts(page, "a")).toEqual(["hero:첫 문장.", "hero:바로 타이핑", "-:둘째 문장."]);
  // 텍스트 영역 안의 Ctrl+Z 는 브라우저의 입력 되돌리기이며 앱 실행 취소를 가로채지 않는다.
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("studio-line-text")).not.toHaveValue("바로 타이핑");
  await expect(page.getByTestId("studio-line-list").locator("li")).toHaveCount(3);
  // Ctrl+Enter 는 다음 줄을 만들고 바로 이어서 쓸 수 있게 한다.
  await page.getByTestId("studio-line-text").fill("고친 문장");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByTestId("studio-line-list").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("studio-line-2")).toHaveClass(/is-selected/);
  await expect(page.getByTestId("studio-line-text")).toBeFocused();
  await expect(page.getByTestId("studio-line-text")).toHaveValue("");
});

test("lines move with buttons and Alt+arrows, duplicate without sharing identity, and delete with an undo hint", async ({ page }) => {
  await openLine(page, "a", 1);
  await page.getByRole("button", { name: "선택한 대사 위로 이동" }).click();
  await expect.poll(() => lineTexts(page, "a")).toEqual(["-:둘째 문장.", "hero:첫 문장."]);
  await expect(page.getByTestId("studio-line-0")).toHaveClass(/is-selected/);
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => lineTexts(page, "a")).toEqual(["hero:첫 문장.", "-:둘째 문장."]);
  await expect(page.getByTestId("studio-line-1")).toHaveClass(/is-selected/);
  await page.getByRole("button", { name: "선택한 대사 복제" }).click();
  await expect.poll(() => lineTexts(page, "a")).toEqual(["hero:첫 문장.", "-:둘째 문장.", "-:둘째 문장."]);
  const ids = (await saved(page)).scenes[0].lines.map((line: { id: string }) => line.id);
  expect(new Set(ids).size).toBe(3);
  await page.getByRole("button", { name: "선택한 대사 삭제" }).click();
  await expect(page.getByRole("status")).toContainText("실행 취소");
  await expect.poll(() => lineTexts(page, "a")).toEqual(["hero:첫 문장.", "-:둘째 문장."]);
  await page.getByTestId("studio-undo").click();
  await expect.poll(() => lineTexts(page, "a")).toEqual(["hero:첫 문장.", "-:둘째 문장.", "-:둘째 문장."]);
});

test("multi-line paste splits into dialogue lines with known speaker prefixes, via the textarea and the paste dialog", async ({ page }) => {
  await openLine(page, "a", 0);
  await page.getByTestId("studio-add-line").click();
  await page.getByTestId("studio-line-text").evaluate(node => {
    const data = new DataTransfer(); data.setData("text/plain", "주인공: 붙여넣은 첫 줄\n둘째 줄은 내레이션\n낯선이: 접두를 남긴다");
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => lineTexts(page, "a")).toEqual(["hero:첫 문장.", "hero:붙여넣은 첫 줄", "-:둘째 줄은 내레이션", "-:낯선이: 접두를 남긴다", "-:둘째 문장."]);
  await page.getByTestId("scene-paste").click();
  await page.getByLabel("붙여넣을 원고").fill("hero: 대화 상자로 넣은 줄\n\n마무리 내레이션");
  await page.getByTestId("scene-paste-confirm").click();
  await expect.poll(() => lineTexts(page, "a")).toEqual(["hero:첫 문장.", "hero:붙여넣은 첫 줄", "hero:대화 상자로 넣은 줄", "-:마무리 내레이션", "-:둘째 줄은 내레이션", "-:낯선이: 접두를 남긴다", "-:둘째 문장."]);
});

test("the title can be cleared while typing and falls back to the previous title on blur", async ({ page }) => {
  await page.goto("/studio.html");
  const title = page.getByLabel("작품 제목");
  await title.fill("");
  await expect(title).toHaveValue("");
  await title.blur();
  await expect(title).toHaveValue("집필 흐름");
  await title.fill("");
  await title.pressSequentially("새 제목");
  await expect(title).toHaveValue("새 제목");
  await expect.poll(async () => (await saved(page)).title).toBe("새 제목");
});

test("duplicating a branching scene keeps the original's choices and inserts a full copy after it", async ({ page }) => {
  await openLine(page, "a", 0);
  await page.getByTestId("scene-duplicate").click();
  await expect(page.getByTestId("studio-scene-list").locator("li")).toHaveCount(4);
  await expect.poll(async () => (await saved(page)).scenes.length).toBe(4);
  const manuscript = await saved(page);
  expect(manuscript.scenes[0].id).toBe("a");
  expect(manuscript.scenes[0].choices).toHaveLength(2);
  expect(manuscript.scenes[0].next).toBeUndefined();
  expect(manuscript.scenes[1].chapter).toBe("A 장면 · 복사");
  expect(manuscript.scenes[1].choices.map((choice: { next: string }) => choice.next)).toEqual(["b", "c"]);
  await expect(page.getByTestId("studio-validation")).toHaveText(/검토 1건/);
});

test("preview is blocked only by problems in the current scene or its exits; other errors warn and can be overridden", async ({ page }) => {
  await openLine(page, "c", 0);
  await page.getByTestId("studio-add-line").click();
  await expect(page.getByTestId("studio-line-text")).toHaveValue("");
  await page.getByTestId("studio-scene-b").click();
  await page.getByTestId("studio-play").click();
  await expect(page).toHaveURL(/studio\.html/);
  const popover = page.getByLabel("작품 검증 결과");
  await expect(popover).toContainText("빈 대사");
  await page.getByTestId("studio-play-anyway").click();
  await expect(page).toHaveURL(/preview=1/);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-scene", "b");
  await page.getByTestId("studio-return").click();
  await page.getByTestId("studio-scene-a").click();
  await page.getByTestId("studio-play").click();
  await expect(page).toHaveURL(/studio\.html/);
  await expect(popover).toContainText("바로 이어지는 장면");
  await expect(page.getByTestId("studio-play-anyway")).toHaveCount(0);
});

test("find and replace changes dialogue and choice labels across scenes as a single undo step", async ({ page }) => {
  await openLine(page, "a", 0);
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  await page.getByTestId("palette-replace-toggle").click();
  await page.getByLabel("장면 또는 대사 검색").fill("문장");
  await expect(dialog.getByRole("status")).toContainText("5개");
  await page.getByLabel("바꿀 내용").fill("글");
  await page.getByTestId("palette-replace-all").click();
  await expect(dialog.getByRole("status")).toContainText("5곳");
  await expect.poll(() => lineTexts(page, "a")).toEqual(["hero:첫 글.", "-:둘째 글."]);
  expect((await saved(page)).scenes[0].choices[0].text).toBe("왼쪽 글");
  expect((await saved(page)).scenes[2].lines[0].text).toBe("C 글.");
  await page.keyboard.press("Escape");
  await page.getByTestId("studio-undo").click();
  await expect.poll(() => lineTexts(page, "a")).toEqual(["hero:첫 문장.", "-:둘째 문장."]);
  expect((await saved(page)).scenes[0].choices[0].text).toBe("왼쪽 문장");
  await page.keyboard.press("Control+k");
  await page.getByTestId("palette-replace-toggle").click();
  await page.getByLabel("장면 또는 대사 검색").fill("문장");
  await page.getByLabel("바꿀 내용").fill("줄");
  await dialog.getByRole("button", { name: /B 장면 · 1줄/ }).click();
  await page.getByTestId("palette-replace-one").click();
  await expect.poll(async () => (await saved(page)).scenes[1].lines[0].text).toBe("B 줄.");
  await expect.poll(() => lineTexts(page, "a")).toEqual(["hero:첫 문장.", "-:둘째 문장."]);
});

test("renaming a scene id, a character id and a state variable updates every reference", async ({ page }) => {
  await openLine(page, "a", 0);
  await page.getByTestId("studio-scene-id").fill("opening");
  await page.getByTestId("studio-scene-id").press("Enter");
  await expect(page.getByTestId("studio-scene-opening")).toHaveClass(/is-selected/);
  await expect.poll(async () => (await saved(page)).start).toBe("opening");
  await page.getByTestId("studio-scene-id").fill("b");
  await page.getByTestId("studio-scene-id").press("Enter");
  await expect(page.locator(".inspector-content [role=alert]")).toContainText("사용 중");
  await page.getByTestId("workspace-characters").click();
  await page.getByLabel("hero ID 변경").fill("seoha");
  await page.getByLabel("hero ID 변경").press("Enter");
  await expect(page.getByTestId("character-seoha")).toBeVisible();
  await expect.poll(() => lineTexts(page, "opening")).toEqual(["seoha:첫 문장.", "-:둘째 문장."]);
  await page.getByTestId("workspace-stage").click();
  await page.locator(".state-editor summary").click();
  await page.getByLabel("trust 이름 변경").fill("bond");
  await page.getByLabel("trust 이름 변경").press("Enter");
  await expect.poll(async () => (await saved(page)).flags).toEqual({ bond: 0 });
  expect((await saved(page)).scenes[0].choices[0].add).toEqual({ bond: 1 });
  await expect(page.getByTestId("studio-validation")).toHaveText("스토리 연결 정상");
});
