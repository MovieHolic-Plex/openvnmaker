import assert from "node:assert/strict";
import test from "node:test";
import { parseScript } from "@vnmaker/content";
import { canonicalHash, parseProductionDocument, parseProjectHead } from "@vnmaker/harness";
import { collectProjectAssets } from "../src/studio/exportBundle.js";
import { nativeIdentity } from "../native-identity.js";
import {
  assertReleaseKind, attachReleaseManifest, filterNativeFiles, isNativeExcludedPath,
  nativeBuildManuscript, NATIVE_BUILD_CLASSIFY, prepareNativeSource, verifySnapshotBytes,
} from "../src/studio/nativeRelease.js";
import { ProjectRepository } from "../src/studio/projectRepository.js";
import { createZip } from "../src/studio/zip.js";
import { generateRenpyScript } from "../src/studio/renpyScript.js";

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function filesFor(script: ReturnType<typeof parseScript>, extra: Record<string, Uint8Array> = {}) {
  const files: Record<string, Uint8Array> = { ...extra };
  for (const path of collectProjectAssets(script)) files[path.slice(1)] ??= new TextEncoder().encode(path);
  return files;
}

async function repositoryOf(script: ReturnType<typeof parseScript>) {
  const productionDocument = parseProductionDocument({
    version: 1, brief: "", castCanon: [], worldTimeline: [], branchFacts: [],
    outline: { title: script.title, subtitle: "", bible: "", start: script.start, scenes: [] },
    artDirection: [], referenceBindings: [],
  });
  const head = parseProjectHead({
    projectId: "native-release", lineageId: "00000000-0000-4000-8000-000000000002",
    revision: 0, scriptHash: await canonicalHash(script), productionHash: await canonicalHash(productionDocument),
  });
  return new ProjectRepository({ head, script, productionDocument });
}

test("preview-snapshot-is-never-a-native-release", () => {
  assert.throws(() => assertReleaseKind({ kind: "candidate-preview" }), /PREVIEW_NOT_RELEASE/);
  assert.equal(isNativeExcludedPath("saves/candidate:p:deadbeef.save"), true);
  assert.equal(isNativeExcludedPath("game/saves/1-1-LT1.save"), true);
  assert.equal(isNativeExcludedPath("assets/art/a.png"), false);
  assert.match(NATIVE_BUILD_CLASSIFY, /\*\*\/\*\.save/);
});

test("missing-asset-and-preview-save-fail-before-a-zip", () => {
  const script = parseScript({
    title: "Missing", subtitle: "", start: "start", characters: [],
    scenes: [{ id: "start", background: "title", lines: [{ speaker: null, text: "Hi" }], ending: "End" }],
  });
  assert.throws(() => prepareNativeSource({ script, files: {} }), /빠져 있습니다/);
  const files = filesFor(script, { "saves/candidate:p:deadbeef.save": new Uint8Array([1]) });
  assert.throws(() => prepareNativeSource({ script, files }), /PREVIEW_SAVE_IN_PACKAGE/);
  assert.equal(Object.keys(filterNativeFiles(files)).some(path => path.includes("saves")), false);
});

test("release-snapshot-pins-public-script-and-identical-bytes", async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const hash = await sha256Hex(png);
  const url = `/assets/user/${hash}.png`;
  const script = parseScript({
    title: "Pinned", subtitle: "", start: "start", nativeSaveId: "0123456789abcdef",
    artDirection: "secret-brief",
    characters: [{ id: "a", name: "A", bio: "", color: "#ffffff", chromaKey: "#00ff00", expressionImages: { neutral: url } }],
    assets: [{ id: "a-n", name: "A", kind: "character", url, compositing: "alpha", prompt: "secret-brief" }],
    scenes: [{
      id: "start", background: "title", backgroundUrl: url,
      sprites: [{ slot: "center", character: "a" }],
      lines: [{ speaker: "a", text: "Hi" }], ending: "End",
    }],
  });
  const files = filesFor(script, { [url.slice(1)]: png });
  const repository = await repositoryOf(script);
  const { snapshot, manuscript, pinnedSaveId } = await nativeBuildManuscript(script, {
    repository, readAssetBytes: async path => files[path.slice(1)],
  });
  assert.equal(snapshot.kind, "release");
  assert.equal(manuscript.artDirection, undefined);
  assert.equal(manuscript.assets?.[0]?.compositing, "alpha");
  assert.equal(manuscript.assets?.[0]?.prompt, undefined);
  assert.equal(pinnedSaveId, "0123456789abcdef");
  assert.equal(nativeIdentity(manuscript).identity, nativeIdentity(script).identity);
  await verifySnapshotBytes(snapshot, files);
  const prepared = prepareNativeSource({ script, files, releaseJson: new TextEncoder().encode(JSON.stringify(snapshot)) });
  assert.equal(prepared.release?.releaseId, snapshot.releaseId);
  assert.equal(prepared.manuscript.assets?.[0]?.compositing, "alpha");
  const generated = generateRenpyScript(prepared.manuscript);
  assert.ok(generated.includes("compositing"));
  assert.ok(generated.includes("alpha"));
  const archive = new Uint8Array(await createZip(Object.entries(files).map(([path, bytes]) => ({ path, bytes }))).arrayBuffer());
  const withRelease = attachReleaseManifest(archive, snapshot);
  const round = prepareNativeSource({
    script: prepared.manuscript,
    files: { ...files, "release.json": new TextEncoder().encode(JSON.stringify(snapshot)) },
  });
  assert.equal(round.release?.releaseId, snapshot.releaseId);
  assert.ok(withRelease.size > archive.byteLength);
});

test("duplicate-games-keep-separate-save-ids", () => {
  const a = parseScript({ title: "A", subtitle: "", start: "s", nativeSaveId: "aaaaaaaaaaaaaaaa", characters: [], scenes: [{ id: "s", background: "title", lines: [{ speaker: null, text: "a" }], ending: "A" }] });
  const b = parseScript({ title: "A", subtitle: "", start: "s", nativeSaveId: "bbbbbbbbbbbbbbbb", characters: [], scenes: [{ id: "s", background: "title", lines: [{ speaker: null, text: "a" }], ending: "A" }] });
  assert.notEqual(nativeIdentity(a).identity, nativeIdentity(b).identity);
  assert.equal(nativeIdentity(a).identity, nativeIdentity({ ...a, title: "Updated" }).identity);
});
