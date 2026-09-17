/**
 * losia 스토어 자산으로 실제 VN 한 씬을 만들어 재생한다.
 *
 * 검증하는 주장: "스토어에서 배경·인물·음원을 설치해 씬에 배치하고 플레이어까지 간다."
 * 네트워크는 page.route 로 고정한다(store-install.spec.ts 와 같은 이유 — 실서버 통합은 수동 QA).
 *
 * 잡는 결함:
 * - 설치만 되고 씬에 못 쓰는 자산(선택지에 안 뜨는 배경/음원, 캐릭터에 안 붙는 표정)
 * - 오디오 라이브러리의 스토어 패널이 소리만 보여 주는지
 * - 플레이어가 /assets/user/* 배경·스프라이트·BGM을 서비스워커 경로로 렌더하는지
 */
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { imageLoaded } from "./helpers.js";
import type { VnScript } from "../../packages/content/src/index.js";

const STAGE_ID = "st000000000001";
const CHAR_ID = "ch000000000001";
const SOUND_ID = "de000000000001";
const PNG = resolve("packages/app/public/assets/art/nocturne-atrium.png");
const MP3 = resolve("packages/app/public/assets/audio/bgm/daily.mp3");

const ITEMS = {
  stage: { id: STAGE_ID, kind: "stage", name: "테스트 부엌 · 밤", tags: ["부엌"], license: "downloadable", thumb: "", useCount: 1, uploader: { handle: "qa", display: "QA" } },
  character: { id: CHAR_ID, kind: "character", name: "테스트 소녀", tags: [], license: "downloadable", thumb: "", useCount: 1, uploader: { handle: "qa", display: "QA" } },
  sound: { id: SOUND_ID, kind: "sound", name: "테스트 밤BGM", tags: [], license: "downloadable", thumb: "", useCount: 1, uploader: { handle: "qa", display: "QA" } },
};

const MANIFESTS: Record<string, unknown> = {
  [STAGE_ID]: {
    spec: "losia-asset/1", id: STAGE_ID, kind: "stage", name: ITEMS.stage.name, tags: [], license: "downloadable",
    uploader: { handle: "qa", display: "QA" },
    files: [{ role: "base", url: `/api/store/assets/${STAGE_ID}/files/base`, mime: "image/png" }],
  },
  [CHAR_ID]: {
    spec: "losia-asset/1", id: CHAR_ID, kind: "character", name: ITEMS.character.name, tags: [], license: "downloadable",
    uploader: { handle: "qa", display: "QA" },
    files: [
      { role: "base", url: `/api/store/assets/${CHAR_ID}/files/base`, mime: "image/png" },
      { role: "expression:무표정", url: `/api/store/assets/${CHAR_ID}/files/expression:무표정`, mime: "image/png" },
      { role: "expression:미소", url: `/api/store/assets/${CHAR_ID}/files/expression:미소`, mime: "image/png" },
    ],
  },
  [SOUND_ID]: {
    spec: "losia-asset/1", id: SOUND_ID, kind: "sound", name: ITEMS.sound.name, tags: ["bgm"], license: "downloadable",
    uploader: { handle: "qa", display: "QA" },
    files: [{ role: "base", url: `/api/store/assets/${SOUND_ID}/files/base`, mime: "audio/mpeg" }],
  },
};

const fixture: VnScript = {
  title: "스토어 자산 검증",
  subtitle: "losia 자산으로 만든 씬",
  start: "s1",
  characters: [{ id: "mina", name: "미나", color: "#aabbcc", bio: "실험 인물" }],
  scenes: [
    {
      id: "s1",
      background: "title",
      lines: [
        { speaker: null, text: "부엌에 불이 켜져 있었다." },
        { speaker: "mina", text: "아직 안 잤어?" },
      ],
      next: "s2",
    },
    { id: "s2", background: "title", lines: [{ speaker: null, text: "끝." }], ending: "밤의 끝" },
  ],
};

async function stubStore(page: Page) {
  await page.route("**/api/store/catalog*", route => {
    const kind = new URL(route.request().url()).searchParams.get("kind") ?? "";
    const items = Object.values(ITEMS).filter(item => !kind || item.kind === kind);
    return route.fulfill({ json: { items, total: items.length } });
  });
  await page.route("**/api/store/assets/*/manifest", route => {
    const id = decodeURIComponent(route.request().url().match(/assets\/([^/]+)\/manifest/)![1]!);
    const manifest = MANIFESTS[id];
    return manifest ? route.fulfill({ json: manifest }) : route.fulfill({ status: 404, json: { error: "없다" } });
  });
  await page.route("**/api/store/assets/*/files/*", async route => {
    const url = route.request().url();
    const isAudio = url.includes(`assets/${SOUND_ID}/`);
    await route.fulfill({ contentType: isAudio ? "audio/mpeg" : "image/png", body: await readFile(isAudio ? MP3 : PNG) });
  });
}

async function installProject(page: Page) {
  // 첫 로드 전에 원고를 심는다 — goto→심기→reload 패턴은 dev 서버가 바쁠 때 부팅이 30초를 넘겨 플레이키하다.
  await page.addInitScript(value => { localStorage.setItem("vnmaker.studio.project.v1", JSON.stringify(value)); localStorage.removeItem("vnmaker.studio.position.v1"); }, fixture);
  await page.goto("/studio.html");
  await expect(page.getByLabel("작품 제목")).toHaveValue(fixture.title, { timeout: 60_000 });
}

test("스토어 자산 세 종류를 설치해 씬에 배치하고 플레이어에서 재생한다", async ({ page }) => {
  await stubStore(page);
  await installProject(page);

  // 1) 배경: 아트 라이브러리의 스토어 패널에서 설치
  await page.getByTestId("workspace-assets").click();
  const artStore = page.getByTestId("art-library").getByTestId("store-panel");
  await expect(artStore).toBeVisible();
  await artStore.getByTestId("store-source-losia").click();
  await expect(artStore.getByTestId(`store-item-${STAGE_ID}`)).toBeVisible({ timeout: 30_000 });
  await artStore.getByTestId(`store-install-${STAGE_ID}`).click();
  await expect(artStore.getByTestId("store-status")).toContainText("설치 완료", { timeout: 60_000 });

  // 2) 인물: 종류를 인물로 바꾸고 캐릭터에 표정을 연결해 설치
  await artStore.getByTestId("store-kind").selectOption("character");
  await expect(artStore.getByTestId(`store-item-${CHAR_ID}`)).toBeVisible({ timeout: 30_000 });
  await artStore.getByTestId("store-character").selectOption("mina");
  await artStore.getByTestId(`store-install-${CHAR_ID}`).click();
  await expect(artStore.getByTestId("store-status")).toContainText("표정", { timeout: 60_000 });

  // 3) 음원: 장면 편집 뷰의 속성 패널 → 음원 보관함 → 스토어(소리 전용)에서 설치
  await page.getByTestId("workspace-stage").click();
  await page.getByRole("tab", { name: "속성" }).click();
  await page.locator("summary", { hasText: "내 음원 보관함" }).click();
  await page.locator(".audio-library summary", { hasText: "스토어에서 음원 가져오기" }).click();
  const audioStore = page.getByTestId("audio-store-panel");
  await expect(audioStore).toBeVisible();
  // fixedKind=sound 라 종류 선택이 없어야 한다
  await expect(audioStore.getByTestId("store-kind")).toHaveCount(0);
  await audioStore.getByTestId("store-source-losia").click();
  await expect(audioStore.getByTestId(`store-item-${SOUND_ID}`)).toBeVisible({ timeout: 30_000 });
  await audioStore.getByTestId(`store-install-${SOUND_ID}`).click();
  await expect(audioStore.getByTestId("store-status")).toContainText("설치 완료", { timeout: 60_000 });

  // 4) 씬에 배치 — 배경·BGM·배우 전부 설치한 자산으로
  await page.getByLabel("장면 배경", { exact: true }).selectOption({ label: ITEMS.stage.name });
  await page.getByLabel("장면 배경음악").selectOption({ label: ITEMS.sound.name });
  await page.getByLabel("left 배우").selectOption("mina");

  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("vnmaker.studio.project.v1") ?? "null"));
  await expect.poll(async () => (await stored())?.scenes?.[0]?.backgroundUrl ?? null, { timeout: 30_000 }).toMatch(/\/assets\/user\/[0-9a-f]{64}\.png$/);
  await expect.poll(async () => (await stored())?.scenes?.[0]?.bgm ?? null, { timeout: 30_000 }).toMatch(/\/assets\/user\/[0-9a-f]{64}\.mp3$/);
  // 표정 원화가 캐릭터에 연결됐다(smile 은 expression:미소 에서 온다)
  await expect.poll(async () => (await stored())?.characters?.[0]?.expressionImages?.smile ?? null, { timeout: 30_000 }).toMatch(/\/assets\/user\/[0-9a-f]{64}\.png$/);

  // 5) 플레이 — 배경·스프라이트·BGM 이 보관함 파일에서 렌더된다
  await page.getByTestId("studio-play").click();
  await page.waitForURL(/preview=1/);
  await expect.poll(() => imageLoaded(page, "bg-image"), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId("bg-image")).toHaveAttribute("src", /\/assets\/user\/[0-9a-f]{64}\.png$/);
  await expect.poll(() => imageLoaded(page, "sprite-left"), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId("sprite-left")).toHaveAttribute("src", /\/assets\/user\/[0-9a-f]{64}\.png$/);
  // BGM 은 첫 사용자 제스처(잠금 해제) 뒤에만 <audio> 에 src 가 붙는다 — 자동재생 정책.
  await page.getByTestId("advance-button").click();
  await expect(page.getByTestId("bgm-audio")).toHaveAttribute("src", /\/assets\/user\/[0-9a-f]{64}\.mp3$/, { timeout: 30_000 });
});
