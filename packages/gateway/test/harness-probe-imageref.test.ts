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
  observeReferenceEvidence, probeReferenceImageRequest, requestCarriesReferenceInput,
} from "../src/cca/capability-evidence.js";
import { mapModels } from "../src/cca/client.js";
import { buildImageRequest } from "../src/cca/images.js";
import { UpstreamError } from "../src/http.js";
import { readArray, readObject } from "../src/cca/production-util.js";
import { runAuthorizedProbe } from "../tools/harness-probe.js";

const HASH = /^[a-f0-9]{64}$/;
const dirs: string[] = [];
after(async () => { await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))); });

async function tempOut(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vnmaker-imageref-"));
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

const echo1 = sse([{ functionCall: { name: "echo", args: { value: "vnmaker-capability-probe" }, id: "c1" }, thoughtSignature: "sig" }]);
const echo2 = sse([{ text: "vnmaker-capability-probe" }]);
const withBytes = sse([{ inlineData: { mimeType: "image/png", data: "AAAB" } }]);
const noBytes = sse([{ text: "no image" }]);

function imageReply(body: unknown, reference: string, generated: string): string {
  const rec = readObject(body);
  if (rec?.["model"] === PRODUCTION_IMAGE_MODEL_ID) {
    return requestCarriesReferenceInput(body) ? reference : generated;
  }
  if (rec?.["requestId"] === "probe-echo-1") return echo1;
  return echo2;
}

async function runProbe(
  out: string, authorizeImages: number, postSse: (body: unknown) => Promise<string>,
): Promise<Record<string, unknown>> {
  await runAuthorizedProbe(
    { authorizeText: 3, authorizeImages, tokenPolicy: "bounded-payload", out },
    {
      store: store(), fetchModels: async () => ({ models: catalogue() }),
      now: () => new Date("2026-09-09T00:00:00.000Z"),
      postSse: async (_token, body) => postSse(body),
    },
  );
  return readJson(join(out, "receipt.json"));
}

test("imageReference evidence requires reference input and image bytes", () => {
  const ref = probeReferenceImageRequest("aicode-consumers").body;
  const bare = buildImageRequest({ prompt: "p", projectId: "aicode-consumers" });
  assert.equal(requestCarriesReferenceInput(ref), true);
  assert.equal(requestCarriesReferenceInput(bare), false);
  assert.equal(observeReferenceEvidence(ref, withBytes), true);
  assert.equal(observeReferenceEvidence(ref, noBytes), false);
  assert.equal(observeReferenceEvidence(bare, withBytes), false);
});

test("reference response with image bytes marks imageReference ready", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("fixture probe must not fetch"); });
  const out = await tempOut();
  const receipt = await runProbe(out, 2, async (body) => imageReply(body, withBytes, withBytes));
  const report = readObject(receipt["report"]);
  const imageModel = readObject(report?.["image"]);
  assert.equal(featureStatus(imageModel, "imageOutput"), "ready");
  assert.equal(featureStatus(imageModel, "imageReference"), "ready");
  assert.equal(report?.["productionReady"], true);
  const effects = readArray(JSON.parse(await readFile(join(out, "effects.json"), "utf8")));
  assert.equal(effects.length, 4);
  for (const item of effects) {
    const rec = readObject(item);
    assert.equal(rec?.["state"], "succeeded");
    assert.equal(typeof rec?.["payloadHash"] === "string" && HASH.test(String(rec["payloadHash"])), true);
  }
});

test("reference response with no bytes stays false and reports PROBE_FAILED", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("fixture probe must not fetch"); });
  const out = await tempOut();
  const receipt = await runProbe(out, 2, async (body) => imageReply(body, noBytes, withBytes));
  const report = readObject(receipt["report"]);
  const imageModel = readObject(report?.["image"]);
  assert.equal(featureStatus(imageModel, "imageOutput"), "ready");
  assert.notEqual(featureStatus(imageModel, "imageReference"), "ready");
  assert.equal(featureCode(imageModel, "imageReference"), "PROBE_FAILED");
  assert.equal(report?.["productionReady"], false);
});

test("recorded unknown reference payload blocks a resend", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("fixture probe must not fetch"); });
  const out = await tempOut();
  const payloadHash = sha256Canonical(probeReferenceImageRequest("aicode-consumers").body);
  await writeFile(join(out, "effects.json"), `${JSON.stringify([{ payloadHash, state: "unknown" }], null, 2)}\n`);
  let sent = 0;
  await assert.rejects(() => runProbe(out, 2, async (body) => {
    sent += 1;
    return imageReply(body, withBytes, withBytes);
  }), /UNKNOWN_EFFECT/);
  assert.equal(sent, 3);
});

test("exceeding --authorize-images denies the reference attempt", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("fixture probe must not fetch"); });
  const out = await tempOut();
  let imageSends = 0;
  const receipt = await runProbe(out, 1, async (body) => {
    if (readObject(body)?.["model"] === PRODUCTION_IMAGE_MODEL_ID) imageSends += 1;
    return imageReply(body, withBytes, withBytes);
  });
  const imageModel = readObject(readObject(receipt["report"])?.["image"]);
  assert.equal(imageSends, 1);
  assert.equal(featureStatus(imageModel, "imageOutput"), "ready");
  assert.notEqual(featureStatus(imageModel, "imageReference"), "ready");
  assert.equal(featureCode(imageModel, "imageReference"), "PROBE_FAILED");
  const effects = readArray(JSON.parse(await readFile(join(out, "effects.json"), "utf8")));
  assert.equal(effects.length, 3);
});

test("reference upstream error completes blocked not ready", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("fixture probe must not fetch"); });
  const out = await tempOut();
  const receipt = await runProbe(out, 2, async (body) => {
    if (requestCarriesReferenceInput(body)) throw new UpstreamError("reference unsupported", 400, "no");
    return imageReply(body, withBytes, withBytes);
  });
  const imageModel = readObject(readObject(receipt["report"])?.["image"]);
  assert.equal(receipt["status"], "completed");
  assert.equal(featureStatus(imageModel, "imageOutput"), "ready");
  assert.notEqual(featureStatus(imageModel, "imageReference"), "ready");
  assert.equal(featureCode(imageModel, "imageReference"), "PROBE_FAILED");
});
