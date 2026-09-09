import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalBytes, canonicalHash, canonicalJson } from "../src/canonical.js";
import { artifactReceiptSchema, unitSchema } from "../src/lifecycle-contracts.js";
import { hashSchema } from "../src/primitives.js";
import { verifyReuseOutputArtifact } from "../src/reuse-output.js";
import { outputVerificationFixture } from "./reuse-output-fixture.js";

test("verifies actual preserved bytes against the immutable unit output hash without rewriting provenance", async () => {
  // Given a real successful patch artifact, captured frame and ready unit provenance.
  const fixture = await outputVerificationFixture();
  const original = canonicalJson(fixture.unit);
  const bytes = fixture.output.bytes.slice();
  // When storage supplies the original receipt and bytes.
  const result = await verifyReuseOutputArtifact(fixture.unit, { kind: "present", output: fixture.output });
  // Then this is a byte proof only, retaining the original generation/validation provenance.
  assert.equal(result.kind, "verified");
  assert.equal(result.unitId, fixture.unit.id);
  assert.deepEqual(result.artifact, fixture.output.receipt);
  assert.deepEqual(result.provenance, fixture.unit.provenance);
  assert.deepEqual(result.provenance.readSet, fixture.frame.readSet);
  assert.equal(canonicalJson(fixture.unit), original);
  assert.deepEqual(fixture.output.bytes, bytes);
});

test("rejects corrupted bytes even when the old artifact receipt and byte count are unchanged", async () => {
  // Given same-length corruption that receipt-only validation cannot detect.
  const fixture = await outputVerificationFixture();
  const bytes = fixture.output.bytes.slice();
  const first = bytes[0];
  assert.ok(first !== undefined);
  bytes[0] = first ^ 1;
  // When the corrupted payload is checked against original immutable provenance.
  const result = await verifyReuseOutputArtifact(fixture.unit, {
    kind: "present", output: { receipt: fixture.output.receipt, bytes },
  });
  // Then ready status and matching size cannot substitute for actual content integrity.
  assert.deepEqual(result, { kind: "unavailable", unitId: fixture.unit.id, reason: "OUTPUT_CORRUPT" });
});

test("rejects self-consistent replacement bytes and receipt against the original unit binding", async () => {
  // Given new bytes and a new matching receipt that disagree with the retained unit artifact hash.
  const fixture = await outputVerificationFixture();
  const replacement = { replacement: true };
  const bytes = canonicalBytes(replacement);
  const receipt = artifactReceiptSchema.parse({
    ...fixture.output.receipt, hash: await canonicalHash(replacement), bytes: bytes.byteLength,
  });
  // When the replacement tries to attest to its own correctness.
  const result = await verifyReuseOutputArtifact(fixture.unit, { kind: "present", output: { receipt, bytes } });
  // Then the immutable source unit, not the submitted receipt, supplies the expected hash.
  assert.deepEqual(result, { kind: "unavailable", unitId: fixture.unit.id, reason: "OUTPUT_CORRUPT" });
});

test("a ready unit with missing output cannot become reusable from its recorded hash alone", async () => {
  // Given ready metadata but no retained artifact bytes.
  const fixture = await outputVerificationFixture();
  // When storage reports the artifact missing.
  const result = await verifyReuseOutputArtifact(fixture.unit, { kind: "missing" });
  // Then no verified output proof is issued.
  assert.deepEqual(result, { kind: "unavailable", unitId: fixture.unit.id, reason: "OUTPUT_MISSING" });
});

test("a unit without successful ready provenance cannot borrow another successful artifact", async () => {
  // Given pending unit metadata alongside otherwise intact preserved bytes.
  const fixture = await outputVerificationFixture();
  const { provenance: _removed, ...fields } = fixture.unit;
  const pending = unitSchema.parse({ ...fields, status: "pending" });
  // When those bytes are presented as the pending unit's completed output.
  const result = await verifyReuseOutputArtifact(pending, { kind: "present", output: fixture.output });
  // Then artifact presence does not synthesize a successful unit outcome.
  assert.deepEqual(result, { kind: "unavailable", unitId: pending.id, reason: "UNIT_NOT_READY" });
});

test("unknown provider outcome remains unavailable while retained bytes and provenance stay intact", async () => {
  // Given an unresolved effect observation, even though earlier bytes remain available for history.
  const fixture = await outputVerificationFixture();
  const original = canonicalJson({ unit: fixture.unit, receipt: fixture.output.receipt });
  const bytes = fixture.output.bytes.slice();
  // When the unresolved output observation reaches the pure verification gate.
  const result = await verifyReuseOutputArtifact(fixture.unit, {
    kind: "unknown-effect", retainedOutput: fixture.output,
  });
  // Then retained history is not silently upgraded into a confirmed effect or deleted.
  assert.deepEqual(result, { kind: "unavailable", unitId: fixture.unit.id, reason: "UNKNOWN_EFFECT" });
  assert.equal(canonicalJson({ unit: fixture.unit, receipt: fixture.output.receipt }), original);
  assert.deepEqual(fixture.output.bytes, bytes);
});

test("verifies the exact raw binary byte view rather than JSON or surrounding buffer bytes", async () => {
  // Given a binary artifact held as a view inside a larger storage buffer.
  const fixture = await outputVerificationFixture();
  const backing = Uint8Array.of(91, 0, 255, 128, 17, 0, 93);
  const bytes = backing.subarray(1, backing.length - 1);
  const expectedHash = hashSchema.parse(createHash("sha256").update(bytes).digest("hex"));
  const unit = unitSchema.parse({
    ...fixture.unit, provenance: { ...fixture.unit.provenance, outputArtifactHash: expectedHash },
  });
  const receipt = artifactReceiptSchema.parse({
    ...fixture.output.receipt, hash: expectedHash, bytes: bytes.byteLength,
  });
  const original = backing.slice();
  // When raw storage bytes are checked against their independently calculated SHA256.
  const result = await verifyReuseOutputArtifact(unit, { kind: "present", output: { receipt, bytes } });
  // Then no JSON conversion, UTF-8 decoding, or inclusion of neighboring bytes can pass.
  assert.equal(result.kind, "verified");
  assert.equal(result.artifact.hash, expectedHash);
  assert.deepEqual(backing, original);
});

test("rejects a stale byte-count receipt even when actual bytes match the unit hash", async () => {
  // Given intact artifact bytes but inconsistent storage size metadata.
  const fixture = await outputVerificationFixture();
  const receipt = artifactReceiptSchema.parse({
    ...fixture.output.receipt, bytes: fixture.output.bytes.byteLength + 1,
  });
  // When that receipt is presented without changing the immutable unit binding.
  const result = await verifyReuseOutputArtifact(fixture.unit, {
    kind: "present", output: { receipt, bytes: fixture.output.bytes },
  });
  // Then verification rejects the inconsistency rather than silently repairing the receipt.
  assert.deepEqual(result, { kind: "unavailable", unitId: fixture.unit.id, reason: "OUTPUT_CORRUPT" });
});
