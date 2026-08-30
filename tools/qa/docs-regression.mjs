#!/usr/bin/env node
/**
 * 인접 표면 회귀 확인: 기존 기획 문서 사이트가 그대로 렌더되는지 본다.
 * docs/vision/index.html 을 실제 크로미움으로 열고 이미지가 로드됐는지 세고 스크린샷을 남긴다.
 *
 * 사용법: node tools/qa/docs-regression.mjs
 */
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "evidence/regression");
mkdirSync(OUT, { recursive: true });

const targets = ["docs/vision/index.html", "docs/concepts/index.html", "docs/report/index.html"];

const browser = await chromium.launch();
let failed = 0;
for (const rel of targets) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto(pathToFileURL(join(ROOT, rel)).href, { waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const stats = await page.evaluate(() => {
    const images = [...document.querySelectorAll("img")];
    return {
      total: images.length,
      loaded: images.filter((img) => img.naturalWidth > 0).length,
      title: document.title,
    };
  });
  const name = rel.split("/")[1];
  await page.screenshot({ path: join(OUT, `docs-${name}.png`), fullPage: false });
  const ok = stats.loaded > 0 && errors.length === 0;
  console.log(`${rel} title="${stats.title}" img ${stats.loaded}/${stats.total} errors=${errors.length} ${ok ? "OK" : "FAIL"}`);
  if (!ok) failed += 1;
  await page.close();
}
await browser.close();
process.exit(failed === 0 ? 0 : 1);
