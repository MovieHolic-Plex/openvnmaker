import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync, crc32 } from "node:zlib";
import { admitBudget, parseBudgetRequest, canonicalHash } from "@vnmaker/harness";
import { partialChapterFixture } from "./r1-preview.js";
import { scopedOperationFixtures } from "./r2-operations.js";
import { qualityFixtures } from "./r3-quality.js";
import { counterFixtures } from "./r4-counters.js";
import { reuseFixtures } from "./r5-reuse.js";

test("retains an unwritten boundary when only three planned scenes are materialized", async () => {
  // Given / When
  const { preview, outline } = await partialChapterFixture();
  // Then
  assert.deepEqual(preview.materializedScenes.map(s => s.id), ["ch01-lab", "ch01-hall", "ch01-exit"]);
  assert.equal(outline.scenes.length, 4);
  assert.equal(preview.boundaries[0]?.targetSceneId, "ch02-arrival");
  assert.equal(preview.materializedScenes.some(s => s.id === "ch02-arrival" || s.ending), false);
  const { snapshotHash, ...content } = preview;
  assert.equal(snapshotHash, await canonicalHash(content));
});
test("distinguishes stale gap and scoped absence when anchors change", async () => {
  // Given / When
  const fixture = await scopedOperationFixtures();
  // Then
  assert.deepEqual(fixture.baseline.lines.map(l => l.id), ["l-a", "l-b"]);
  assert.deepEqual(fixture.staleGap.lines.map(l => l.id), ["l-a", "l-x", "l-b"]);
  assert.equal(fixture.missingTarget.lines.some(l => l.id === "l-a"), false);
  assert.equal(fixture.otherScene.lines[0]?.id, "l-a");
  assert.notEqual(fixture.otherScene.lines[0]?.text, fixture.baseline.lines[0]?.text);
});
test("keeps belief and rumour separate when supplying branch facts", () => {
  // Given / When
  const { facts } = qualityFixtures();
  // Then
  assert.deepEqual(facts.filter(f => f.truth?.kind === "world" && !f.applicability).map(f => f.id), ["world-locked"]);
  assert.deepEqual(facts.find(f => f.id === "belief-open")?.truth, { kind: "belief", holderCharacterId: "actor-0" });
  assert.equal(facts.find(f => f.id === "rumour-open")?.truth?.kind, "rumour");
  assert.deepEqual(facts.find(f => f.id === "route-a-secret")?.applicability, { anyOf: [{ all: ["a"] }] });
});
for (const variant of ["alpha", "wrongAlpha"] as const) test(`decodes ${variant} pixels when reading synthetic PNG bytes`, () => {
  // Given
  const fixture = qualityFixtures();
  const png = fixture[variant];
  // When: decode real PNG chunks independently of the encoder.
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    assert.equal(png.readUInt32BE(offset + 8 + size), crc32(png.subarray(offset + 4, offset + 8 + size)));
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  // Then
  assert.deepEqual([raw[4], raw[8], raw[13], raw[17]], variant === "alpha" ? [0, 255, 128, 255] : [255, 255, 255, 255]);
  assert.deepEqual([...raw.subarray(5, 9)], [0, 255, 0, 255]);
});
test("distinguishes wrong cast when reference pixels and target identity differ", () => {
  // Given / When
  const { binding, wrongBinding, alpha, wrongSprite } = qualityFixtures();
  // Then
  assert.notDeepEqual(binding.target, wrongBinding.target);
  assert.notEqual(binding.deliveryHash, wrongBinding.deliveryHash);
  assert.notDeepEqual(alpha, wrongSprite);
});
test("preserves bytes and exact tokens separately when admitting a counted fixture", async () => {
  // Given
  const { request } = await counterFixtures();
  // When
  const result = admitBudget(request);
  // Then
  assert.deepEqual([result.allowed, result.textContextBytes, result.countedInputTokens], [true, 30000, 7000]);
});
test("denies unsupported counts when exact-only was approved", async () => {
  // Given
  const fixture = await counterFixtures();
  // When
  const result = admitBudget(parseBudgetRequest({ ...fixture.request, counter: fixture.unsupported }));
  // Then
  assert.deepEqual([result.allowed, result.tokenCheck, result.countedInputTokens], [false, "unknown", null]);
});
test("denies all counter errors when bounded payload was approved", async () => {
  // Given
  const fixture = await counterFixtures();
  // When
  const results = fixture.errors.map(counter => admitBudget(parseBudgetRequest({ ...fixture.request, counter, policy: "bounded-payload", boundedPayloadApproved: true })));
  // Then
  assert.deepEqual(results.map(r => r.reason), ["COUNTER_AUTH", "COUNTER_QUOTA", "COUNTER_TRANSPORT"]);
  assert.deepEqual(results.map(r => r.allowed), [false, false, false]);
});
test("changes only the unrelated scene when producing H1 then records an insertion conflict", async () => {
  // Given / When
  const f = await reuseFixtures();
  // Then
  assert.deepEqual(f.original.scenes.filter(s => s.id !== "s070"), f.unrelated.scenes.filter(s => s.id !== "s070"));
  assert.notEqual(f.h0.scriptHash, f.h1.scriptHash);
  assert.deepEqual([f.h0.revision, f.h1.revision, f.collisionHead.revision], [0, 1, 2]);
  assert.equal(f.h0.productionHash, f.h1.productionHash);
  assert.equal(f.collision.scenes.find(s => s.id === "s001")?.lines.at(-1)?.id, f.candidateInsertion.assignedLineId);
  assert.notEqual(f.collision.scenes.find(s => s.id === "s001")?.lines.at(-1)?.text, f.candidateInsertion.value.text);
});
