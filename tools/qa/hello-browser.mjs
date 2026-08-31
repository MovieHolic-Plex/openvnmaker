#!/usr/bin/env node
/**
 * 실제 타이틀에서 한 줄 받기를 누른다. mock 없음.
 * Vite(127.0.0.1:5173)가 이미 떠 있어야 한다.
 */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
const auth = (await page.getByTestId("auth-status").textContent()) ?? "";
const helloDisabled = await page.getByTestId("hello-button").isDisabled();
console.log(`auth="${auth.trim()}" helloDisabled=${helloDisabled}`);

if (helloDisabled) {
  console.error("한 줄 받기가 비활성이다");
  await browser.close();
  process.exit(1);
}

await page.getByTestId("hello-button").click();
await page.getByTestId("stage").waitFor({ timeout: 120_000 });
await page.waitForFunction(() => window.__vn && window.__vn.phase === "scene" && window.__vn.typing === false, null, {
  timeout: 30_000,
});
const scene = await page.getByTestId("stage").getAttribute("data-scene");
const dialogue = ((await page.getByTestId("dialogue-text").textContent()) ?? "").replace(/\s+$/g, "");
const vn = await page.evaluate(() => window.__vn);
console.log(`scene=${scene}`);
console.log(`vn=${JSON.stringify(vn)}`);
console.log(`dialogue=${dialogue}`);
if (errors.length > 0) console.error("errors:\n" + errors.join("\n"));

const ok = scene === "hello" && dialogue.length >= 8 && !dialogue.includes("처음부터");
const diskRes = await fetch("http://127.0.0.1:5173/api/project/nodes/hello");
const disk = await diskRes.json();
console.log(`diskStatus=${diskRes.status} path=${disk.path ?? ""}`);
if (!ok) {
  await browser.close();
  console.error("PLAY 에 한 줄이 안 올랐다");
  process.exit(1);
}
if (diskRes.status !== 200 || disk.node?.id !== "hello") {
  await browser.close();
  console.error("IR 노드가 디스크에 없다");
  process.exit(1);
}
const say = disk.node.beats?.find((b) => b.op === "say");
if (typeof say?.text !== "string" || say.text.length < 8) {
  await browser.close();
  console.error("디스크 노드에 say 가 없다");
  process.exit(1);
}
await browser.close();
console.log("통과");
