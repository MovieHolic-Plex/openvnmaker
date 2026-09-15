import { expect, test } from "@playwright/test";
import { EDITION } from "../../packages/app/src/storage/edition.js";

const KEY = "vnmaker.studio.project.v1";
const base = {
  title: "미디어 검증", subtitle: "", start: "a", flags: {},
  characters: [{ id: "hero", name: "주인공", color: "#aabbcc", bio: "", expressionImages: {} as Record<string, string> }],
  scenes: [
    { id: "a", chapter: "A", background: "title", lines: [{ speaker: "hero", text: "원화 없음." }], next: "b" },
    { id: "b", chapter: "B", background: "title", lines: [{ speaker: null, text: "끝." }], ending: "끝" },
  ],
};

test("dangling user media is reported in the validation list instead of a silent black stage", async ({ page }) => {
  const missing = { ...base, scenes: [{ ...base.scenes[0]!, backgroundUrl: `/assets/user/${"0".repeat(64)}.png` }, base.scenes[1]!], characters: [{ ...base.characters[0]!, expressionImages: { neutral: `/assets/user/${"1".repeat(64)}.png` } }] };
  await page.addInitScript(({ value, edition, key }) => { localStorage.setItem("vnmaker.edition", edition); localStorage.setItem(key, JSON.stringify(value)); }, { value: missing, edition: EDITION, key: KEY });
  await page.goto("/studio.html");
  await expect(page.getByTestId("studio-validation")).toHaveText(/검토 2건/);
  await page.getByTestId("studio-validation").click();
  const popover = page.getByLabel("작품 검증 결과");
  await expect(popover).toContainText("파일을 찾을 수 없습니다");
  await expect(popover).toContainText("A · 장면 배경");
  await expect(popover).toContainText("주인공 · neutral 원화");
  await popover.getByRole("button", { name: /neutral 원화/ }).click();
  await expect(page.getByTestId("workspace-characters")).toHaveClass(/is-active/);
});

test("media that resolves does not raise a warning and warnings clear when the reference is removed", async ({ page }) => {
  const present = { ...base, scenes: [{ ...base.scenes[0]!, backgroundUrl: "/assets/art/rain-library.png" }, base.scenes[1]!] };
  await page.addInitScript(({ value, edition, key }) => { localStorage.setItem("vnmaker.edition", edition); localStorage.setItem(key, JSON.stringify(value)); }, { value: present, edition: EDITION, key: KEY });
  await page.goto("/studio.html");
  await expect(page.getByTestId("studio-validation")).toHaveText("스토리 연결 정상");
  await page.getByTestId("studio-import").setInputFiles({ name: "missing.vn.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...present, scenes: [{ ...present.scenes[0]!, backgroundUrl: `/assets/user/${"2".repeat(64)}.png` }, present.scenes[1]!] })) });
  await expect(page.getByTestId("studio-validation")).toHaveText(/검토 1건/);
  await page.getByTestId("studio-undo").click();
  await expect(page.getByTestId("studio-validation")).toHaveText("스토리 연결 정상");
});

test("the long-form production workspace is mounted behind a drawer in the manuscript view", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  // 글로브 **/api/** 는 /src/api/gateway.ts 모듈까지 잡아 편집기 부팅을 막는다 — 경로 접두로만 가로챈다.
  await page.route(url => url.pathname.startsWith("/api/"), route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: false }) }));
  await page.addInitScript(({ value, edition, key }) => { localStorage.setItem("vnmaker.edition", edition); localStorage.setItem(key, JSON.stringify(value)); }, { value: base, edition: EDITION, key: KEY });
  await page.goto("/studio.html");
  await page.getByTestId("workspace-production").click();
  await expect(page.getByTestId("manuscript-review")).toBeVisible();
  await expect(page.getByTestId("production-panel")).toHaveCount(0);
  await page.getByTestId("production-drawer").locator("summary").click();
  await expect(page.getByTestId("production-panel")).toBeVisible();
  await expect(page.getByTestId("production-brief")).toBeVisible();
  await expect(page.getByTestId("production-current-duration")).not.toHaveText("");
  expect(errors).toEqual([]);
});
