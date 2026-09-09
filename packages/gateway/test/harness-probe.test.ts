import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createMemoryStore } from "../src/auth/credentials.js";
import {
  PRODUCTION_IMAGE_MODEL_ID, PRODUCTION_TEXT_MODEL_ID, sha256Canonical,
} from "../src/cca/capabilities.js";
import {
  assertUnknownRequestNotResent, buildObservedProof, observeSsePayload,
} from "../src/cca/capability-evidence.js";
import { mapModels } from "../src/cca/client.js";
import { readArray, readObject } from "../src/cca/production-util.js";
import {
  admitProbeGuards, echoRequest, runAuthorizedProbe,
} from "../tools/harness-probe.js";

const HASH = /^[a-f0-9]{64}$/;
const OBSERVED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const dirs: string[] = [];
after(async () => { await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))); });

async function tempOut(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vnmaker-probe-"));
  dirs.push(dir);
  return dir;
}

function sse(parts: readonly Record<string, unknown>[]): string {
  return `data: ${JSON.stringify({ response: { candidates: [{ content: { parts } }] } })}\n\n`;
}

function catalogue() {
  return mapModels({
    [PRODUCTION_TEXT_MODEL_ID]: { supportsImages: true, quotaInfo: { remainingFraction: 1 } },
    [PRODUCTION_IMAGE_MODEL_ID]: { supportsImages: false, quotaInfo: { remainingFraction: 1 } },
  });
}

function store() {
  return createMemoryStore({
    refresh: "r", access: "fixture-access", expires: Date.now() + 600_000,
    projectId: "aicode-consumers", email: "hyeonseokoh94ultra@gmail.com",
  });
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const rec = readObject(JSON.parse(await readFile(path, "utf8")));
  if (rec === undefined) throw new Error("INVALID_INPUT");
  return rec;
}

function featureStatus(model: unknown, key: string): string | null {
  const status = readObject(readObject(model)?.[key])?.["status"];
  return typeof status === "string" ? status : null;
}

function featureCode(model: unknown, key: string): string | null {
  const code = readObject(readObject(readObject(model)?.[key])?.["block"])?.["code"];
  return typeof code === "string" ? code : null;
}

test("unknown tokenCheck is never PASS", () => {
  const coerced = admitProbeGuards({
    textContextBytes: 10, wireBodyBytes: 10, images: [], authorizeText: 1, authorizeImages: 0,
    reservedText: 1, reservedImages: 0, tokenCheck: "pass", policy: "exact-only",
  });
  assert.notEqual(coerced.tokenCheck, "pass");
  assert.equal(coerced.allowed, false);
  const bounded = admitProbeGuards({
    textContextBytes: 10, wireBodyBytes: 10, images: [], authorizeText: 1, authorizeImages: 1,
    reservedText: 1, reservedImages: 0, tokenCheck: "unknown", policy: "bounded-payload",
  });
  assert.equal(bounded.tokenCheck, "unknown");
  assert.notEqual(bounded.tokenCheck, "pass");
  assert.equal(bounded.allowed, true);
});

test("recorded unknown effect blocks a resend", () => {
  const hash = "a".repeat(64);
  assert.throws(() => assertUnknownRequestNotResent([{ payloadHash: hash, state: "unknown" }], hash), /UNKNOWN_EFFECT/);
  assert.throws(() => assertUnknownRequestNotResent([{ payloadHash: hash, state: "dispatched" }], hash), /UNKNOWN_EFFECT/);
  assert.doesNotThrow(() => assertUnknownRequestNotResent([{ payloadHash: hash, state: "succeeded" }], hash));
  assert.doesNotThrow(() => assertUnknownRequestNotResent([{ payloadHash: hash, state: "known-failed" }], hash));
});

test("image bytes absent keeps imageOutput false", () => {
  assert.equal(observeSsePayload(sse([{ text: "no image" }])).imageOutput, false);
  assert.equal(observeSsePayload(sse([{ inlineData: { mimeType: "image/png", data: "" } }])).imageOutput, false);
  assert.equal(observeSsePayload(sse([{ inlineData: { mimeType: "image/png", data: "AAAB" } }])).imageOutput, true);
  assert.equal(observeSsePayload(sse([{ functionCall: { name: "echo" } }])).tools, true);
  assert.equal(observeSsePayload(sse([{ text: "hello" }])).text, true);
});

test("fixture probe records proofs, effects, and ready features without fetch", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("fixture probe must not fetch"); });
  const out = await tempOut();
  const echo1 = sse([{ functionCall: { name: "echo", args: { value: "vnmaker-capability-probe" }, id: "c1" }, thoughtSignature: "sig" }]);
  const echo2 = sse([{ text: "vnmaker-capability-probe" }]);
  const image = sse([{ inlineData: { mimeType: "image/png", data: "AAAB" } }]);
  await runAuthorizedProbe(
    { authorizeText: 3, authorizeImages: 2, tokenPolicy: "bounded-payload", out },
    {
      store: store(), fetchModels: async () => ({ models: catalogue() }), now: () => new Date("2026-09-09T00:00:00.000Z"),
      postSse: async (_token, body) => {
        const rec = readObject(body);
        if (rec?.["model"] === PRODUCTION_IMAGE_MODEL_ID) return image;
        if (rec?.["requestId"] === "probe-echo-1") return echo1;
        return echo2;
      },
    },
  );
  const receipt = await readJson(join(out, "receipt.json"));
  const report = readObject(receipt["report"]);
  const text = readObject(report?.["text"]);
  const imageModel = readObject(report?.["image"]);
  assert.equal(receipt["status"], "completed");
  assert.equal(receipt["liveVerification"], "performed");
  assert.equal(report?.["liveVerification"], "performed");
  assert.equal(receipt["tokenCheck"], "unknown");
  assert.notEqual(receipt["tokenCheck"], "pass");
  assert.equal(featureStatus(text, "text"), "ready");
  assert.equal(featureStatus(text, "tools"), "ready");
  assert.equal(featureCode(text, "imageOutput"), "VISION_ONLY");
  assert.equal(featureCode(text, "imageReference"), "VISION_ONLY");
  assert.equal(featureCode(imageModel, "text"), "CONFIG_MODEL_MISMATCH");
  assert.equal(featureCode(imageModel, "tools"), "CONFIG_MODEL_MISMATCH");
  assert.equal(featureStatus(imageModel, "imageOutput"), "ready");
  assert.equal(featureStatus(imageModel, "imageReference"), "ready");
  assert.equal(report?.["productionReady"], true);
  const proofs = readArray(receipt["proofs"]);
  assert.equal(proofs.length, 2);
  for (const item of proofs) {
    const proof = readObject(item);
    assert.equal(typeof proof?.["evidenceHash"] === "string" && HASH.test(proof["evidenceHash"]), true);
    assert.equal(typeof proof?.["observedAt"] === "string" && OBSERVED.test(proof["observedAt"]), true);
  }
  const effectsRaw = JSON.parse(await readFile(join(out, "effects.json"), "utf8"));
  assert.equal(Array.isArray(effectsRaw), true);
  const effects = readArray(effectsRaw);
  assert.equal(effects.length, 4);
  for (const item of effects) {
    const rec = readObject(item);
    assert.equal(rec?.["state"], "succeeded");
    assert.equal(typeof rec?.["payloadHash"] === "string" && HASH.test(rec["payloadHash"]), true);
  }
});

test("image response without bytes does not mark imageOutput ready", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("fixture probe must not fetch"); });
  const out = await tempOut();
  await runAuthorizedProbe(
    { authorizeText: 1, authorizeImages: 1, tokenPolicy: "bounded-payload", out },
    {
      store: store(), fetchModels: async () => ({ models: catalogue() }),
      postSse: async (_token, body) => {
        const rec = readObject(body);
        if (rec?.["model"] === PRODUCTION_IMAGE_MODEL_ID) return sse([{ text: "no bytes" }]);
        if (rec?.["requestId"] === "probe-echo-1") return sse([{ functionCall: { name: "echo" } }]);
        return sse([{ text: "ok" }]);
      },
    },
  );
  const report = readObject((await readJson(join(out, "receipt.json")))["report"]);
  assert.notEqual(featureStatus(readObject(report?.["image"]), "imageOutput"), "ready");
  assert.equal(featureCode(readObject(report?.["image"]), "imageOutput"), "PROBE_FAILED");
});

test("seeded unknown effect blocks a probe resend", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("fixture probe must not fetch"); });
  const out = await tempOut();
  const payloadHash = sha256Canonical(echoRequest("aicode-consumers", "probe-echo-1"));
  await writeFile(join(out, "effects.json"), `${JSON.stringify([{ payloadHash, state: "unknown" }], null, 2)}\n`);
  let sent = 0;
  await assert.rejects(() => runAuthorizedProbe(
    { authorizeText: 1, authorizeImages: 0, tokenPolicy: "bounded-payload", out },
    {
      store: store(), fetchModels: async () => ({ models: catalogue() }),
      postSse: async () => { sent += 1; return sse([{ text: "should-not-send" }]); },
    },
  ), /UNKNOWN_EFFECT/);
  assert.equal(sent, 0);
});

test("buildObservedProof only hashes supplied payloads", () => {
  const proof = buildObservedProof({
    modelId: PRODUCTION_TEXT_MODEL_ID, contextHash: "1".repeat(64), observedAt: "2026-09-09T00:00:00.000Z",
    requestBodies: [{ a: 1 }], responsePayloads: ["data: {}\n\n"],
    text: true, tools: false, opaqueRoundtrip: false, imageOutput: false, imageReference: false,
  });
  assert.equal(HASH.test(proof.evidenceHash), true);
  assert.deepEqual(proof.requestHashes, [sha256Canonical({ a: 1 })]);
  assert.deepEqual(proof.responseHashes, [sha256Canonical("data: {}\n\n")]);
  assert.equal(proof.text, true);
  assert.equal(proof.tools, false);
});
