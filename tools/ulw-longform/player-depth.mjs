#!/usr/bin/env node
/**
 * ULW long-form audit — deep player progression probe.
 *
 *   node tools/ulw-longform/player-depth.mjs [fixturePath]
 *
 * Boots the real studio, imports the long-form fixture, starts the web player and
 * traverses hundreds of lines through the player's own skip/choice controls.
 * The exact number of completed lines is read back from the player's auto-save
 * (state.history), not inferred from click counts.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.VNMAKER_URL ?? "http://127.0.0.1:5184";
const FIXTURE = resolve(process.argv[2] ?? "/tmp/ulw-longform-fixtures/L3c.json");
const OUT = resolve("evidence/ulw-longform");
mkdirSync(`${OUT}/player-scale`, { recursive: true });

const result = { startedAt: new Date().toISOString(), fixture: FIXTURE, fixtureBytes: statSync(FIXTURE).size, steps: [], finishedAt: null };
const save = () => writeFileSync(`${OUT}/player-depth.json`, JSON.stringify(result, null, 1));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(String(error?.message ?? error).slice(0, 200)));

const vn = () => page.evaluate(() => window.__vn ?? null);
const autoHistory = () => page.evaluate(() => {
  try {
    const raw = localStorage.getItem("vnmaker:auto:preview") ?? localStorage.getItem("vnmaker:auto");
    return raw ? (JSON.parse(raw)?.history?.length ?? 0) : -1;
  } catch { return -1; }
});

await page.goto(`${BASE}/studio.html`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="studio-scene-list"]', { timeout: 60_000 });
await page.setInputFiles('input[data-testid="studio-import"]', FIXTURE);
await page.waitForFunction(() => document.querySelectorAll('.studio-scene-list [data-testid^="studio-scene-"]').length > 150, null, { timeout: 120_000 });

const t0 = Date.now();
await page.click('[data-testid="studio-play"]');
await page.waitForSelector('[data-testid="advance-button"]', { timeout: 180_000 });
await page.click('[data-testid="studio-scene-s150"]', { timeout: 60_000 }).catch(() => {});
result.steps.push({ step: "player-boot", ms: Date.now() - t0, vn: await vn(), historyLines: await autoHistory() });

for (let round = 0; round < 4; round += 1) {
  const before = await autoHistory();
  const t = Date.now();
  await page.click('[data-testid="skip-button"]', { timeout: 60_000 });
  await page.waitForFunction(() => window.__vn?.phase === "choice" || window.__vn?.phase === "ending", null, { timeout: 180_000 });
  const afterSkip = await vn();
  const skippedMs = Date.now() - t;
  const historyAfterSkip = await autoHistory();
  let chosen = null;
  if (afterSkip?.phase === "choice") {
    const tPick = Date.now();
    await page.click('[data-testid="choice-0"]', { timeout: 60_000 });
    await page.waitForTimeout(150);
    chosen = { ms: Date.now() - tPick, vn: await vn() };
  }
  result.steps.push({ step: `round-${round + 1}`, skippedMs, linesBefore: before, linesAfterSkip: historyAfterSkip, linesGained: historyAfterSkip - before, vn: afterSkip, chosen });
  save();
  if (afterSkip?.phase === "ending") break;
}

const t1 = Date.now();
await page.click('[data-testid="save-button"]', { timeout: 60_000 });
await page.waitForSelector('[data-testid="slot-picker"]', { timeout: 60_000 });
await page.click('[data-testid="slot-row-0"] button', { timeout: 60_000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/player-scale/deep-progress.png` });
result.summary = {
  totalMs: t1 - t0,
  finalVn: await vn(),
  completedLines: await autoHistory(),
  saveNotice: await page.evaluate(() => document.querySelector(".player-save-notice")?.textContent ?? ""),
  pageErrors: errors,
};
result.finishedAt = new Date().toISOString();
save();

await browser.close();
console.log(JSON.stringify({ steps: result.steps.map(s => ({ step: s.step, skippedMs: s.skippedMs, linesGained: s.linesGained, phase: s.vn?.phase })), summary: result.summary }, null, 1));
