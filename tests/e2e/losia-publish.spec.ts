/**
 * losia 게시 UI + 그래프 미리보기 시각·기능 검증.
 *
 * 잡는 결함:
 * - 게시 버튼/다이얼로그가 상단 바 레이아웃을 깨면 안 된다.
 * - 토큰 없이는 올리기 버튼이 비활성이어야 하고, 잘못된 토큰은 오류로 보여야 한다.
 * - 그래프 미리보기는 게이트웨이 컴파일 → previewScript 경로로 플레이어를 연다.
 *
 * 그래프 노드는 게이트웨이 프로젝트 저장소에 쓴다 — playwright.config 가
 * VNMAKER_PROJECT_DIR 을 임시 디렉터리로 지정해 실제 프로젝트와 격리한다.
 * (이미 떠 있는 dev 서버를 reuse 하는 경우 그 서버의 저장소를 쓴다.)
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { VnScript } from "../../packages/content/src/index.js";

const SHOTS = "evidence/losia-publish";

const fixture: VnScript = {
  title: "게시 검증 초안",
  subtitle: "losia 게시 UI 검증용",
  start: "s1",
  characters: [{ id: "me", name: "나", color: "#aabbcc", bio: "1인칭 화자" }],
  scenes: [
    { id: "s1", background: "title", lines: [{ speaker: null, text: "첫 장면." }], ending: "끝" },
  ],
};

async function installProject(page: Page) {
  // 첫 로드 전에 원고를 심는다 — goto→심기→reload 패턴은 dev 서버가 바쁠 때 부팅이 30초를 넘겨 플레이키하다.
  await page.addInitScript(value => { localStorage.setItem("vnmaker.studio.project.v1", JSON.stringify(value)); localStorage.removeItem("vnmaker.studio.position.v1"); }, fixture);
  await page.goto("/studio.html");
  await expect(page.getByLabel("작품 제목")).toHaveValue(fixture.title, { timeout: 60_000 });
}

/** 게이트웨이 그래프에 노드 두 개를 심는다 — 그래프 미리보기가 컴파일할 대상. */
async function seedGraph(page: Page) {
  const headers = { "content-type": "application/json", "x-vnmaker-studio": "1" };
  for (const node of [
    { id: "qa-a", label: "시작", beats: [{ op: "say", speaker: null, text: "그래프 첫 장면이다." }] },
    { id: "qa-b", label: "다음", beats: [{ op: "say", speaker: null, text: "엣지를 따라온 두 번째 장면." }, { op: "ending", title: "끝" }] },
  ]) {
    const res = await page.request.post("/api/project/nodes", { headers, data: node });
    expect(res.ok(), `노드 저장 실패: ${await res.text()}`).toBe(true);
  }
  const edge = await page.request.put("/api/project/edges", { headers, data: { edges: [{ from: "qa-a", to: "qa-b" }] } });
  expect(edge.ok(), `엣지 저장 실패: ${await edge.text()}`).toBe(true);
}

test.beforeAll(async () => { await mkdir(SHOTS, { recursive: true }); });

test("게시 버튼과 다이얼로그 — 토큰 없이는 올릴 수 없다", async ({ page }) => {
  await installProject(page);
  await page.screenshot({ path: `${SHOTS}/01-studio-top.png`, fullPage: false });

  await page.getByTestId("studio-publish-losia").click();
  const dialog = page.getByTestId("losia-publish-dialog");
  await expect(dialog).toBeVisible();

  const status = await page.request.get("/api/losia/status", { headers: { "x-vnmaker-studio": "1" } });
  const configured = status.ok() && (await status.json() as { configured: boolean }).configured;
  if (!configured) {
    // 토큰 미등록: 입력란이 보이고 올리기는 비활성
    await expect(page.getByTestId("losia-token-input")).toBeVisible();
    await expect(page.getByTestId("losia-publish-submit")).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/02-publish-no-token.png` });

    // 형식이 잘못된 토큰은 게이트웨이가 업스트림 없이 거절한다 → 오류 표시
    await page.getByTestId("losia-token-input").fill("not-a-token");
    await page.getByTestId("losia-token-save").click();
    await expect(page.getByTestId("losia-publish-error")).toBeVisible();
    await expect(page.getByTestId("losia-publish-error")).toContainText("토큰");
    await page.screenshot({ path: `${SHOTS}/03-publish-bad-token.png` });

    // 형식은 맞지만 폐기된/없는 토큰 — 실제 losia(또는 오프라인이면 연결 오류)가 거절한다
    await page.getByTestId("losia-token-input").fill(`la_${"0".repeat(40)}`);
    await page.getByTestId("losia-token-save").click();
    await expect(page.getByTestId("losia-publish-error")).toBeVisible({ timeout: 25_000 });
    await page.screenshot({ path: `${SHOTS}/04-publish-rejected-token.png` });
  } else {
    // 이 머신에 이미 토큰이 있다: 등록 상태와 입력 폼이 보인다
    await expect(page.getByTestId("losia-publish-title-input")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/02-publish-configured.png` });
  }
});

test("그래프 미리보기 — 컴파일된 그래프가 플레이어에서 열린다", async ({ page }) => {
  await installProject(page);
  await seedGraph(page);

  const script = await page.request.get("/api/project/script", { headers: { "x-vnmaker-studio": "1" } });
  expect(script.ok(), `컴파일 실패: ${await script.text()}`).toBe(true);
  const compiled = await script.json() as { script: { scenes: { id: string }[] } };
  expect(compiled.script.scenes.map(s => s.id)).toEqual(["qa-a", "qa-b"]);

  await page.getByTestId("studio-graph-play").click();
  await page.waitForURL(/preview=1/);
  await expect(page.locator("body")).toContainText("그래프 첫 장면이다", { timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/05-graph-preview.png` });
});

test("좁은 화면에서 상단 바가 넘치지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 600 });
  await installProject(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await page.screenshot({ path: `${SHOTS}/06-narrow-top.png` });
  expect(overflow, "360~1280 폭 규약 — 가로 넘침이 없어야 한다").toBe(false);
});
