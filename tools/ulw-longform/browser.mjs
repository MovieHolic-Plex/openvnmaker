#!/usr/bin/env node
/**
 * ULW long-form audit — real-browser editor/player probes (C2/C3/C4).
 *
 *   node tools/ulw-longform/browser.mjs [fixturePath]
 *
 * Requires the dev server on http://127.0.0.1:5184 (VNMAKER_URL overrides).
 * Writes evidence/ulw-longform/browser-results.json + screenshots.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.VNMAKER_URL ?? "http://127.0.0.1:5184";
const FIXTURE = resolve(process.argv[2] ?? "/tmp/ulw-longform-fixtures/L3c.json");
const OUT = resolve("evidence/ulw-longform");
const SHOTS = `${OUT}/editor-scale`;

const results = { startedAt: new Date().toISOString(), base: BASE, fixture: FIXTURE, fixtureBytes: statSync(FIXTURE).size, steps: [], longtasks: [], consoleErrors: [], pageErrors: [] };
const save = () => writeFileSync(`${OUT}/browser-results.json`, JSON.stringify(results, null, 1));
mkdirSync(SHOTS, { recursive: true });
mkdirSync(`${OUT}/player-scale`, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
  window.__ulwLong = [];
  try {
    new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__ulwLong.push({ start: Math.round(entry.startTime), dur: Math.round(entry.duration), name: entry.name }); }).observe({ entryTypes: ["longtask"] });
  } catch { /* longtask unsupported */ }
});
const page = await context.newPage();
page.on("console", message => { if (message.type() === "error") results.consoleErrors.push(message.text().slice(0, 300)); });
page.on("pageerror", error => results.pageErrors.push(String(error?.message ?? error).slice(0, 300)));

const longtaskSnapshot = () => page.evaluate(() => {
  const rows = window.__ulwLong ?? [];
  return { count: rows.length, totalMs: Math.round(rows.reduce((sum, entry) => sum + entry.dur, 0)) };
}).catch(() => ({ count: 0, totalMs: 0 }));

const step = async (name, fn) => {
  const t0 = Date.now();
  const before = await longtaskSnapshot();
  try {
    const value = await fn();
    const after = await longtaskSnapshot();
    const longTasks = { count: after.count - before.count, totalMs: after.totalMs - before.totalMs };
    results.steps.push({ name, ok: true, ms: Date.now() - t0, value, longTasks });
    console.log(`[ok] ${name} ${Date.now() - t0}ms longtasks=${JSON.stringify(longTasks)} ${value === undefined ? "" : JSON.stringify(value).slice(0, 200)}`);
  } catch (error) {
    results.steps.push({ name, ok: false, ms: Date.now() - t0, error: String(error?.message ?? error).slice(0, 500) });
    console.log(`[FAIL] ${name} ${Date.now() - t0}ms ${String(error?.message ?? error).slice(0, 240)}`);
  }
  save();
};

const storageSummary = () => page.evaluate(() => {
  const rows = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || key.startsWith("__ulw")) continue;
    rows.push([key, (localStorage.getItem(key) ?? "").length]);
  }
  return rows.sort((a, b) => b[1] - a[1]);
});

const quotaProbe = () => page.evaluate(() => {
  const key = "__ulw_quota_probe__";
  localStorage.removeItem(key);
  const chunk = "a".repeat(65536);
  let written = 0;
  try {
    for (let i = 0; i < 400; i += 1) { localStorage.setItem(key, chunk.repeat(i + 1)); written = chunk.length * (i + 1); }
    localStorage.removeItem(key);
    return { chars: written, note: "probe never hit the quota" };
  } catch (error) {
    localStorage.removeItem(key);
    return { chars: written, error: String(error).slice(0, 160) };
  }
});

const noticeText = () => page.evaluate(() => document.querySelector(".player-save-notice")?.textContent ?? document.querySelector("[role=status]")?.textContent ?? "");
const dialogOpen = () => page.evaluate(() => Boolean(document.querySelector("dialog.slot-picker[open]")));

// ---------- C2: editor at long-form scale ----------
await step("editor-boot-sample", async () => {
  const t0 = Date.now();
  await page.goto(`${BASE}/studio.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="studio-scene-list"]', { timeout: 60_000 });
  return { bootMs: Date.now() - t0 };
});

await step("editor-import-longform", async () => {
  const t0 = Date.now();
  await page.setInputFiles('input[data-testid="studio-import"]', FIXTURE);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="studio-scene-"]').length > 150, null, { timeout: 120_000 });
  const scenes = await page.evaluate(() => document.querySelectorAll('.studio-scene-list [data-testid^="studio-scene-"]').length);
  return { importMs: Date.now() - t0, scenes, saveState: await page.textContent('[data-testid="studio-save-state"]') };
});

await step("editor-scene-switch-s150", async () => {
  const t0 = Date.now();
  await page.click('[data-testid="studio-scene-s150"]');
  await page.waitForFunction(() => document.querySelector(".studio-scene-list .is-selected")?.getAttribute("data-testid") === "studio-scene-s150", null, { timeout: 120_000 });
  return { ms: Date.now() - t0 };
});

await step("editor-edit-line-latency", async () => {
  await page.click('[data-testid="studio-line-0"]');
  await page.waitForSelector('[data-testid="studio-line-text"]');
  const t0 = Date.now();
  await page.fill('[data-testid="studio-line-text"]', "ULW 장편 편집 확인 문장입니다. 이 줄은 규모 검증용으로 교체되었습니다.");
  await page.waitForFunction(() => document.querySelector(".studio-line-list li .line-copy")?.textContent?.includes("ULW 장편"), null, { timeout: 120_000 });
  const editMs = Date.now() - t0;
  const started = Date.now();
  await page.waitForFunction(() => document.querySelector('[data-testid="studio-save-state"]')?.textContent?.includes("로컬 저장됨"), null, { timeout: 180_000 });
  return { editMs, autosaveSettleMs: Date.now() - started, saveState: await page.textContent('[data-testid="studio-save-state"]') };
});

await step("editor-keystroke-latency", async () => {
  await page.click('[data-testid="studio-line-text"]');
  await page.fill('[data-testid="studio-line-text"]', "규모 검증 기준 문장");
  await page.waitForTimeout(500);
  const latencies = [];
  for (const ch of "고요한기록") {
    const t0 = Date.now();
    await page.keyboard.type(ch, { delay: 0 });
    await page.waitForFunction(expected => document.querySelector('[data-testid="studio-line-text"]')?.value?.endsWith(expected), ch, { timeout: 120_000 });
    latencies.push(Date.now() - t0);
  }
  return { samples: latencies, max: Math.max(...latencies) };
});

await step("editor-command-palette", async () => {
  const t0 = Date.now();
  await page.keyboard.press("Control+K");
  await page.waitForSelector("dialog.command-palette", { timeout: 60_000 });
  const opened = Date.now() - t0;
  const t1 = Date.now();
  await page.fill("dialog.command-palette input", "고요한기록");
  await page.waitForFunction(() => document.querySelector("dialog.command-palette .command-caption")?.textContent?.includes("검색 결과"), null, { timeout: 120_000 });
  const queryMs = Date.now() - t1;
  const caption = await page.textContent("dialog.command-palette .command-caption");
  await page.screenshot({ path: `${SHOTS}/command-palette.png` });
  await page.keyboard.press("Escape");
  return { openedMs: opened, queryMs, caption: caption?.slice(0, 60) };
});

await step("editor-story-map", async () => {
  const t0 = Date.now();
  await page.click('[data-testid="workspace-graph"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="graph-node-"]').length > 150, null, { timeout: 120_000 });
  const ms = Date.now() - t0;
  const nodes = await page.evaluate(() => document.querySelectorAll('[data-testid^="graph-node-"]').length);
  await page.screenshot({ path: `${SHOTS}/story-map.png` });
  return { ms, nodes };
});

await step("editor-production-panel", async () => {
  const t0 = Date.now();
  await page.click('[data-testid="workspace-production"]');
  await page.waitForSelector('[data-testid="manuscript-review"]', { timeout: 180_000 });
  await page.waitForFunction(() => document.querySelectorAll(".manuscript-scenes > button").length > 150, null, { timeout: 180_000 });
  const ms = Date.now() - t0;
  const cards = await page.evaluate(() => document.querySelectorAll(".manuscript-scenes > button").length);
  await page.screenshot({ path: `${SHOTS}/production-panel.png` });
  return { ms, cards };
});

await step("editor-validation-popover", async () => {
  const t0 = Date.now();
  await page.click('[data-testid="studio-validation"]');
  await page.waitForSelector(".validation-popover", { timeout: 120_000 });
  const ms = Date.now() - t0;
  const rows = await page.evaluate(() => document.querySelectorAll(".validation-popover .issue-row").length);
  await page.screenshot({ path: `${SHOTS}/validation.png` });
  return { ms, rows, button: (await page.textContent('[data-testid="studio-validation"]'))?.slice(0, 60) };
});

await step("editor-undo", async () => {
  await page.click('[data-testid="workspace-stage"]');
  await page.keyboard.press("Control+Z");
  await page.waitForFunction(() => !document.querySelector('[data-testid="studio-line-text"]')?.value?.includes("고요한기록"), null, { timeout: 120_000 });
  return { text: (await page.inputValue('[data-testid="studio-line-text"]')).slice(0, 30) };
});

await step("editor-redo", async () => {
  await page.keyboard.press("Control+Shift+KeyZ");
  await page.waitForFunction(() => document.querySelector('[data-testid="studio-line-text"]')?.value?.includes("고요한기록"), null, { timeout: 120_000 });
  return { text: (await page.inputValue('[data-testid="studio-line-text"]')).slice(0, 30) };
});

await step("editor-version-save", async () => {
  const t0 = Date.now();
  await page.click('[data-testid="studio-versions"]');
  await page.waitForSelector("dialog.version-history", { timeout: 60_000 });
  await page.fill('dialog.version-history input[aria-label="버전 이름"]', "ULW 장편 규모 버전");
  await page.click('[data-testid="version-save"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="version-row"]').length > 0, null, { timeout: 180_000 });
  const rows = await page.evaluate(() => document.querySelectorAll('[data-testid="version-row"]').length);
  await page.screenshot({ path: `${SHOTS}/version-history.png` });
  await page.keyboard.press("Escape");
  return { ms: Date.now() - t0, rows };
});

await step("editor-storage-keys", async () => storageSummary());

await step("editor-reload-persistence", async () => {
  const t0 = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll('.studio-scene-list [data-testid^="studio-scene-"]').length > 150, null, { timeout: 180_000 });
  const reloadMs = Date.now() - t0;
  await page.click('[data-testid="studio-scene-s150"]');
  await page.click('[data-testid="studio-line-0"]');
  await page.waitForSelector('[data-testid="studio-line-text"]', { timeout: 120_000 });
  const text = await page.inputValue('[data-testid="studio-line-text"]');
  return { reloadMs, text: text.slice(0, 40), keptEdit: text.includes("고요한기록") };
});

// ---------- C4: player at long-form scale ----------
await step("player-boot-from-studio-play", async () => {
  const t0 = Date.now();
  await page.click('[data-testid="studio-play"]');
  await page.waitForSelector('[data-testid="advance-button"]', { timeout: 180_000 });
  return { ms: Date.now() - t0, vn: await page.evaluate(() => window.__vn ?? null) };
});

await step("player-advance-20", async () => {
  const latencies = [];
  for (let i = 0; i < 20; i += 1) {
    const t0 = Date.now();
    await page.click('[data-testid="advance-button"]', { timeout: 60_000 });
    await page.waitForTimeout(20);
    latencies.push(Date.now() - t0);
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  return { meanMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length), p95Ms: sorted[Math.floor(sorted.length * 0.95)], maxMs: sorted.at(-1) };
});

await step("player-skip-to-choice", async () => {
  const t0 = Date.now();
  await page.click('[data-testid="skip-button"]', { timeout: 60_000 });
  await page.waitForFunction(() => window.__vn?.phase === "choice" || window.__vn?.phase === "ending", null, { timeout: 180_000 });
  return { ms: Date.now() - t0, vn: await page.evaluate(() => window.__vn ?? null) };
});

await step("player-choice-and-save-slot-0", async () => {
  await page.click('[data-testid="choice-0"]', { timeout: 60_000 });
  await page.waitForTimeout(200);
  await page.click('[data-testid="save-button"]', { timeout: 60_000 });
  await page.waitForSelector('[data-testid="slot-picker"]', { timeout: 60_000 });
  await page.click('[data-testid="slot-row-0"] button', { timeout: 60_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/player-scale/after-slot-0.png` });
  return { notice: (await noticeText()).slice(0, 120), dialogOpen: await dialogOpen(), storage: await storageSummary() };
});

await step("player-fill-remaining-slots", async () => {
  const attempts = [];
  for (let slot = 1; slot < 6; slot += 1) {
    if (!(await dialogOpen())) {
      try { await page.click('[data-testid="save-button"]', { timeout: 15_000 }); } catch (error) { attempts.push({ slot, stage: "open", error: String(error?.message ?? error).slice(0, 80) }); break; }
      try { await page.waitForSelector('[data-testid="slot-picker"]', { timeout: 15_000 }); } catch (error) { attempts.push({ slot, stage: "dialog", error: String(error?.message ?? error).slice(0, 80) }); break; }
    }
    try { await page.click(`[data-testid="slot-row-${slot}"] button`, { timeout: 15_000 }); } catch (error) { attempts.push({ slot, stage: "pick", error: String(error?.message ?? error).slice(0, 80) }); break; }
    await page.waitForTimeout(300);
    attempts.push({ slot, notice: (await noticeText()).slice(0, 90), dialogOpen: await dialogOpen() });
    if (attempts.at(-1).notice === "" && !(await dialogOpen())) await page.keyboard.press("Escape");
  }
  return { attempts, storage: await storageSummary() };
});

await step("player-load-slot-0", async () => {
  if (await dialogOpen()) await page.keyboard.press("Escape");
  await page.click('[data-testid="load-button"]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="slot-picker"]', { timeout: 30_000 });
  await page.click('[data-testid="slot-row-0"] button', { timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/player-scale/after-load.png` });
  return { vn: await page.evaluate(() => window.__vn ?? null), notice: (await noticeText()).slice(0, 140) };
});

await step("player-quota-capacity", async () => quotaProbe());

results.longtasks = await page.evaluate(() => (window.__ulwLong ?? []).sort((a, b) => b.dur - a.dur).slice(0, 20)).catch(() => []);
results.storageFinal = await storageSummary().catch(() => []);
save();

await browser.close();
console.log(`\nwrote ${OUT}/browser-results.json`);
console.log(`steps ok=${results.steps.filter(s => s.ok).length} fail=${results.steps.filter(s => !s.ok).length} consoleErrors=${results.consoleErrors.length} pageErrors=${results.pageErrors.length}`);
