import assert from "node:assert/strict";
import test from "node:test";
import { parseScript } from "@vnmaker/content";
import { canonicalHash, parseProductionDocument, parseProjectHead, parseReleaseSnapshot } from "@vnmaker/harness";
import { EventGate } from "../../../tests/fixtures/harness/barriers.js";
import { collectProjectAssets } from "../src/studio/exportBundle.js";
import { ProjectRepository } from "../src/studio/projectRepository.js";
import { ProjectStorageError, sameHead } from "../src/studio/projects.js";
import { freezeReleaseSnapshot, projectPublicScript } from "../src/studio/releaseSnapshot.js";

const PRIVATE_CANARY = "PRIVATE_CANARY_TOKEN_DO_NOT_RELEASE";
const provenance = {
  creator: "Public Creator",
  source: "Receipt reference",
  license: "CC-BY-4.0",
  credit: "Public credit line",
};

function isProjectStorage(code: "missing" | "damaged" | "stale-head") {
  return (error: unknown) => error instanceof ProjectStorageError && error.code === code;
}

async function sha256Hex(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function flushedFixture() {
  // Opaque CAS payload. The .png suffix only satisfies manuscript URL grammar.
  const userBytes = new Uint8Array([
    0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
    0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x01,
  ]);
  const userHash = await sha256Hex(userBytes);
  const userUrl = `/assets/user/${userHash}.png`;
  const script = parseScript({
    title: "Source", subtitle: "", start: "start",
    credits: [{ role: "Writer", names: "Public Author" }],
    artDirection: PRIVATE_CANARY, assetLibraryMode: "all", characters: [],
    assets: [{
      id: "bg-user", name: "User background", kind: "background", url: userUrl,
      compositing: "alpha", prompt: PRIVATE_CANARY, provenance, createdAt: PRIVATE_CANARY,
    }],
    scenes: [{
      id: "start", background: "title", backgroundUrl: userUrl, artBrief: PRIVATE_CANARY,
      lines: [{ speaker: null, text: "Original" }], ending: "End",
    }],
  });
  const productionDocument = parseProductionDocument({
    version: 1, brief: PRIVATE_CANARY, castCanon: [], worldTimeline: [], branchFacts: [],
    outline: { title: "Source", subtitle: "", bible: "", start: "start", scenes: [] },
    artDirection: [], referenceBindings: [],
  });
  const head = parseProjectHead({
    projectId: "release-fixture", lineageId: "00000000-0000-4000-8000-000000000001",
    revision: 0, scriptHash: await canonicalHash(script),
    productionHash: await canonicalHash(productionDocument),
  });
  const repository = new ProjectRepository({ head, script, productionDocument });
  const bytesByPath = new Map<string, Uint8Array>();
  for (const path of collectProjectAssets(script)) {
    bytesByPath.set(path, path === userUrl ? userBytes : new TextEncoder().encode(path));
  }
  return {
    repository, flushed: repository.snapshot, userBytes, userUrl, bytesByPath,
    readAssetBytes: async (path: string) => bytesByPath.get(path),
  };
}

test("freeze-release-revision:concurrent-edit", async () => {
  // Given a flushed head and an EventGate armed on the asset-byte read.
  const { repository, flushed, bytesByPath } = await flushedFixture();
  using gate = new EventGate();
  const pending = freezeReleaseSnapshot({
    repository,
    readAssetBytes: async path => {
      await gate.pause();
      return bytesByPath.get(path);
    },
  });
  await gate.arrived;
  // When R+1 is staged while freeze is still awaiting bytes.
  repository.stage({ ...flushed.script, title: "Edited R+1" });
  gate.release();
  const frozen = await pending;
  // Then the result remains R, not repository.current.
  assert.equal(frozen.sourceHead.revision, flushed.head.revision);
  assert.equal(frozen.publicScript.title, flushed.script.title);
  assert.notEqual(repository.current.script.title, frozen.publicScript.title);
  assert.equal(repository.snapshot.head.revision, flushed.head.revision);
  assert.equal(sameHead(frozen.sourceHead, flushed.head), true);
  parseReleaseSnapshot(frozen);
});

test("freeze-release-revision:reproducible-digests", async () => {
  const { repository, flushed, bytesByPath, readAssetBytes } = await flushedFixture();
  const first = parseReleaseSnapshot(await freezeReleaseSnapshot({ repository, readAssetBytes }));
  const second = parseReleaseSnapshot(await freezeReleaseSnapshot({ repository, readAssetBytes }));
  assert.equal(first.releaseId, second.releaseId);
  assert.equal(first.publicScriptHash, second.publicScriptHash);
  assert.equal(first.sourceScriptHash, second.sourceScriptHash);
  assert.deepEqual(first.assets, second.assets);
  assert.equal(first.kind, "release");
  assert.equal(first.approval.kind, "manual-export");
  assert.equal(sameHead(first.sourceHead, flushed.head), true);
  assert.equal(first.sourceScriptHash, await canonicalHash(flushed.script));
  assert.equal(first.publicScriptHash, await canonicalHash(first.publicScript));
  assert.notEqual(first.publicScriptHash, first.sourceScriptHash);
  assert.deepEqual(
    first.assets.map(asset => asset.path),
    collectProjectAssets(flushed.script).map(path => path.slice(1)),
  );
  for (const asset of first.assets) {
    const bytes = bytesByPath.get(`/${asset.path}`);
    if (bytes === undefined) assert.fail(`missing ${asset.path}`);
    assert.equal(asset.size, bytes.byteLength);
    assert.equal(asset.hash, await sha256Hex(bytes));
  }
});

test("missing-or-changing-asset:missing-bytes", async () => {
  const { repository, userUrl, bytesByPath } = await flushedFixture();
  await assert.rejects(
    freezeReleaseSnapshot({
      repository,
      readAssetBytes: async path => path === userUrl ? undefined : bytesByPath.get(path),
    }),
    isProjectStorage("missing"),
  );
});

test("missing-or-changing-asset:changed-hash", async () => {
  const { repository, userBytes, userUrl, bytesByPath } = await flushedFixture();
  const replaced = new Uint8Array(userBytes.byteLength);
  replaced.set(userBytes);
  const lastIndex = replaced.byteLength - 1;
  const lastByte = replaced[lastIndex];
  if (lastByte === undefined) assert.fail("opaque payload is empty");
  replaced[lastIndex] = lastByte ^ 0xff;
  await assert.rejects(
    freezeReleaseSnapshot({
      repository,
      readAssetBytes: async path => path === userUrl ? replaced : bytesByPath.get(path),
    }),
    isProjectStorage("damaged"),
  );
});

test("missing-or-changing-asset:unflushed-head", async () => {
  const { repository, flushed, readAssetBytes } = await flushedFixture();
  repository.stage({ ...flushed.script, title: "Edited R+1" });
  await assert.rejects(
    freezeReleaseSnapshot({ repository, readAssetBytes }),
    isProjectStorage("stale-head"),
  );
});

test("missing-or-changing-asset:private-canary", async () => {
  const { repository, flushed, readAssetBytes } = await flushedFixture();
  const raw = await freezeReleaseSnapshot({ repository, readAssetBytes });
  const payload = JSON.stringify(raw);
  assert.equal(typeof payload, "string");
  if (payload === undefined) assert.fail("release payload is missing");
  assert.equal(payload.includes(PRIVATE_CANARY), false);
  const frozen = parseReleaseSnapshot(JSON.parse(payload));
  assert.equal(frozen.publicScript.assets?.[0]?.prompt, undefined);
  assert.equal(frozen.publicScript.assets?.[0]?.createdAt, undefined);
  assert.equal(frozen.publicScript.scenes[0]?.artBrief, undefined);
  assert.equal(frozen.publicScript.artDirection, undefined);
  assert.equal(frozen.publicScript.assetLibraryMode, undefined);
  assert.deepEqual(frozen.publicScript.credits, flushed.script.credits);
  assert.deepEqual(frozen.publicScript.assets?.[0]?.provenance, provenance);
  assert.equal(frozen.publicScript.assets?.[0]?.compositing, "alpha");
  assert.equal(repository.snapshot.script.assets?.[0]?.prompt, PRIVATE_CANARY);
  assert.equal(repository.snapshot.script.scenes[0]?.artBrief, PRIVATE_CANARY);
  assert.equal(repository.snapshot.productionDocument.brief, PRIVATE_CANARY);
});

test("missing-or-changing-asset:unknown-extra-fields", () => {
  const extraCanary = "UNKNOWN_ENUMERABLE_KEY_MUST_DROP";
  const extraKey = "authoringSecret";
  const nestedKey = "privateNote";
  const script = parseScript({
    title: "Source", subtitle: "", start: "start",
    credits: [{ role: "Writer", names: "Public Author" }],
    characters: [],
    assets: [{
      id: "bg-user", name: "User background", kind: "background", url: "/assets/bg/title.png",
      compositing: "alpha", provenance,
    }],
    scenes: [{
      id: "start", background: "title",
      lines: [{ speaker: null, text: "Original" }], ending: "End",
    }],
  });
  const sourceAsset = script.assets?.[0];
  if (sourceAsset === undefined) assert.fail("source asset is missing");
  const input = structuredClone(script);
  const inputAsset = input.assets?.[0];
  if (inputAsset === undefined) assert.fail("copy asset is missing");
  Object.assign(input, { [extraKey]: extraCanary });
  Object.assign(inputAsset, { [nestedKey]: extraCanary });
  const projected = projectPublicScript(input);
  const publicAsset = projected.assets?.[0];
  if (publicAsset === undefined) assert.fail("public asset is missing");
  assert.equal(Object.hasOwn(projected, extraKey), false);
  assert.equal(Object.hasOwn(publicAsset, nestedKey), false);
  assert.equal(JSON.stringify(projected).includes(extraCanary), false);
  assert.equal(Object.hasOwn(script, extraKey), false);
  assert.equal(Object.hasOwn(sourceAsset, nestedKey), false);
  assert.equal(Object.hasOwn(input, extraKey), true);
  assert.equal(Object.hasOwn(inputAsset, nestedKey), true);
});
