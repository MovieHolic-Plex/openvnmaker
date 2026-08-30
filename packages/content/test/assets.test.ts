import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { script } from "../src/index.js";
import { findMissingAssets } from "../src/check.js";
import { backgroundIds, bgmIds, sfxIds, spriteFiles } from "../src/manifest.js";
import { existsSync } from "node:fs";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../app/public/assets");

test("시나리오가 참조하는 에셋 파일이 모두 존재한다", () => {
  assert.deepEqual(findMissingAssets(script, PUBLIC_DIR), []);
});

test("매니페스트에 선언된 에셋 파일이 모두 존재한다", () => {
  const missing = [
    ...backgroundIds.map((id) => join("bg", `${id}.png`)),
    ...spriteFiles.map((name) => join("sprite", `${name}.png`)),
    ...bgmIds.map((id) => join("audio", "bgm", `${id}.mp3`)),
    ...sfxIds.map((id) => join("audio", "sfx", `${id}.mp3`)),
  ].filter((rel) => !existsSync(join(PUBLIC_DIR, rel)));
  assert.deepEqual(missing, []);
});
