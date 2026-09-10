import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { runtimeContentType, webFontNotices } from "../web-fonts.js";

const root = resolve(import.meta.dirname, "..");
const faces = [
  { family: "IBM Plex Sans KR", weight: 400, file: "IBMPlexSansKR-Regular.woff2" },
  { family: "IBM Plex Sans KR", weight: 500, file: "IBMPlexSansKR-Medium.woff2" },
  { family: "IBM Plex Sans KR", weight: 600, file: "IBMPlexSansKR-SemiBold.woff2" },
  { family: "IBM Plex Sans KR", weight: 700, file: "IBMPlexSansKR-Bold.woff2" },
  { family: "Noto Serif KR", weight: 600, file: "NotoSerifKR-SemiBold.woff2" },
  { family: "Noto Serif KR", weight: 700, file: "NotoSerifKR-Bold.woff2" },
] as const;

test("player and studio HTML load local faces instead of Google Font hosts", async () => {
  for (const name of ["index.html", "studio.html"]) {
    const html = await readFile(resolve(root, name), "utf8");
    assert.equal(html.includes("fonts.googleapis.com"), false, name);
    assert.equal(html.includes("fonts.gstatic.com"), false, name);
  }
});

test("shared CSS registers each Korean webfont weight as a local woff2 face", async () => {
  const css = await readFile(resolve(root, "src/styles/fonts.css"), "utf8");
  for (const face of faces) {
    assert.match(css, new RegExp(`font-family:\\s*"${face.family}"`));
    assert.match(css, new RegExp(`font-weight:\\s*${face.weight}`));
    assert.match(css, new RegExp(`url\\("./fonts/${face.file}"\\)`));
  }
  assert.equal(css.includes("fonts.googleapis.com"), false);
  assert.equal(css.includes("fonts.gstatic.com"), false);
});

test("vendored woff2 bytes match pinned provenance hashes and retain OFL notices", async () => {
  const provenance = JSON.parse(await readFile(resolve(root, "src/styles/fonts/provenance.json"), "utf8"));
  assert.equal(provenance.faces.length, faces.length);
  for (const face of faces) {
    const record = provenance.faces.find((entry: { file: string }) => entry.file === face.file);
    assert.equal(record.family, face.family);
    assert.equal(record.weight, face.weight);
    assert.match(record.source, /^https:\/\/github.com\/(IBM\/plex|google\/fonts)$/);
    assert.match(record.commit, /^[a-f0-9]{40}$/);
    const bytes = await readFile(resolve(root, "src/styles/fonts", face.file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), record.sha256);
    assert.ok(bytes.length > 1000);
  }
  const notices = await webFontNotices(root);
  const text = new TextDecoder().decode(notices.get("FONT-NOTICES.txt"));
  assert.match(text, /SIL Open Font License, Version 1.1/);
  assert.match(text, /IBM Plex Sans KR/);
  assert.match(text, /Noto Serif KR/);
  for (const face of faces) assert.ok(text.includes(face.file));
});

test("export runtime advertises woff2 with a font MIME type", () => {
  assert.equal(runtimeContentType("IBMPlexSansKR-Regular-ab12.woff2"), "font/woff2");
  assert.equal(runtimeContentType("player-ab12.js"), "text/javascript");
  assert.equal(runtimeContentType("style-ab12.css"), "text/css");
  assert.equal(runtimeContentType("FONT-NOTICES.txt"), "text/plain; charset=utf-8");
  assert.equal(runtimeContentType("manifest.json"), "application/json");
});
