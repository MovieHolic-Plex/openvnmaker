#!/usr/bin/env node
/**
 * losia.online 스토어 ↔ 편집기/플레이어 실통합 검사.
 *
 * 스텁이 아니라 실제 losia.online 을 게이트웨이 프록시로 통과시켜서
 *  1) 카탈로그가 실데이터로 뜨는지
 *  2) 무대 자산을 설치해 로컬 보관함(/assets/user/…)에 들어가는지
 *  3) 설치한 이미지가 플레이어에서 실제로 렌더되는지
 * 를 브라우저로 확인하고 스크린샷을 남긴다. 자산을 지우거나 올리지 않는다(읽기+다운로드만).
 *
 *   node tools/qa/store-live.mjs
 *   VNMAKER_LOSIA_URL=http://127.0.0.1:3001 node tools/qa/store-live.mjs
 *
 * 증거는 evidence/store-live/ 로.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "evidence", "store-live");
const PORT = Number(process.env.VNMAKER_STORE_QA_PORT ?? 5199);
const BASE = `http://127.0.0.1:${PORT}`;
const LOSIA = process.env.VNMAKER_LOSIA_URL ?? "https://losia.online";

mkdirSync(OUT, { recursive: true });
const steps = [];
const record = (name, detail) => { steps.push({ name, ...detail }); console.log(`· ${name}: ${JSON.stringify(detail)}`); };

async function waitFor(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return true;
    } catch { /* 아직 안 떴다 */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function openStudio(page, label = "studio") {
  // 공유 박스에서는 네트워크가 순간적으로 끊긴다(ERR_NETWORK_CHANGED) — 초기 진입만 재시도한다.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(`${BASE}/studio.html`);
      await page.getByTestId("workspace-assets").waitFor({ state: "visible", timeout: 60_000 });
      await page.getByTestId("workspace-assets").click();
      await page.getByTestId("store-panel").waitFor({ timeout: 60_000 });
      return;
    } catch (error) {
      console.warn(`· ${label} 진입 재시도 ${attempt}/3 — ${error instanceof Error ? error.message.split("\n")[0] : error}`);
      if (attempt === 3) throw error;
    }
  }
}

const server = spawn("pnpm", ["--filter", "@vnmaker/app", "dev", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  cwd: ROOT,
  env: { ...process.env, VNMAKER_LOSIA_URL: LOSIA },
  stdio: "inherit",
  detached: true,
});
let browser;
let failed = false;
const consoleErrors = [];
try {
  if (!(await waitFor(`${BASE}/api/health`))) throw new Error("게이트웨이(/api/health)가 뜨지 않았다");

  // 프록시 자체를 먼저 본다 — 브라우저 문제인지 스토어 문제인지 가른다.
  const catalogResponse = await fetch(`${BASE}/api/store/catalog?kind=stage&take=5&sort=new`);
  const catalog = await catalogResponse.json();
  record("catalog", { status: catalogResponse.status, total: catalog.total, first: catalog.items?.[0]?.name });
  if (!catalogResponse.ok || !catalog.items?.length) throw new Error("프록시 카탈로그가 비었다");

  try {
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  } catch (error) {
    console.warn(`번들 크로미움 실행 실패(${error.message}) → 시스템 크롬으로 대체`);
    browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  // 콜드 vite 컴파일은 수십 초가 걸린다 — 라이브 QA 는 기본 30초로는 부족하다.
  page.setDefaultTimeout(90_000);
  page.setDefaultNavigationTimeout(90_000);
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await openStudio(page);
  await page.getByLabel("스토어 종류").selectOption("stage");
  const first = page.locator('[data-testid^="store-item-"]').first();
  await first.waitFor({ timeout: 60_000 });
  // 썸네일은 losia.online 에서 lazy 로 온다 — 다 로드된 뒤에 찍어야 스크린샷이 거짓말하지 않는다.
  const thumbs = await page.waitForFunction(() => {
    const images = [...document.querySelectorAll(".art-store-item img")];
    if (!images.length) return null;
    const loaded = images.filter(image => image.complete && image.naturalWidth > 0).length;
    return loaded === images.length ? { total: images.length, loaded } : null;
  }, null, { timeout: 45_000 }).then(handle => handle.jsonValue()).catch(() => null);
  const rows = await page.locator('[data-testid^="store-item-"]').count();
  record("catalog-ui", { rows, thumbnails: thumbs, first: (await first.locator("strong").first().innerText()).trim() });
  await page.screenshot({ path: join(OUT, "1-catalog.png") });

  const testId = await first.getAttribute("data-testid");
  const assetId = testId.replace("store-item-", "");

  // 모바일 폭(390px)에서도 패널이 깨지지 않는지 본다. 아트 화면을 이미 열어 둔 상태에서 뷰포트만 바꾼다.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500); // 레이아웃 리플로우
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const panelBox = await page.getByTestId("store-panel").boundingBox();
  record("mobile", { width: 390, horizontalOverflowPx: overflow, panelWidth: panelBox ? Math.round(panelBox.width) : null });
  await page.screenshot({ path: join(OUT, "1b-catalog-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  if (overflow > 2) throw new Error(`모바일 폭에서 가로 스크롤이 생긴다: ${overflow}px`);

  await page.getByTestId(`store-install-${assetId}`).click();
  await page.getByTestId("store-status").waitFor({ timeout: 120_000 });
  const status = (await page.getByTestId("store-status").innerText()).trim();
  record("install", { assetId, status });
  if (!status.includes("설치 완료")) throw new Error(`설치가 끝나지 않았다: ${status}`);

  const cardId = (await page.locator('[data-testid^="art-card-losia-"]').first().getAttribute("data-testid")).replace("art-card-", "");
  await page.getByTestId(`art-card-${cardId}`).waitFor();
  const localUrl = await page.getByTestId(`art-card-${cardId}`).locator("img").getAttribute("src");
  const naturalWidth = await page.getByTestId(`art-card-${cardId}`).locator("img").evaluate(image => image.naturalWidth);
  record("library-card", { cardId, localUrl, naturalWidth });
  if (!/\/assets\/user\/[0-9a-f]{64}\.(png|jpg|webp)$/.test(localUrl ?? "") || naturalWidth <= 0) throw new Error("설치한 이미지가 로컬 보관함에서 읽히지 않는다");
  await page.screenshot({ path: join(OUT, "2-installed.png") });

  await page.getByTestId("art-apply").click();
  // 자동저장은 디바운스된다 — 원고가 디스크에 안착하기 전에 페이지를 뜨면 안 된다.
  await page.waitForFunction(() => document.querySelector('[data-testid="studio-save-state"]')?.textContent?.includes("로컬 저장됨"), null, { timeout: 30_000 });

  // 프로젝트에 등록된 URL 이 플레이어/번들이 쓰는 그 URL 인지 — 스튜디오 페이지에서 읽는다.
  const registered = await page.evaluate(() => {
    const raw = localStorage.getItem("vnmaker.studio.project.v1");
    if (!raw) return null;
    const project = JSON.parse(raw);
    return {
      urls: (project.assets ?? []).filter(asset => String(asset.id).startsWith("losia-")).map(asset => asset.url),
      scene: project.scenes?.[0]?.backgroundUrl ?? null,
    };
  });
  record("project", registered ?? {});
  if (!registered?.urls?.length || !/\/assets\/user\/[0-9a-f]{64}\.png$/.test(registered.scene ?? "")) throw new Error("설치한 자산이 원고에 등록되지 않았다");

  // 게임 ZIP 에도 실제 파일이 들어가는지 — 등록만 되고 번들에서 빠지면 배포한 게임이 빈다.
  await page.getByTestId("studio-export-bundle").click();
  const downloadPromise = page.waitForEvent("download", { timeout: 180_000 });
  await page.getByTestId("export-bundle-build").click();
  const download = await downloadPromise;
  const zipPath = join(OUT, "game.zip");
  await download.saveAs(zipPath);
  // ZIP 안에서 사용자 파일은 원래 경로(/assets/user/<sha256>.<ext>)로 들어가고,
  // 게이트웨이 생성 이미지만 assets/exported/<sha16>-<이름> 으로 리베이스된다. 둘 다 받아 준다.
  const bundled = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" }).split("\n").filter(line => /assets\/(user\/[0-9a-f]{64}|exported\/[0-9a-f]{16}-[0-9a-z._-]+)\.(png|jpe?g|webp)$/.test(line));
  record("export-bundle", { zipPath, bundledFiles: bundled.length, sample: bundled[0]?.trim().split(/\s+/).at(-1) });
  if (!bundled.length) throw new Error("설치한 자산이 게임 ZIP 에 들어가지 않았다");

  // 내보내기 대화상자를 닫아야 뒤의 플레이 버튼을 누를 수 있다(dialog 가 클릭을 막는다).
  await page.locator(".export-bundle-actions button").first().click();
  await page.getByTestId("export-bundle-dialog").waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});

  await page.getByTestId("studio-play").click();
  await page.waitForURL(/preview=1/, { timeout: 30_000 });
  await page.getByTestId("bg-image").waitFor({ timeout: 30_000 });
  const playerSrc = await page.getByTestId("bg-image").getAttribute("src");
  const playerWidth = await page.getByTestId("bg-image").evaluate(image => image.naturalWidth);
  record("player", { src: playerSrc, naturalWidth: playerWidth });
  // 플레이어의 src 는 assetUrl() 이 절대 URL 로 푼 값이다 — 원고에 저장된 경로와 끝을 맞춰 본다.
  if (playerWidth <= 0 || !(playerSrc ?? "").endsWith(registered.scene ?? "\u0000")) throw new Error("플레이어가 설치한 자산을 렌더하지 않았다");
  await page.screenshot({ path: join(OUT, "3-player.png") });

  writeFileSync(join(OUT, "summary.json"), JSON.stringify({ losia: LOSIA, steps, consoleErrors }, null, 2));
  console.log(`\n증거: ${OUT}`);
  if (consoleErrors.length) console.log(`콘솔 오류 ${consoleErrors.length}건: ${consoleErrors.slice(0, 3).join(" | ")}`);
} catch (error) {
  failed = true;
  writeFileSync(join(OUT, "summary.json"), JSON.stringify({ losia: LOSIA, steps, consoleErrors, error: String(error) }, null, 2));
  console.error(`\n실패: ${error instanceof Error ? error.message : error}`);
  if (consoleErrors.length) console.error(`콘솔 오류 ${consoleErrors.length}건: ${consoleErrors.slice(0, 5).join(" | ")}`);
} finally {
  await browser?.close();
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* 이미 죽었다 */ }
}
// process.exit() 은 버퍼링된 stdout 을 잘라 버린다 — 종료 코드만 남기고 자연 종료시킨다.
process.exitCode = failed ? 1 : 0;
