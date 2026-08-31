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
  // loading="lazy" 이미지는 화면에 들어와야 디코드된다. 끝까지 훑어서 전부 강제로 로드시킨다.
  // 로드가 끝나기 전에 맨 위로 다시 올리면 뷰토 밖 이미지가 로드를 시작하지 않는다. 기다린 다에 올린다.
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 200));
    }
  });
  await page
    .waitForFunction(() => [...document.querySelectorAll("img")].every((img) => img.complete && img.naturalWidth > 0), null, {
      timeout: 20_000,
    })
    .catch(() => undefined);
  await page.evaluate(() => window.scrollTo(0, 0));
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
  const ok = stats.loaded > 0 && stats.loaded === stats.total && errors.length === 0;
  console.log(`${rel} title="${stats.title}" img ${stats.loaded}/${stats.total} errors=${errors.length} ${ok ? "OK" : "FAIL"}`);
  if (!ok) failed += 1;
  await page.close();
}
await browser.close();
process.exit(failed === 0 ? 0 : 1);
