/**
 * losia.online 스토어 → 편집기 → 플레이어 연결.
 *
 * 스토어 API 는 게이트웨이 프록시라 브라우저 입장에서는 같은 오리진의 /api/store/* 다.
 * 이 스펙은 그 경계를 page.route 로 고정한다(게이트웨이 자체의 규칙은 packages/gateway/test/store.test.ts 가 본다).
 * 실제 losia.online 과의 통합은 tools/qa 가 아니라 수동 QA 로 확인한다 — 테스트는 네트워크에 의존하지 않는다.
 */
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { imageLoaded } from "./helpers.js";

const ASSET_ID = "stb33826d1890f";
const CATALOG = {
  items: [{ id: ASSET_ID, kind: "stage", name: "테스트 부엌 · 낮", tags: ["부엌", "낮"], license: "downloadable", thumb: "/assets/art/nocturne-atrium.png", useCount: 3, uploader: { handle: "losia", display: "Losia" } }],
  total: 1,
};
const MANIFEST = {
  spec: "losia-asset/1",
  id: ASSET_ID,
  kind: "stage",
  name: "테스트 부엌 · 낮",
  tags: ["부엌", "낮"],
  license: "downloadable",
  uploader: { handle: "losia", display: "Losia" },
  provenance: { generator: "codex", model: "gpt-5.6-terra", prompt: "테스트 부엌 배경" },
  files: [{ role: "base", url: `https://losia.online/api/assets/${ASSET_ID}/files/base`, mime: "image/png" }],
};

async function stubStore(page: Page, options: { manifest?: unknown; catalog?: unknown; fileStatus?: number } = {}) {
  await page.route("**/api/store/catalog*", route => route.fulfill({ json: options.catalog ?? CATALOG }));
  await page.route("**/api/store/assets/*/manifest", route => route.fulfill({ json: options.manifest ?? MANIFEST }));
  await page.route("**/api/store/assets/*/files/*", async route => {
    if (options.fileStatus) {
      await route.fulfill({ status: options.fileStatus, json: { error: "embedded 등급은 원본 파일을 배포하지 않습니다. 미리보기만 볼 수 있습니다" } });
      return;
    }
    await route.fulfill({ contentType: "image/png", body: await readFile(resolve("packages/app/public/assets/art/nocturne-atrium.png")) });
  });
}

async function openStore(page: Page) {
  await page.goto("/studio.html");
  await page.getByTestId("workspace-assets").click();
  await expect(page.getByTestId("store-panel")).toBeVisible();
}

test("스토어에서 설치한 무대 자산이 라이브러리에 등록되고 플레이어에서 렌더된다", async ({ page }) => {
  await stubStore(page);
  await openStore(page);

  const item = page.getByTestId(`store-item-${ASSET_ID}`);
  await expect(item).toContainText("테스트 부엌 · 낮");
  await expect(item).toContainText("자유 다운로드");

  await page.getByTestId(`store-install-${ASSET_ID}`).click();
  await expect(page.getByTestId("store-status")).toContainText("설치 완료", { timeout: 60_000 });

  // 1) 프로젝트 라이브러리에 카드가 생기고 실제 이미지가 로드된다(서비스워커가 IndexedDB 에서 서빙).
  const card = page.getByTestId(`art-card-losia-${ASSET_ID}-base`);
  await expect(card).toBeVisible();
  await expect.poll(() => card.locator("img").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // assetUrl() 이 절대 URL 로 풀어 주므로 오리진까지 포함해 검사한다.
  await expect(card.locator("img")).toHaveAttribute("src", /\/assets\/user\/[0-9a-f]{64}\.png$/);

  // 2) 설치 직후 선택돼 있으므로 현재 장면에 바로 적용한다. 문구가 아니라 원고 상태를 확인한다.
  await page.getByTestId("art-apply").click();
  await expect.poll(
    () => page.evaluate(() => (JSON.parse(localStorage.getItem("vnmaker.studio.project.v1") ?? "null")?.scenes?.[0]?.backgroundUrl ?? null)),
    { timeout: 30_000 },
  ).toMatch(/\/assets\/user\/[0-9a-f]{64}\.png$/);

  // 3) 플레이어 미리보기가 로컬에 저장된 그 파일을 렌더한다.
  await page.getByTestId("studio-play").click();
  await page.waitForURL(/preview=1/);
  await expect.poll(() => imageLoaded(page, "bg-image")).toBeGreaterThan(0);
  await expect(page.getByTestId("bg-image")).toHaveAttribute("src", /\/assets\/user\/[0-9a-f]{64}\.png$/);
});

test("embedded 등급은 설치할 수 없고, 게이트웨이가 거부하면 아무것도 등록되지 않는다", async ({ page }) => {
  await stubStore(page, {
    manifest: { ...MANIFEST, license: "embedded", files: [{ role: "base", previewUrl: "https://losia.online/media/preview.webp" }] },
    catalog: { items: [{ ...CATALOG.items[0], license: "embedded" }], total: 1 },
  });
  await openStore(page);

  const install = page.getByTestId(`store-install-${ASSET_ID}`);
  await expect(page.getByTestId(`store-item-${ASSET_ID}`)).toContainText("미리보기만 볼 수 있습니다(설치 불가)");
  await expect(install).toBeDisabled();
  await expect(page.getByTestId(`art-card-losia-${ASSET_ID}-base`)).toHaveCount(0);
});

test("서버가 파일을 거부하면 오류를 보여 주고 카드를 만들지 않는다", async ({ page }) => {
  await stubStore(page, { fileStatus: 403 });
  await openStore(page);

  await page.getByTestId(`store-install-${ASSET_ID}`).click();
  await expect(page.locator(".art-store-error")).toContainText("embedded", { timeout: 60_000 });
  await expect(page.getByTestId(`art-card-losia-${ASSET_ID}-base`)).toHaveCount(0);
});
