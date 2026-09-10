import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  encodeRgbaPng, hashBytes, isProposalUsable, runImageEffect,
} from "../../harness/src/index.js";
import type { ImageEffectDeps, ImageEffectRequest, ImageTransportResult } from "../../harness/src/image-effects.js";
import { ArtifactPathError, CandidateArtifactStore, isForbiddenImageUrl, rejectRemoteImageUrl } from "../src/harness/artifacts.js";

const modelId = "gemini-3.1-flash-image";
const target = { kind: "character" as const, characterId: "seorin" as const };

function rgba(width: number, height: number, pixel: (x: number, y: number) => readonly [number, number, number, number]): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = pixel(x, y);
      const index = (y * width + x) * 4;
      bytes[index] = color[0]; bytes[index + 1] = color[1]; bytes[index + 2] = color[2]; bytes[index + 3] = color[3];
    }
  }
  return bytes;
}

function request(effectId: string, prompt: string, references: ImageEffectRequest["references"]): ImageEffectRequest {
  return {
    effectId, modelId, role: "reference", target, privatePrompt: prompt,
    publicProvenance: { creator: "studio", license: "internal-fixture" },
    references, referenceMaxEdge: 4,
  };
}

function depsFor(t: { after: (fn: () => void) => void }, replies: ImageTransportResult[], capability = { imageOutput: "ready" as const, imageReference: "ready" as const }): ImageEffectDeps & { readonly calls: number } {
  const directory = mkdtempSync(join(tmpdir(), "t10-artifacts-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const disk = new CandidateArtifactStore(directory);
  const effects = new Map();
  const state = { calls: 0 };
  return {
    capability,
    transport: {
      async generate() {
        state.calls += 1;
        const reply = replies[state.calls - 1] ?? replies[replies.length - 1];
        if (reply === undefined) throw new Error("missing fixture reply");
        return reply;
      },
    },
    bytes: {
      get: (hash) => disk.get(hash),
      putOriginal: (hash, bytes) => disk.putOriginal(hash, bytes),
      putDelivery: (hash, bytes) => disk.putDelivery(hash, bytes),
    },
    effects: {
      get: async (id) => effects.get(id),
      put: async (id, record) => { effects.set(id, record); },
    },
    get calls() { return state.calls; },
  };
}

test("reference-image-receipt", async (t) => {
  const original = await encodeRgbaPng(8, 4, rgba(8, 4, () => [10, 20, 30, 255]));
  const generated = await encodeRgbaPng(6, 6, rgba(6, 6, () => [200, 40, 40, 255]));
  const originalHash = await hashBytes(original);
  const generatedHash = await hashBytes(generated);
  const effectId = "00000000-0000-4000-8000-000000000010";
  const deps = depsFor(t, [{ kind: "inline", mime: "image/png", bytes: generated }]);
  await deps.bytes.putOriginal(originalHash, original);
  const input = request(effectId, "private reference prompt", [{ bindingId: "ref-seorin-v1", originalHash }]);
  const first = await runImageEffect(input, deps);
  assert.equal(first.kind, "succeeded");
  if (first.kind !== "succeeded") return;
  assert.equal(first.artifact.modelId, modelId);
  assert.equal(first.artifact.originalHash, generatedHash);
  assert.equal(first.artifact.hash, first.artifact.deliveryHash);
  assert.equal(typeof first.artifact.deliveryHash, "string");
  assert.equal(first.artifact.width, 6);
  assert.equal(first.artifact.height, 6);
  assert.equal(first.artifact.bytes, generated.byteLength);
  assert.equal(first.artifact.referenceLineage.length, 1);
  const lineage = first.artifact.referenceLineage[0];
  assert.equal(lineage?.bindingId, "ref-seorin-v1");
  assert.equal(lineage?.originalHash, originalHash);
  assert.notEqual(lineage?.sentHash, lineage?.originalHash);
  assert.equal(first.artifact.proposalUsable, true);
  assert.equal("privatePrompt" in first.artifact, false);
  assert.equal("prompt" in first.artifact, false);
  assert.equal(isProposalUsable(first), true);
  const stored = await deps.bytes.get(first.artifact.originalHash);
  assert.ok(stored);
  assert.deepEqual(stored, generated);
  const callsAfterFirst = deps.calls;
  assert.equal(callsAfterFirst, 1);
  const second = await runImageEffect(input, deps);
  assert.equal(second.kind, "duplicate");
  assert.equal(deps.calls, callsAfterFirst);
  const mismatched = await runImageEffect(request(effectId, "different private prompt", input.references), deps);
  assert.equal(mismatched.kind, "payload-mismatch");
  assert.equal(mismatched.kind === "payload-mismatch" ? mismatched.code : "", "ID_PAYLOAD_CONFLICT");
  assert.equal(deps.calls, callsAfterFirst);
  const blocked = depsFor(t, [{ kind: "inline", mime: "image/png", bytes: generated }], { imageOutput: "ready", imageReference: "blocked" });
  await blocked.bytes.putOriginal(originalHash, original);
  const unsupported = await runImageEffect(request("00000000-0000-4000-8000-000000000011", "p", input.references), blocked);
  assert.equal(unsupported.kind, "unsupported-reference");
  assert.equal(blocked.calls, 0);
  assert.equal(isProposalUsable(unsupported), false);
});

test("unknown-image-outcome", async (t) => {
  const fetches: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    fetches.push(String(input));
    return new Response("nope");
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const effectId = "00000000-0000-4000-8000-000000000012";
  const deps = depsFor(t, [{ kind: "disconnected" }]);
  const lost = await runImageEffect(request(effectId, "after dispatch", []), deps);
  assert.equal(lost.kind, "unknown");
  if (lost.kind === "unknown") {
    assert.equal(lost.reservation.imageAttempts, 1);
    assert.equal(lost.upstreamCalls, 1);
  }
  assert.equal(deps.calls, 1);
  assert.equal(isProposalUsable(lost), false);
  const again = await runImageEffect(request(effectId, "after dispatch", []), deps);
  assert.equal(again.kind, "unknown");
  assert.equal(deps.calls, 1);
  const html = depsFor(t, [{ kind: "inline", mime: "image/png", bytes: new TextEncoder().encode("<!DOCTYPE html><html>") }]);
  const htmlOutcome = await runImageEffect(request("00000000-0000-4000-8000-000000000013", "html", []), html);
  assert.equal(htmlOutcome.kind, "known-failed");
  assert.equal(htmlOutcome.kind === "known-failed" ? htmlOutcome.reason : "", "html");
  const corrupt = depsFor(t, [{ kind: "inline", mime: "image/png", bytes: Uint8Array.from([137, 80, 78, 71, 0, 1, 2]) }]);
  const corruptOutcome = await runImageEffect(request("00000000-0000-4000-8000-000000000014", "corrupt", []), corrupt);
  assert.equal(corruptOutcome.kind, "known-failed");
  assert.equal(corruptOutcome.kind === "known-failed" ? corruptOutcome.reason : "", "corrupt");
  const remote = depsFor(t, [{ kind: "remote-url", url: "https://example.invalid/art.png" }]);
  const remoteOutcome = await runImageEffect(request("00000000-0000-4000-8000-000000000015", "url", []), remote);
  assert.equal(remoteOutcome.kind, "known-failed");
  assert.equal(remoteOutcome.kind === "known-failed" ? remoteOutcome.reason : "", "remote-url");
  assert.equal(fetches.length, 0);
  assert.equal(isForbiddenImageUrl("https://example.invalid/art.png"), true);
  assert.equal(rejectRemoteImageUrl("https://example.invalid/art.png").fetched, 0);
  const travDir = mkdtempSync(join(tmpdir(), "t10-trav-"));
  t.after(() => rmSync(travDir, { recursive: true, force: true }));
  const store = new CandidateArtifactStore(travDir);
  assert.throws(() => store.resolveNamed("../etc/passwd"), error => error instanceof ArtifactPathError && error.code === "traversal");
  assert.throws(() => store.resolveNamed("..\\windows\\system32"), error => error instanceof ArtifactPathError && error.code === "traversal");
});
