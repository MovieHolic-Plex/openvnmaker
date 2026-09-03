#!/usr/bin/env node
/**
 * evidence/ 의 큰 PNG 스크린샷을 보고서용으로 줄여 docs/qa-report/shots/ 에 JPEG 로 굽는다.
 *
 * playwright 번들 ffmpeg 은 png 인코더만 있고 디코더가 없어서 PNG 를 못 읽는다.
 * 그래서 크로미움 canvas 로 리샘플링한다. 브라우저가 이미 디코더를 갖고 있다.
 *
 *   node tools/qa/shrink-shots.mjs
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "docs", "qa-report", "shots");
const QUALITY = 0.86;

/** [원본, 결과, 가로 최대폭] */
const JOBS = [
  ["evidence/e2e-playthrough/01-title.png", "play-01-title.jpg", 1280],
  ["evidence/e2e-playthrough/scene-s01-gate.png", "play-s01-gate.jpg", 1280],
  ["evidence/e2e-playthrough/scene-s02-studio.png", "play-s02-studio.jpg", 1280],
  ["evidence/e2e-playthrough/scene-s03-cafe.png", "play-s03-cafe.jpg", 1280],
  ["evidence/e2e-playthrough/scene-s04-lawn.png", "play-s04-lawn.jpg", 1280],
  ["evidence/e2e-playthrough/scene-s05-library.png", "play-s05-library.jpg", 1280],
  ["evidence/e2e-playthrough/scene-s06-rooftop.png", "play-s06-rooftop.jpg", 1280],
  ["evidence/e2e-playthrough/scene-s07-studio-night.png", "play-s07-studio-night.jpg", 1280],
  ["evidence/e2e-playthrough/scene-s08-riverside.png", "play-s08-riverside.jpg", 1280],
  ["evidence/e2e-playthrough/99-ending.png", "play-99-ending.jpg", 1280],
  ["evidence/visual-qa/desktop-1280x720/01-title.png", "qa-d-01-title.jpg", 1280],
  ["evidence/visual-qa/desktop-1280x720/02-dialogue.png", "qa-d-02-dialogue.jpg", 1280],
  ["evidence/visual-qa/desktop-1280x720/03-choices.png", "qa-d-03-choices.jpg", 1280],
  ["evidence/visual-qa/desktop-1280x720/04-history.png", "qa-d-04-history.jpg", 1280],
  ["evidence/visual-qa/desktop-1280x720/05-ending.png", "qa-d-05-ending.jpg", 1280],
  ["evidence/visual-qa/mobile-390x844/01-title.png", "qa-m-01-title.jpg", 430],
  ["evidence/visual-qa/mobile-390x844/02-dialogue.png", "qa-m-02-dialogue.jpg", 430],
  ["evidence/visual-qa/mobile-390x844/03-choices.png", "qa-m-03-choices.jpg", 430],
  ["evidence/visual-qa/mobile-390x844/04-history.png", "qa-m-04-history.jpg", 430],
  ["evidence/visual-qa/mobile-390x844/05-ending.png", "qa-m-05-ending.jpg", 430],
  ["evidence/visual-qa/bug-choices-before.png", "bug-choices-before.jpg", 1280],
  ["evidence/regression/docs-vision.png", "reg-vision.jpg", 1040],
  ["evidence/regression/docs-concepts.png", "reg-concepts.jpg", 1040],
  ["evidence/regression/docs-report.png", "reg-report.jpg", 1040],
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");

let done = 0;
const missing = [];
for (const [src, dst, maxWidth] of JOBS) {
  const abs = join(ROOT, src);
  if (!existsSync(abs)) {
    missing.push(src);
    continue;
  }
  const dataUrl = `data:image/png;base64,${readFileSync(abs).toString("base64")}`;
  const jpegBase64 = await page.evaluate(
    async ({ dataUrl: url, maxWidth: w, quality }) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const scale = Math.min(1, w / img.naturalWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", quality).split(",")[1];
    },
    { dataUrl, maxWidth, quality: QUALITY },
  );
  const target = join(OUT, dst);
  writeFileSync(target, Buffer.from(jpegBase64, "base64"));
  const before = statSync(abs).size / 1024;
  const after = statSync(target).size / 1024;
  console.log(`${dst}  ${before.toFixed(0)}KB -> ${after.toFixed(0)}KB`);
  done += 1;
}

await browser.close();

console.log(`\n${done}/${JOBS.length} 생성 -> ${pathToFileURL(OUT).href}`);
if (missing.length > 0) {
  console.error(`원본 없음:\n- ${missing.join("\n- ")}`);
  process.exit(1);
}
