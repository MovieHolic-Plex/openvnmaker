#!/usr/bin/env node
/**
 * losia 스토어 패널 적대적 시각 QA.
 *
 * 정상 상태만 보면 안 된다 — 빈 결과·오류·느린 로딩·긴 이름·태그 폭탄·썸네일 404·embedded 전용·
 * 설치 진행/완료까지, 그리고 320~1920px 의 모든 브레이크포인트에서 캡처한다.
 * 각 캡처마다 객관 지표(가로 넘침·잘린 텍스트·겹침·탭 타깃 크기·깨진 이미지·대비)를 JSON 으로 남긴다.
 *
 *   node tools/qa/store-visual-qa.mjs
 * 결과: evidence/store-visual-qa/{NN-*.png, metrics.json}
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "evidence", "store-visual-qa");
const PORT = Number(process.env.VNMAKER_VQA_PORT ?? 5299);
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(OUT, { recursive: true });

const ITEM = (over = {}) => ({ id: "stb33826d1890f", kind: "stage", name: "부엌 · 낮", tags: ["부엌", "낮", "흐림"], license: "downloadable", thumb: "/assets/art/nocturne-atrium.png", uploader: { handle: "losia", display: "Losia" }, ...over });
const CATALOG = { items: [ITEM(), ITEM({ id: "st794fede2a17b", name: "마을 · 밤", tags: ["마을", "밤"], license: "attribution" }), ITEM({ id: "ste54f702f1aa4", name: "병원 복도 · 새벽 · 비", license: "embedded", thumb: undefined })], total: 3 };
const MANIFEST = { spec: "losia-asset/1", id: "stb33826d1890f", kind: "stage", name: "부엌 · 낮", license: "downloadable", files: [{ role: "base", url: "https://losia.online/api/assets/stb33826d1890f/files/base", mime: "image/png" }] };

const captures = [];
const failures = [];
const shots = [];

async function waitFor(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return true; } catch { /* 아직 */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/** 페이지 안에서 지표를 뽑는다: 넘침·잘림·겹침·탭 타깃·깨진 이미지·대비. */
async function measure(page) {
  return await page.evaluate(() => {
    const store = document.querySelector(".art-store");
    const root = document.documentElement;
    const parse = (color) => {
      const m = /rgba?\(([^)]+)\)/.exec(color || "");
      if (!m) return null;
      const [r, g, b, a = "1"] = m[1].split(",").map(v => Number(v.trim()));
      return { r, g, b, a };
    };
    const luminance = ({ r, g, b }) => { const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const contrast = (fg, bg) => { const l1 = luminance(fg), l2 = luminance(bg); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2)); };
    const effBg = (el) => { let node = el; while (node && node !== document.documentElement) { const c = parse(getComputedStyle(node).backgroundColor); if (c && c.a > 0.5) return c; node = node.parentElement; } return { r: 16, g: 17, b: 22, a: 1 }; };

    const overflowing = [];
    const clipped = [];
    if (store) for (const el of store.querySelectorAll("*")) {
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        const style = getComputedStyle(el);
        const isText = style.overflow === "hidden" && (style.textOverflow === "ellipsis" || style.whiteSpace === "nowrap");
        (isText ? clipped : overflowing).push({ tag: el.tagName.toLowerCase(), cls: el.className?.toString().slice(0, 60), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, text: (el.textContent || "").trim().slice(0, 40) });
      }
    }

    const smallTargets = [];
    if (store) for (const el of store.querySelectorAll("button, select, input, a[href]")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 28 || r.width < 28) smallTargets.push({ tag: el.tagName.toLowerCase(), cls: el.className?.toString().slice(0, 50), w: Math.round(r.width), h: Math.round(r.height), label: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24) });
    }

    const brokenImages = [...document.querySelectorAll(".art-store img")].filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute("src")?.slice(-50));

    const contrasts = [];
    if (store) for (const el of store.querySelectorAll("strong, small, p, span, label, h2, button")) {
      const text = (el.textContent || "").trim();
      if (!text || el.children.length > 0) continue;
      const fg = parse(getComputedStyle(el).color);
      const size = Number.parseFloat(getComputedStyle(el).fontSize);
      if (!fg) continue;
      const ratio = contrast(fg, effBg(el));
      const required = size >= 18 ? 3 : 4.5;
      if (ratio < required) contrasts.push({ text: text.slice(0, 24), fontSize: size, ratio, required });
    }

    // 서로 겹치는 형제 요소(패널 내부)
    const overlaps = [];
    if (store) {
      const nodes = [...store.querySelectorAll(".art-store-item, .art-store-install, .art-store-thumb, .art-section-title")];
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].getBoundingClientRect(), b = nodes[j].getBoundingClientRect();
        const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        if (overlap > 40 && nodes[i].parentElement?.contains(nodes[j]) === false && !nodes[i].contains(nodes[j])) overlaps.push({ a: nodes[i].className.toString().slice(0, 40), b: nodes[j].className.toString().slice(0, 40), px: Math.round(overlap) });
      }
    }

    return {
      viewport: { w: innerWidth, h: innerHeight },
      horizontalOverflow: root.scrollWidth - root.clientWidth,
      storePresent: Boolean(store),
      overflowing: overflowing.slice(0, 8),
      clippedText: clipped.slice(0, 8),
      smallTargets: smallTargets.slice(0, 8),
      brokenImages,
      lowContrast: contrasts.slice(0, 8),
      overlaps: overlaps.slice(0, 8),
    };
  });
}

async function shoot(page, name, note) {
  // 스토어 패널의 이미지만, 그리고 3초 상한으로 기다린다(원고 그리드의 대용량 아트 35장을 디코드하면 캡처가 멈춘다).
  await page.evaluate(() => Promise.race([
    Promise.all([...document.querySelectorAll(".art-store img")].map(image => image.decode().catch(() => undefined))),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]));
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path });
  const metrics = await measure(page);
  const entry = { name, note, path, ...metrics };
  captures.push(entry);
  shots.push(path);
  const problems = [];
  if (metrics.horizontalOverflow > 2) problems.push(`가로 넘침 ${metrics.horizontalOverflow}px`);
  if (metrics.overflowing.length) problems.push(`컨테이너 넘침 ${metrics.overflowing.length}`);
  if (metrics.brokenImages.length) problems.push(`깨진 이미지 ${metrics.brokenImages.length}`);
  if (metrics.lowContrast.length) problems.push(`저대비 ${metrics.lowContrast.length}`);
  if (metrics.smallTargets.length) problems.push(`작은 타깃 ${metrics.smallTargets.length}`);
  if (metrics.overlaps.length) problems.push(`겹침 ${metrics.overlaps.length}`);
  if (problems.length) failures.push({ name, problems });
  console.log(`· ${name} ${problems.length ? "⚠ " + problems.join(", ") : "ok"}`);
  return metrics;
}

const server = spawn("pnpm", ["--filter", "@vnmaker/app", "dev", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore", detached: true });
let browser;
let failed = false;
try {
  if (!(await waitFor(`${BASE}/api/health`))) throw new Error("게이트웨이가 뜨지 않았다");
  browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"], timeout: 60_000 });
  console.log("· 브라우저 기동 완료");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const consoleErrors = [];
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("pageerror", e => consoleErrors.push("pageerror: " + String(e).slice(0, 200)));

  const openArt = async () => {
    for (let i = 0; i < 3; i++) {
      try { await page.goto(`${BASE}/studio.html`); console.log(`· studio 진입 시도 ${i + 1}: 문서 로드`); await page.getByTestId("workspace-assets").waitFor({ state: "visible", timeout: 60_000 }); console.log(`· studio 진입 시도 ${i + 1}: 레일 확인`); await page.getByTestId("workspace-assets").click(); await page.getByTestId("store-panel").waitFor({ timeout: 60_000 }); console.log(`· studio 진입 시도 ${i + 1}: 스토어 패널 확인`); return; }
      catch (e) { console.log(`· studio 진입 실패 ${i + 1}/3: ${String(e).split("\n")[0].slice(0, 120)}`); if (i === 2) throw e; }
    }
  };
  const stub = async (mode) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    if (mode === "slow") await page.route("**/api/store/catalog*", async route => { await new Promise(r => setTimeout(r, 4000)); await route.fulfill({ json: CATALOG }); });
    else if (mode === "empty") await page.route("**/api/store/catalog*", route => route.fulfill({ json: { items: [], total: 0 } }));
    else if (mode === "error") await page.route("**/api/store/catalog*", route => route.fulfill({ status: 502, json: { error: "스토어에 연결하지 못했습니다. losia.online 상태를 확인하세요" } }));
    else if (mode === "hostile") await page.route("**/api/store/catalog*", route => route.fulfill({ json: { items: [
      ITEM({ id: "staaaaaaaaaaaa", name: "아주 긴 이름의 무대 자산 — 새벽 네 시 반, 비가 그친 뒤 병원 복도 끝 창가에서 바라본 도시의 불빛과 젖은 아스팔트", tags: ["병원", "복도", "새벽", "비", "맑음", "도시", "불빛", "창가", "아스팔트", "장마", "여름", "야경"] }),
      ITEM({ id: "stbbbbbbbbbbbb", name: "썸네일 없음", thumb: undefined }),
      ITEM({ id: "stcccccccccccc", name: "썸네일 404", thumb: `${BASE}/api/definitely-missing-thumb.webp` }),
      ITEM({ id: "stdddddddddddd", name: "embedded 등급", license: "embedded" }),
      ITEM({ id: "soeeeeeeeeeeee", name: "문 열림", kind: "sound", tags: ["효과음"] }),
    ], total: 1200 } }));
    else await page.route("**/api/store/catalog*", route => route.fulfill({ json: CATALOG }));
    await page.route("**/api/store/assets/*/manifest", route => route.fulfill({ json: MANIFEST }));
    await page.route("**/api/store/assets/*/files/*", async route => {
      const { readFile } = await import("node:fs/promises");
      await route.fulfill({ contentType: "image/png", body: await readFile(join(ROOT, "packages/app/public/assets/art/nocturne-atrium.png")) });
    });
  };

  /* ── 1. 정상 상태, 브레이크포인트 전수 ───────────────── */
  await stub("normal");
  await openArt();
  await page.getByLabel("스토어 종류").selectOption("stage");
  await page.locator('[data-testid^="store-item-"]').first().waitFor();
  for (const [w, h, tag] of [[1920, 1080, "wide"], [1440, 900, "desktop"], [1280, 800, "laptop"], [1200, 900, "bp1200"], [1199, 900, "bp1199"], [1024, 768, "tablet"], [850, 900, "bp850"], [849, 900, "bp849"], [768, 1024, "portrait"], [390, 844, "mobile"], [320, 700, "narrow"]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(350);
    // 좁은 폭에서는 작업대가 아래로 쌓인다 — 패널 상단이 화면에 들어오게 스크롤한 뒤 찍는다(block:start).
    if (w <= 850) { await page.getByTestId("store-panel").evaluate(el => el.scrollIntoView({ block: "start" })); await page.waitForTimeout(300); }
    await shoot(page, `10-normal-${tag}-${w}`, `정상 상태 ${w}px`);
    if (w <= 850) await page.getByTestId("store-panel").screenshot({ path: join(OUT, `11-panel-${tag}-${w}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);

  /* ── 2. 상태별(호버·포커스 포함) ─────────────────────── */
  await page.getByTestId("store-search").hover();
  await shoot(page, "20-search-hover", "검색 입력 호버");
  await page.getByTestId("store-search").focus();
  await shoot(page, "21-search-focus", "검색 입력 포커스(키보드 링)");
  await page.keyboard.press("Tab");
  await shoot(page, "22-tab-order", "Tab 이동 후 포커스 링");
  await page.getByTestId("store-install-stb33826d1890f").focus();
  await shoot(page, "23-install-focus", "설치 버튼 포커스");

  /* ── 3. 결과 없음 / 오류 / 느린 로딩 ─────────────────── */
  await stub("empty"); await page.getByTestId("store-search").fill("없는자산"); await page.getByTestId("store-search").press("Enter"); await page.waitForTimeout(600);
  await shoot(page, "30-empty-results", "검색 결과 없음");
  await stub("error"); await page.getByTestId("store-kind").selectOption("character"); await page.waitForTimeout(800);
  await shoot(page, "31-error-502", "카탈로그 502 오류");
  await stub("slow"); await page.getByTestId("store-kind").selectOption("stage");
  await page.waitForTimeout(700); await shoot(page, "32-loading", "느린 로딩(스켈레톤 없음 확인)");
  await page.waitForTimeout(4500);

  /* ── 4. 적대적 데이터: 긴 이름·태그 폭탄·썸네일 없음/404·embedded·소리 ── */
  await stub("hostile"); await page.getByTestId("store-kind").selectOption("all"); await page.waitForTimeout(900);
  await shoot(page, "40-hostile-data", "긴 이름·태그 12개·썸네일 없음/404·embedded·소리 혼합");
  const embeddedRow = page.locator('.art-store-item').filter({ hasText: "embedded 등급" }).first();
  const embedded = embeddedRow.locator('button[data-testid^="store-install-"]');
  await shoot(page, "41-embedded-disabled", `embedded 행 설치 버튼 disabled=${await embedded.isDisabled()}`);

  /* ── 5. 설치 진행/완료/재설치 라벨 ───────────────────── */
  await stub("normal"); await page.getByTestId("store-kind").selectOption("stage"); await page.waitForTimeout(600);
  await page.getByTestId("store-install-stb33826d1890f").click();
  await page.waitForTimeout(120); await shoot(page, "50-install-progress", "설치 진행 중(버튼 라벨/상태)");
  await page.getByTestId("store-status").waitFor();
  await shoot(page, "51-installed", "설치 완료 상태(다시 설치 라벨 + 상태 문구)");

  /* ── 6. 플레이어(설치 자산 적용 후) ──────────────────── */
  await page.getByTestId("art-apply").click();
  await page.waitForTimeout(1200);
  await page.getByTestId("studio-play").click();
  await page.waitForURL(/preview=1/); await page.getByTestId("bg-image").waitFor();
  await shoot(page, "60-player-desktop", "플레이어 1440px");
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
  await shoot(page, "61-player-mobile", "플레이어 390px");

  writeFileSync(join(OUT, "metrics.json"), JSON.stringify({ capturedAt: new Date().toISOString(), port: PORT, captureCount: captures.length, captures, failures, consoleErrors }, null, 2));
  console.log(`\n캡처 ${captures.length}장 / 경고 ${failures.length}건 / 콘솔오류 ${consoleErrors.length}건 → ${OUT}`);
  if (failures.length) for (const f of failures) console.log(`  ⚠ ${f.name}: ${f.problems.join(", ")}`);
} catch (error) {
  failed = true;
  writeFileSync(join(OUT, "metrics.json"), JSON.stringify({ capturedAt: new Date().toISOString(), captures, failures, error: String(error) }, null, 2));
  console.error(`실패: ${error}`);
} finally {
  await browser?.close();
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* 이미 종료 */ }
}
process.exitCode = failed ? 1 : 0;
