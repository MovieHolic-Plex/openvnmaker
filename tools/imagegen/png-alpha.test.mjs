import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePng, decodePng, isProtectedFill, keyBorderWhite, keyChromaGreen, defringeWhite } from "./png-alpha.mjs";

function blank(width, height, r, g, b) {
  const data = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
  }
  return { width, height, data };
}

test("살색은 보호하고 순백은 보호하지 않는다", () => {
  const skin = Buffer.from([236, 196, 170, 255]);
  const white = Buffer.from([255, 255, 255, 255]);
  const cream = Buffer.from([244, 228, 200, 255]);
  assert.equal(isProtectedFill(skin, 0), true);
  assert.equal(isProtectedFill(cream, 0), true);
  assert.equal(isProtectedFill(white, 0), false);
});

test("흰 테두리는 지우고 가운데 살색은 남긴다", () => {
  const img = blank(24, 24, 255, 255, 255);
  for (let y = 6; y < 18; y += 1) {
    for (let x = 6; x < 18; x += 1) {
      const i = (y * 24 + x) * 4;
      img.data[i] = 236;
      img.data[i + 1] = 196;
      img.data[i + 2] = 170;
    }
  }
  const cleared = keyBorderWhite(img, 6, 18);
  assert.ok(cleared > 100);
  const face = (12 * 24 + 12) * 4;
  assert.equal(img.data[face + 3], 255);
  assert.equal(img.data[0 + 3], 0);
});

test("윗변 살색은 시드하지 않는다", () => {
  const img = blank(16, 16, 255, 255, 255);
  for (let x = 4; x < 12; x += 1) {
    const i = x * 4;
    img.data[i] = 236;
    img.data[i + 1] = 196;
    img.data[i + 2] = 170;
  }
  keyBorderWhite(img, 6, 18, { skipTop: true });
  assert.equal(img.data[(0 * 16 + 8) * 4 + 3], 255);
});

test("초록 배경만 지운다", () => {
  const img = blank(12, 12, 0, 255, 0);
  const mid = (6 * 12 + 6) * 4;
  img.data[mid] = 220;
  img.data[mid + 1] = 160;
  img.data[mid + 2] = 140;
  const cleared = keyChromaGreen(img);
  assert.ok(cleared > 50);
  assert.equal(img.data[mid + 3], 255);
  assert.equal(img.data[3], 0);
});

test("흰 테두리 픽셀만 디프린지한다", () => {
  const img = blank(8, 8, 0, 0, 0);
  for (let i = 0; i < 8 * 8; i += 1) {
    img.data[i * 4 + 3] = 255;
  }
  img.data[3] = 0;
  img.data[4] = 255;
  img.data[5] = 255;
  img.data[6] = 255;
  img.data[7] = 255;
  const cleared = defringeWhite(img, 24);
  assert.ok(cleared >= 1);
  assert.equal(img.data[7], 0);
});

test("PNG 왕복 뒤에도 알파가 산다", () => {
  const img = blank(8, 8, 255, 255, 255);
  img.data[4 * 8 * 4 + 4 * 4 + 3] = 128;
  const round = decodePng(encodePng(img));
  assert.equal(round.width, 8);
  assert.equal(round.data[4 * 8 * 4 + 4 * 4 + 3], 128);
});
