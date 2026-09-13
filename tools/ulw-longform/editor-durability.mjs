#!/usr/bin/env node
/**
 * ULW long-form audit — editor save durability probe.
 *
 *   node tools/ulw-longform/editor-durability.mjs
 *
 * Case 1 (immediate): edit a line and reload right away. On the unfixed studio the
 * 600 ms autosave timer never fires, so the reload shows the previous text.
 * Case 2 (delayed): the same edit with a pause past the debounce — this one proves
 * the ordinary autosave path itself works, separating a missing flush from a
 * broken save. Each case reports the textarea, the timeline row, the save-state
 * label and whether the quick-recovery key already contains the edit.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.VNMAKER_URL ?? "http://127.0.0.1:5184";
const OUT = resolve("evidence/ulw-longform");
mkdirSync(OUT, { recursive: true });

const story = {
  title: "저장 내구성 검증", subtitle: "", start: "start", flags: {}, characters: [],
  scenes: [{ id: "start", background: "title", lines: [{ speaker: null, text: "첫 번째 문장입니다." }], ending: "끝" }],
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(({ story, edition }) => {
  localStorage.setItem("vnmaker.edition", edition);
  if (!localStorage.getItem("vnmaker.studio.project.v1")) localStorage.setItem("vnmaker.studio.project.v1", JSON.stringify(story));
}, { story, edition: "rain-blank-2026-09-05-r1" });
const page = await context.newPage();

const results = { immediate: null, delayed: null };
const probe = async label => ({
  label,
  textarea: await page.inputValue('[data-testid="studio-line-text"]').catch(() => null),
  timeline: await page.evaluate(() => document.querySelector(".studio-line-list li .line-copy")?.textContent ?? null),
  saveState: await page.evaluate(() => document.querySelector('[data-testid="studio-save-state"]')?.textContent ?? null),
  recoveryPanel: await page.evaluate(() => Boolean(document.querySelector(".project-recovery, [data-testid=\"project-recovery\"]"))),
  stored: await page.evaluate(() => localStorage.getItem("vnmaker.studio.project.v1")?.includes("저장 검증 문장") ?? false),
});

const openLine = async () => {
  await page.click('[data-testid="studio-scene-start"]');
  await page.click('[data-testid="studio-line-0"]');
  await page.waitForSelector('[data-testid="studio-line-text"]', { timeout: 30_000 });
  return page.inputValue('[data-testid="studio-line-text"]');
};

await page.goto(`${BASE}/studio.html`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="studio-scene-list"]', { timeout: 60_000 });
await openLine();
results.initial = await probe("initial");

// Case 1 — edit and reload with no pause at all.
await page.fill('[data-testid="studio-line-text"]', "저장 검증 문장 A.");
const afterFill = await probe("case1-after-fill");
await page.reload({ waitUntil: "domcontentloaded" });
const textAfterImmediate = await openLine();
results.immediate = { afterFill, textAfterReload: textAfterImmediate, survived: textAfterImmediate.includes("저장 검증 문장 A") };

// Case 2 — the same edit with a pause past the 600 ms autosave debounce.
await page.fill('[data-testid="studio-line-text"]', "저장 검증 문장 B.");
const afterWaitProbe = await (async () => { await page.waitForTimeout(1400); return probe("case2-after-wait"); })();
await page.reload({ waitUntil: "domcontentloaded" });
const textAfterDelayed = await openLine();
results.delayed = { afterWait: afterWaitProbe, textAfterReload: textAfterDelayed, survived: textAfterDelayed.includes("저장 검증 문장 B") };

results.measuredAt = new Date().toISOString();
writeFileSync(`${OUT}/editor-durability.json`, JSON.stringify(results, null, 1));
await browser.close();
console.log(JSON.stringify(results, null, 1));
console.log(`DURABILITY: ${results.immediate.survived && results.delayed.survived ? "PASS" : "FAIL"}`);
