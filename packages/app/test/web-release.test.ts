import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { parseScript, type VnScript } from "@vnmaker/content";
import {
  canonicalHash, HarnessError, parseProductionDocument, parseProjectHead, parseReleaseSnapshot,
} from "@vnmaker/harness";
import { collectProjectAssets } from "../src/studio/exportBundle.js";
import { ProjectRepository } from "../src/studio/projectRepository.js";
import { freezeReleaseSnapshot } from "../src/studio/releaseSnapshot.js";
import {
  buildWebReleaseBundle, parseWebReleaseInput, releaseAssetPath, releaseSaveNamespace,
} from "../src/studio/harness/webRelease.js";
import { crc32 } from "../src/studio/zip.js";

const PRIVATE_CANARIES = [
  "PRIVATE_CANARY_TOKEN_DO_NOT_RELEASE",
  "ya29.OAUTH_TOKEN_CANARY",
  "candidate:release-fixture:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "OPAQUE_PROVIDER_SIGNATURE_CANARY",
  "PRIVATE_REVIEW_RECORD_CANARY",
] as const;
const provenance = {
  creator: "Public Creator",
  source: "Receipt reference",
  license: "CC-BY-4.0",
  credit: "Public credit line",
};
const encoder = new TextEncoder();
const mp3 = encoder.encode("ID3audio-data");
const runtimeJs = encoder.encode("document.body.textContent='standalone';");
const runtimeCss = encoder.encode("body{background:black}");
const runtime = {
  version: 1, entry: "player-test.js", stylesheets: ["style-test.css"],
  files: [
    { path: "player-test.js", size: runtimeJs.length, sha256: createHash("sha256").update(runtimeJs).digest("hex") },
    { path: "style-test.css", size: runtimeCss.length, sha256: createHash("sha256").update(runtimeCss).digest("hex") },
  ],
};

async function sha256Hex(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function deliveryPng(marker: number) {
  const bytes = new Uint8Array(32);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes[24] = marker;
  bytes[25] = 0xce;
  bytes[26] = 0xfa;
  bytes[27] = 0x11;
  return bytes;
}

async function unzip(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 8, true), 0);
    const size = view.getUint32(offset + 18, true);
    const length = view.getUint16(offset + 26, true);
    const extra = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + length));
    const start = offset + 30 + length + extra;
    const body = bytes.slice(start, start + size);
    assert.equal(crc32(body), view.getUint32(offset + 14, true));
    files.set(name, body);
    offset = start + size;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  return files;
}

function runtimeFetch(calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const path = String(input);
    calls.push(path);
    if (path === "/export-runtime/manifest.json") return Response.json(runtime);
    if (path === "/export-runtime/player-test.js") return new Response(runtimeJs);
    if (path === "/export-runtime/style-test.css") return new Response(runtimeCss);
    throw new Error(`unexpected runtime fetch ${path}`);
  }) as typeof fetch;
}

async function pinnedRelease() {
  const userBytes = deliveryPng(0xa1);
  const userHash = await sha256Hex(userBytes);
  const userUrl = `/assets/user/${userHash}.png`;
  const script = parseScript({
    title: "Pinned web release", subtitle: "", start: "start",
    credits: [{ role: "Writer", names: "Public Author" }],
    artDirection: PRIVATE_CANARIES[0], assetLibraryMode: "all", characters: [],
    assets: [{
      id: "bg-user", name: "User background", kind: "background", url: userUrl,
      compositing: "alpha", prompt: PRIVATE_CANARIES[1], provenance, createdAt: PRIVATE_CANARIES[2],
    }],
    scenes: [{
      id: "start", background: "title", backgroundUrl: userUrl, artBrief: PRIVATE_CANARIES[3],
      lines: [{ speaker: null, text: "The atrium is quiet." }],
      choices: [
        { text: "Take the shard", next: "end", set: { shard: true } },
        { text: "Walk away", next: "other" },
      ],
    }, {
      id: "end", background: "title", backgroundUrl: userUrl,
      lines: [{ speaker: null, text: "The shard ending.", when: { all: ["shard"] } }],
      ending: "Oracle ending A",
    }, {
      id: "other", background: "title", backgroundUrl: userUrl,
      lines: [{ speaker: null, text: "The other ending." }],
      ending: "Oracle ending B",
    }],
  });
  const productionDocument = parseProductionDocument({
    version: 1, brief: `${PRIVATE_CANARIES[4]} ${PRIVATE_CANARIES[2]}`,
    castCanon: [], worldTimeline: [], branchFacts: [],
    outline: { title: "Pinned web release", subtitle: "", bible: "", start: "start", scenes: [] },
    artDirection: [], referenceBindings: [],
  });
  const head = parseProjectHead({
    projectId: "release-fixture", lineageId: "00000000-0000-4000-8000-000000000001",
    revision: 0, scriptHash: await canonicalHash(script),
    productionHash: await canonicalHash(productionDocument),
  });
  const repository = new ProjectRepository({ head, script, productionDocument });
  const assets = new Map<string, Uint8Array>();
  for (const path of collectProjectAssets(script)) assets.set(path, path === userUrl ? userBytes : mp3);
  const release = parseReleaseSnapshot(await freezeReleaseSnapshot({
    repository,
    readAssetBytes: async path => assets.get(path),
  }));
  return { release, assets, userBytes, userUrl, script, repository };
}

const preview = {
  kind: "candidate-preview" as const,
  previewId: "00000000-0000-4000-8000-000000000021",
  projectId: "legacy",
  runId: "00000000-0000-4000-8000-000000000022",
  candidateId: "00000000-0000-4000-8000-000000000023",
  candidateRevision: 1,
  sourceHead: {
    projectId: "legacy", lineageId: "00000000-0000-4000-8000-000000000001",
    revision: 0, scriptHash: "a".repeat(64), productionHash: "b".repeat(64),
  },
  snapshotHash: "c".repeat(64),
  entry: { kind: "from-start" as const, sceneId: "ch01-lab" },
  materializedScenes: [{ id: "ch01-lab", background: "title", lines: [{ speaker: null, text: "Lab" }], ending: "Nope" }],
  cast: [], initialFlags: {}, assetBindings: [], boundaries: [], includedUnitHashes: [],
};

test("preview-snapshot-is-preview-not-release", async () => {
  assert.throws(() => parseWebReleaseInput(preview), (error: unknown) => (
    error instanceof HarnessError && error.code === "PREVIEW_NOT_RELEASE"
  ));
  await assert.rejects(
    buildWebReleaseBundle(preview, { assets: new Map(), fetcher: runtimeFetch() }),
    (error: unknown) => error instanceof HarnessError && error.code === "PREVIEW_NOT_RELEASE",
  );
});

test("save-namespace-derives-from-release-id", async () => {
  const { release } = await pinnedRelease();
  const namespace = releaseSaveNamespace(release);
  assert.match(namespace, /^release-[a-f0-9]{16}$/);
  assert.equal(namespace, `release-${release.releaseId.slice(0, 16)}`);
  assert.equal(namespace.startsWith("candidate:"), false);
});

test("root-vs-subpath-asset-path-resolution", async () => {
  const logical = "/assets/user/deadbeef.png";
  assert.equal(releaseAssetPath(logical, "/"), "/assets/user/deadbeef.png");
  assert.equal(releaseAssetPath(logical, "/games/medium/"), "/games/medium/assets/user/deadbeef.png");
  const { release, assets } = await pinnedRelease();
  const bundle = await buildWebReleaseBundle(release, { assets, fetcher: runtimeFetch() });
  const zip = await unzip(bundle.blob);
  const project = JSON.parse(new TextDecoder().decode(zip.get("project.json"))) as VnScript;
  const packed = JSON.stringify(project);
  assert.equal(packed.includes("/games/medium/"), false);
  assert.equal(project.assets?.[0]?.url.startsWith("/assets/"), true);
  assert.equal(new TextDecoder().decode(zip.get("index.html"))?.includes('src="./player-test.js"'), true);
});

test("private-canaries-excluded-from-public-game", async () => {
  const { release, assets, script, repository } = await pinnedRelease();
  const calls: string[] = [];
  const bundle = await buildWebReleaseBundle(release, { assets, fetcher: runtimeFetch(calls) });
  const zip = await unzip(bundle.blob);
  const payload = [...zip.values()].map(bytes => new TextDecoder().decode(bytes)).join("\n");
  for (const canary of PRIVATE_CANARIES) {
    assert.equal(payload.includes(canary), false, canary);
  }
  assert.equal(payload.includes("gateway"), false);
  assert.equal(payload.includes("/api/"), false);
  for (const path of zip.keys()) assert.equal(path.startsWith("api/"), false);
  assert.equal(calls.some(path => path.startsWith("/api/")), false);
  assert.equal(script.assets?.[0]?.prompt, PRIVATE_CANARIES[1]);
  assert.equal(repository.snapshot.productionDocument.brief.includes(PRIVATE_CANARIES[4]), true);
  assert.equal(release.publicScript.assets?.[0]?.prompt, undefined);
  assert.equal(release.publicScript.artDirection, undefined);
});

test("public-script-and-asset-manifest-hash-equals-release", async () => {
  const { release, assets } = await pinnedRelease();
  const bundle = await buildWebReleaseBundle(release, { assets, fetcher: runtimeFetch() });
  const zip = await unzip(bundle.blob);
  const project = parseScript(JSON.parse(new TextDecoder().decode(zip.get("project.json"))));
  const manifest = JSON.parse(new TextDecoder().decode(zip.get("release.json")));
  const frozen = parseReleaseSnapshot(manifest);
  assert.equal(await canonicalHash(project), release.publicScriptHash);
  assert.equal(frozen.publicScriptHash, release.publicScriptHash);
  assert.equal(frozen.releaseId, release.releaseId);
  assert.deepEqual(frozen.assets, release.assets);
  for (const asset of release.assets) {
    const bytes = zip.get(asset.path);
    if (bytes === undefined) assert.fail(`missing ${asset.path}`);
    assert.equal(bytes.byteLength, asset.size);
    assert.equal(await sha256Hex(bytes), asset.hash);
  }
  const bundleManifest = JSON.parse(new TextDecoder().decode(zip.get("bundle.json")));
  assert.equal(bundleManifest.projectNamespace, releaseSaveNamespace(release));
  assert.equal(bundle.projectNamespace, releaseSaveNamespace(release));
});

test("missing-media-detection", async () => {
  const { release, assets, userUrl } = await pinnedRelease();
  const incomplete = new Map(assets);
  incomplete.delete(userUrl);
  await assert.rejects(
    buildWebReleaseBundle(release, { assets: incomplete, fetcher: runtimeFetch() }),
    (error: unknown) => error instanceof Error && error.message.includes("파일") && error.message.includes(userUrl) && error.message.includes("중단"),
  );
});

test("delivery-bytes-and-compositing-preserved", async () => {
  const { release, assets, userBytes, userUrl } = await pinnedRelease();
  const bundle = await buildWebReleaseBundle(release, { assets, fetcher: runtimeFetch() });
  const zip = await unzip(bundle.blob);
  const packed = zip.get(userUrl.slice(1));
  if (packed === undefined) assert.fail("delivery png missing");
  assert.deepEqual(packed, userBytes);
  assert.equal(release.publicScript.assets?.[0]?.compositing, "alpha");
  const project = parseScript(JSON.parse(new TextDecoder().decode(zip.get("project.json"))));
  assert.equal(project.assets?.[0]?.compositing, "alpha");
  assert.equal(project.assets?.[0]?.url, userUrl);
});
