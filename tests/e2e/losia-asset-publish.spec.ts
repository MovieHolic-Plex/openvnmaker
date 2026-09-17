/**
 * losia 에셋 게시 UI 검증 — 아트/오디오 라이브러리에서 "losia에 올리기"까지.
 *
 * 업로드는 page.route 로 가로채 multipart 계약(meta JSON + roles 순서 + files)을 검증한다.
 * 실서버 종단은 수동 QA에서 확인했다(prod 업로드→PATCH hidden→정리).
 *
 * 잡는 결함:
 * - 게시 버튼이 내 파일(user 원화/생성 이미지)에만 뜨는지 — 내장·스토어 자산에는 안 떠야 한다
 * - 캐릭터 표정 패키지가 base + expression:* roles 순서로 실려 가는지
 * - 음원이 kind:"sound"·role:"audio" 로 실려 가는지
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { VnScript } from "../../packages/content/src/index.js";

const SHOTS = "evidence/losia-asset-publish";
const PNG_A = resolve("packages/app/public/assets/art/seorin-neutral.png");
const PNG_B = resolve("packages/app/public/assets/art/seorin-surprised.png");
const MP3 = resolve("packages/app/public/assets/audio/bgm/daily.mp3");

const fixture: VnScript = {
  title: "에셋 게시 검증",
  subtitle: "losia 에셋 업로드 UI",
  start: "s1",
  characters: [{ id: "mina", name: "미나", color: "#aabbcc", bio: "실험 인물" }],
  scenes: [
    { id: "s1", background: "title", lines: [{ speaker: null, text: "첫 장면." }], ending: "끝" },
  ],
};

interface UploadCapture { meta: Record<string, unknown>; roles: string[]; fileCount: number }

/** multipart 본문에서 meta/roles/files를 꺼낸다. */
function parseMultipart(body: Buffer, boundary: string): UploadCapture {
  const text = body.toString("binary");
  const parts = text.split(`--${boundary}`).filter(part => part.includes("Content-Disposition"));
  let meta: Record<string, unknown> = {};
  let roles: string[] = [];
  let fileCount = 0;
  for (const part of parts) {
    const [head = "", ...rest] = part.split("\r\n\r\n");
    const payload = rest.join("\r\n\r\n").replace(/\r\n$/, "");
    const decoded = Buffer.from(payload, "binary").toString("utf8");
    if (/name="meta"/.test(head)) meta = JSON.parse(decoded) as Record<string, unknown>;
    else if (/name="roles"/.test(head)) roles = JSON.parse(decoded) as string[];
    else if (/name="files"/.test(head)) fileCount += 1;
  }
  return { meta, roles, fileCount };
}

async function stubLosia(page: Page, uploads: UploadCapture[]) {
  await page.route("**/api/losia/status", route => route.fulfill({ json: { configured: true, baseUrl: "https://losia.test" } }));
  await page.route("**/api/losia/assets", async (route: Route) => {
    const request = route.request();
    const boundary = (request.headers()["content-type"] ?? "").match(/boundary=(.+)/)?.[1];
    const body = request.postDataBuffer();
    uploads.push(boundary && body ? parseMultipart(body, boundary) : { meta: {}, roles: [], fileCount: 0 });
    await route.fulfill({ status: 201, json: { id: `qa-asset-${uploads.length}`, ok: true } });
  });
}

async function installProject(page: Page) {
  // 첫 로드 전에 원고를 심는다 — goto→심기→reload 패턴은 dev 서버가 바쁠 때 부팅이 30초를 넘겨 플레이키하다.
  await page.addInitScript(value => { localStorage.setItem("vnmaker.studio.project.v1", JSON.stringify(value)); localStorage.removeItem("vnmaker.studio.position.v1"); }, fixture);
  await page.goto("/studio.html");
  await expect(page.getByLabel("작품 제목")).toHaveValue(fixture.title, { timeout: 60_000 });
}

async function importArt(page: Page, kind: "배경" | "캐릭터", file: string, expression?: string) {
  const library = page.getByTestId("art-library");
  await library.getByLabel("가져올 원화 종류").selectOption(kind === "배경" ? "background" : "character");
  if (kind === "캐릭터") {
    await library.getByLabel("가져올 원화 캐릭터").selectOption("mina");
    if (expression) await library.getByLabel("가져올 원화 표정").fill(expression);
  }
  await library.getByTestId("art-import-files").setInputFiles(file);
}

test.beforeAll(async () => { await mkdir(SHOTS, { recursive: true }); });

test("내 배경 원화를 losia 에셋으로 올린다 — multipart 계약 검증", async ({ page }) => {
  const uploads: UploadCapture[] = [];
  await stubLosia(page, uploads);
  await installProject(page);
  await page.getByTestId("workspace-assets").click();

  await importArt(page, "배경", PNG_A);
  const card = page.getByTestId("art-library").locator(".art-card", { hasText: "seorin-neutral" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();

  await page.getByTestId("losia-asset-open").click();
  const dialog = page.getByTestId("losia-asset-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("losia-asset-name")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("losia-asset-tags").fill("학교, 밤");
  await page.screenshot({ path: `${SHOTS}/01-asset-dialog.png` });
  await page.getByTestId("losia-asset-submit").click();
  await expect(page.getByTestId("losia-asset-success")).toBeVisible({ timeout: 30_000 });

  expect(uploads).toHaveLength(1);
  expect(uploads[0]!.meta["kind"]).toBe("stage");
  expect(uploads[0]!.meta["name"]).toBe("seorin-neutral");
  expect(uploads[0]!.meta["tags"]).toEqual(["학교", "밤"]);
  expect(uploads[0]!.meta["license"]).toBe("downloadable");
  expect(uploads[0]!.roles).toEqual(["base"]);
  expect(uploads[0]!.fileCount).toBe(1);
});

test("캐릭터 표정 패키지는 base + expression:* roles로 올라간다", async ({ page }) => {
  const uploads: UploadCapture[] = [];
  await stubLosia(page, uploads);
  await installProject(page);
  await page.getByTestId("workspace-assets").click();

  await importArt(page, "캐릭터", PNG_A, "neutral");
  await importArt(page, "캐릭터", PNG_B, "smile");
  const card = page.getByTestId("art-library").locator(".art-card", { hasText: "seorin-neutral" }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();

  await page.getByTestId("losia-asset-open").click();
  const dialog = page.getByTestId("losia-asset-dialog");
  await expect(dialog).toBeVisible();
  // 표정 원화 1장을 함께 올리는 체크가 기본 켜져 있어야 한다
  await expect(page.getByTestId("losia-asset-package")).toBeChecked({ timeout: 15_000 });
  await page.getByTestId("losia-asset-submit").click();
  await expect(page.getByTestId("losia-asset-success")).toBeVisible({ timeout: 30_000 });

  expect(uploads).toHaveLength(1);
  expect(uploads[0]!.meta["kind"]).toBe("character");
  expect(uploads[0]!.roles[0]).toBe("base");
  expect(uploads[0]!.roles.slice(1).every(role => role.startsWith("expression:"))).toBe(true);
  expect(uploads[0]!.fileCount).toBe(2);
  await page.screenshot({ path: `${SHOTS}/02-package-success.png` });
});

test("내 음원을 sound 자산으로 올린다", async ({ page }) => {
  const uploads: UploadCapture[] = [];
  await stubLosia(page, uploads);
  await installProject(page);
  await page.getByTestId("workspace-stage").click();
  await page.getByRole("tab", { name: "속성" }).click();
  await page.locator("summary", { hasText: "내 음원 보관함" }).click();

  await page.getByTestId("audio-import-files").setInputFiles(MP3);
  const row = page.locator(".audio-library article", { hasText: "daily" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByTestId("losia-asset-open").click();

  const dialog = page.getByTestId("losia-asset-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("losia-asset-name")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("losia-asset-submit").click();
  await expect(page.getByTestId("losia-asset-success")).toBeVisible({ timeout: 30_000 });

  expect(uploads).toHaveLength(1);
  expect(uploads[0]!.meta["kind"]).toBe("sound");
  expect(uploads[0]!.roles).toEqual(["audio"]);
  expect(uploads[0]!.fileCount).toBe(1);
  await page.screenshot({ path: `${SHOTS}/03-audio-success.png` });
});
