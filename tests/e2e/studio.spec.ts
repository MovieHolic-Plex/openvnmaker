import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { script as novel, type VnScript } from "../../packages/content/src/index.js";

const key = "vnmaker.studio.project.v1";
const requests = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.addInitScript(({ key, novel }) => {
    localStorage.setItem("vnmaker.edition", "rain-blank-2026-09-05-r1");
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(novel));
  }, { key, novel });
  const calls: string[] = []; requests.set(page, calls);
  await page.route("**/api/**", async route => {
    if (!new URL(route.request().url()).pathname.startsWith("/api/")) { await route.continue(); return; }
    calls.push(route.request().url()); await route.abort();
  });
});
test.afterEach(async ({ page }) => { expect(requests.get(page), "수동 편집과 플레이는 내부 AI 요청을 보내지 않는다").toEqual([]); });
async function open(page: Page, sceneId = novel.start) {
  await page.goto("/studio.html");
  await page.getByTestId(`studio-scene-${sceneId}`).click();
  await expect(page.getByTestId("studio-line-text")).toBeVisible();
}
async function project(page: Page): Promise<VnScript> { return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key); }
async function importJson(page: Page, value: unknown) { await page.getByTestId("studio-import").setInputFiles({ name: "manual.vn.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) }); }

test("수동 대사 수정은 새로고침과 선택 위치 플레이·복귀 후에도 유지된다", async ({ page }) => {
  const sceneId = "s02";
  const text = "손을 뻗기 전에 네가 건넨 말을 끝까지 듣기로 했다. 창밖에서는 비가 잠시 잦아들고 있었다.";
  await open(page, sceneId);
  await page.getByTestId("studio-line-4").click();
  await page.getByTestId("studio-line-text").fill(text);
  await expect(page.getByTestId("dialogue-text")).toHaveText(text);
  await page.reload();
  await page.getByTestId("workspace-stage").click();
  await page.getByTestId("studio-line-4").click();
  await expect(page.getByTestId("studio-line-text")).toHaveValue(text);
  await page.getByTestId("studio-play").click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-scene", sceneId);
  await expect(page.getByTestId("dialogue-text")).toHaveText(text);
  await page.reload();
  await expect(page.getByTestId("dialogue-text")).toHaveText(text);
  await page.getByTestId("studio-return").click();
  await page.getByTestId("workspace-stage").click();
  await page.getByTestId("studio-line-4").click();
  await expect(page.getByTestId("studio-line-text")).toHaveValue(text);
});

test("분기 앞에 새 씬을 넣어도 기존 선택지를 보존하며 실행 취소와 다시 실행이 된다", async ({ page }) => {
  await open(page, "s05");
  const original = await project(page);
  const before = original.scenes.find(scene => scene.id === "s05")!;
  await page.getByTestId("studio-add-scene").click();
  const inserted = await project(page);
  const origin = inserted.scenes.find(scene => scene.id === "s05")!;
  const next = inserted.scenes.find(scene => scene.id === origin.next)!;
  expect(inserted.scenes).toHaveLength(original.scenes.length + 1);
  expect(origin.choices).toBeUndefined(); expect(next.choices).toEqual(before.choices);
  await expect(page.getByTestId("studio-validation")).toHaveText("스토리 연결 정상");
  await page.getByTestId("studio-undo").click();
  expect(await project(page)).toEqual(original);
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  expect(await project(page)).toEqual(inserted);
});

test("빈 대사를 검증해 플레이를 막고 수정하면 정상 연결로 돌아온다", async ({ page }) => {
  await open(page);
  await page.getByTestId("studio-add-line").click();
  await expect(page.getByTestId("studio-line-text")).toHaveValue("");
  await page.getByTestId("studio-play").click();
  await expect(page.getByLabel("작품 검증 결과")).toContainText("빈 대사");
  await expect(page).toHaveURL(/studio\.html/);
  await page.getByRole("button", { name: "검증 결과 닫기" }).click();
  await page.getByTestId("studio-line-text").fill("종이의 마지막 빈칸 위에 손끝을 얹었다. 지금은 무엇을 채울지 서두르지 않기로 했다.");
  await expect(page.getByTestId("studio-validation")).toHaveText("스토리 연결 정상");
});

test("작품 JSON 내보내기와 가져오기는 전체 원고·아트·표정을 보존한다", async ({ page }) => {
  await open(page);
  const before = await project(page);
  const downloading = page.waitForEvent("download");
  await page.getByTestId("studio-export").click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`${before.title}.vn.json`);
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(exported).toEqual(before);
  await page.getByLabel("작품 제목", { exact: true }).fill("수동 편집 백업 검수");
  await importJson(page, exported);
  await expect(page.getByRole("status")).toContainText("작품을 가져왔습니다");
  expect(await project(page)).toEqual(before);
  expect((await project(page)).assets).toEqual(novel.assets);
  await page.getByTestId("studio-undo").click();
  expect((await project(page)).title).toBe("수동 편집 백업 검수");
});

test("손상 JSON과 존재하지 않는 화자를 가져와도 현재 작품을 덮어쓰지 않는다", async ({ page }) => {
  await open(page);
  const original = await project(page);
  await page.getByTestId("studio-import").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{broken") });
  await expect(page.getByRole("status")).toContainText("가져오기 실패");
  expect(await project(page)).toEqual(original);
  await importJson(page, { ...original, scenes: [{ ...original.scenes[0], lines: [{ speaker: "unregistered", text: "잘못된 화자" }] }, ...original.scenes.slice(1)] });
  await expect(page.getByRole("status")).toContainText("가져오기 실패");
  expect(await project(page)).toEqual(original);
});

test("로컬 저장 실패를 성공으로 표시하지 않고 JSON 백업은 사용할 수 있다", async ({ page }) => {
  await open(page);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) { if (name === key) throw new DOMException("QA quota", "QuotaExceededError"); return original.call(this, name, value); };
  }, key);
  await page.getByLabel("작품 제목", { exact: true }).fill("저장 실패를 검증하는 제목");
  await expect(page.getByRole("alert")).toContainText("저장 공간");
  await expect(page.getByTestId("studio-save-state")).toHaveText("저장 확인 필요");
  const downloading = page.waitForEvent("download");
  await page.getByTestId("studio-export").click();
  const data = JSON.parse(await readFile((await (await downloading).path())!, "utf8"));
  expect(data.title).toBe("저장 실패를 검증하는 제목");
});

test("편집 미리보기 저장은 편집 원고를 담고 일반 플레이 저장과 분리된다", async ({ page }) => {
  await open(page, "s02");
  const normalSave = { sceneId: novel.start, lineIndex: 2, affection: 0, savedAt: Date.now(), script: novel };
  await page.evaluate(save => localStorage.setItem("vnmaker:save", JSON.stringify(save)), normalSave);
  await page.getByTestId("studio-line-3").click();
  const text = "다음 대답을 미리 준비하지 않았다. 네가 아직 말을 끝내지 않았다는 것을 이번에는 기억하고 있었다.";
  await page.getByTestId("studio-line-text").fill(text);
  await page.getByTestId("studio-play").click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-scene", "s02");
  await page.getByTestId("save-button").click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("vnmaker:save:preview")!));
  expect(saved.sceneId).toBe("s02"); expect(saved.lineIndex).toBe(3);
  expect(saved.script.scenes.find((scene: { id: string }) => scene.id === "s02").lines[3].text).toBe(text);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("vnmaker:save")!))).toEqual(normalSave);
  await page.getByTestId("advance-button").click();
  await page.getByTestId("load-button").click();
  await expect(page.getByTestId("dialogue-text")).toHaveText(text);
});

test("선택지 문구와 연결을 수동 수정하면 스토리 맵과 저장 원고가 함께 바뀐다", async ({ page }) => {
  await open(page, "s05");
  const label = "서린에게 지금 들을 수 있는 이야기부터 묻는다";
  await page.getByLabel("선택지 1 문구", { exact: true }).fill(label);
  await page.getByLabel("선택지 1 연결", { exact: true }).selectOption("s06b");
  const edited = await project(page);
  expect(edited.scenes.find(scene => scene.id === "s05")?.choices?.[0]).toMatchObject({ text: label, next: "s06b" });
  await page.getByTestId("workspace-graph").click();
  await expect(page.locator(".graph-node")).toHaveCount(novel.scenes.length);
  await page.getByTestId("graph-node-s06b").click();
  await expect(page.getByTestId("studio-line-text")).toHaveValue(novel.scenes.find(scene => scene.id === "s06b")!.lines[0]!.text);
});
