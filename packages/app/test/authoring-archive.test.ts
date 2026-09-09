import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScript } from "@vnmaker/content";
import {
  canonicalHash, createRunCommandSchema, DEFAULT_BUDGET_LIMITS, MEDIUM_MINUTE_LIMITS, MEDIUM_SCENE_LIMITS,
  parseProductionDocument, parseProjectHead, parseProposal,
} from "@vnmaker/harness";
import { classifyAuthority } from "../src/studio/harness/applyProposal.js";
import {
  AUTHORING_FORMAT, AUTHORING_VERSION, LEGACY_MINUTE_LIMITS, LEGACY_SCENE_LIMITS,
  archivedReceiptAuthority, authoringRunDisposition, buildAuthoringArchive, buildImportedDraftCommand,
  identifyArchiveKind, identifyStudioArchive, legacyWithinMediumLowerBound, parseLegacyProductionCheckpoint,
  productionDocumentFromLegacy, readAuthoringArchive,
} from "../src/studio/harness/authoringArchive.js";
import { createZip } from "../src/studio/zip.js";

const UUID = {
  lineage: "00000000-0000-4000-8000-000000000001",
  run: "00000000-0000-4000-8000-000000000002",
  proposal: "00000000-0000-4000-8000-000000000003",
  request: "00000000-0000-4000-8000-000000000005",
} as const;
const png = new Uint8Array(24); png.set([137, 80, 78, 71, 13, 10, 26, 10]);
const mp3 = new TextEncoder().encode("ID3audio-data");
const script = parseScript({
  title: "Authoring manuscript", subtitle: "", start: "start", characters: [],
  scenes: [{ id: "start", background: "title", lines: [{ speaker: null, text: "Kept line" }], ending: "End" }],
});
const productionDocument = parseProductionDocument({
  version: 1, brief: "Authoring settings brief", castCanon: [], worldTimeline: [], branchFacts: [],
  outline: { title: "Authoring manuscript", subtitle: "", bible: "", start: "start", scenes: [] },
  artDirection: [], referenceBindings: [],
});
const sourceHead = parseProjectHead({
  projectId: "source-work", lineageId: UUID.lineage, revision: 2,
  scriptHash: await canonicalHash(script), productionHash: await canonicalHash(productionDocument),
});
const fakeFetch: typeof fetch = async (input) => {
  const path = String(input);
  return new Response(path.endsWith(".mp3") ? mp3 : png);
};

function legacyPlan(sceneCount: number, targetMinutes: number, running = true) {
  const scenes = Array.from({ length: sceneCount }, (_, index) => ({
    id: `scene_${index}`, chapter: "1장", title: `장면 ${index}`, summary: "사건 요약입니다.",
    artDirection: "연출 지시", targetMinutes: 2, background: "title",
    ...(index === sceneCount - 1 ? { ending: "끝" } : { next: `scene_${index + 1}` }),
  }));
  return {
    version: 1 as const, id: "legacy-plan", baseFingerprint: "fp", baseTitle: "Old work",
    characters: [], brief: "이전 작품의 기획입니다.", targetMinutes, charsPerMinute: 320,
    outline: { title: "Old work", subtitle: "설명", bible: "설정집 본문입니다.", start: "scene_0", scenes },
    jobs: Object.fromEntries(scenes.map(scene => [scene.id, { status: running && scene.id === "scene_0" ? "running" : "pending" }])),
    createdAt: 1,
  };
}

test("authoring archive is a versioned envelope separate from a game ZIP", async () => {
  // Given a source head, production document, and a prior-lineage receipt.
  const receipt = {
    receiptId: "00000000-0000-4000-8000-000000000004", projectId: sourceHead.projectId, lineageId: sourceHead.lineageId,
    proposalId: UUID.proposal, proposalDigest: "c".repeat(64), kind: "rejected" as const, baseHead: sourceHead,
    resultHead: null, createdAt: "2026-09-09T00:00:00.000Z",
  };
  const seed = {
    productionDocument, scenes: script.scenes, reviews: [],
    assetManifest: [{ path: "assets/bg/title.png", hash: "d".repeat(64), size: png.byteLength }],
    provenance: "imported" as const,
  };
  // When the authoring ZIP is built and read back.
  const blob = await buildAuthoringArchive({
    script, productionDocument, sourceHead, receipts: [receipt], candidateSnapshot: seed,
  }, { fetcher: fakeFetch });
  const packed = await readAuthoringArchive(blob);
  const names = [...packed.files.keys()];
  // Then the envelope is vnmaker-authoring v1, assets are listed, and a game ZIP marker is absent.
  assert.equal(packed.envelope.format, AUTHORING_FORMAT);
  assert.equal(packed.envelope.version, AUTHORING_VERSION);
  assert.equal(packed.envelope.script.title, script.title);
  assert.equal(packed.envelope.productionDocument.brief, productionDocument.brief);
  assert.equal(packed.envelope.sourceHead.lineageId, sourceHead.lineageId);
  assert.equal(packed.envelope.receipts.length, 1);
  assert.equal(packed.envelope.candidateSnapshot?.provenance, "imported");
  assert.equal(identifyArchiveKind(names), "authoring");
  assert.equal(identifyArchiveKind(["project.json", "assets/bg/title.png"]), "game-zip");
  assert.ok(!names.includes("project.json"));
  assert.ok(names.includes("vnmaker-authoring.json"));
});

test("archived receipts never grant apply authority on a new lineage", async () => {
  // Given a proposal bound to the backup's lineage and a restored head with new ids.
  const body = {
    id: UUID.proposal, runId: UUID.run, baseHead: sourceHead, operations: [],
    requiredAssetHashes: [], contextManifestHash: await canonicalHash("fixture-context"),
    validation: { schema: true, graph: true, assets: true, runtime: true, requiredAssetsMissing: [], issues: [], reviewIds: [] },
  };
  const proposal = parseProposal({ ...body, digest: await canonicalHash(body) });
  const restored = parseProjectHead({
    ...sourceHead, projectId: "restored-work", lineageId: "00000000-0000-4000-8000-000000000099", revision: 0,
  });
  // When authority is classified for the restored work.
  const authority = classifyAuthority(proposal, restored);
  const archived = archivedReceiptAuthority(proposal.baseHead, restored);
  const run = authoringRunDisposition({ kind: "imported-draft" }, false);
  // Then the previous lineage cannot apply and an old run cannot auto-resume.
  assert.equal(authority, "STALE_HEAD");
  assert.equal(archived, "reference");
  assert.equal(run.autoResume, false);
  assert.equal(run.kind, "reference");
});

test("a malformed authoring archive and a game ZIP are rejected without a payload", async () => {
  // Given a truncated authoring JSON and a public game ZIP.
  const broken = createZip([{ path: "vnmaker-authoring.json", bytes: new TextEncoder().encode("{not-json") }]);
  const game = createZip([{ path: "project.json", bytes: new TextEncoder().encode(JSON.stringify(script)) }]);
  // When each file is read as an authoring archive.
  await assert.rejects(() => readAuthoringArchive(broken), /제작 아카이브|JSON|지원하지/);
  await assert.rejects(() => readAuthoringArchive(game), /제작 아카이브|authoring|지원하지/);
  const playerZip = createZip([
    { path: "project.json", bytes: new TextEncoder().encode(JSON.stringify(script)) },
    { path: "index.html", bytes: new TextEncoder().encode("<html></html>") },
  ]);
  // Then identify keeps the game ZIP on its own path even when player files are present.
  assert.equal(identifyArchiveKind(["project.json"]), "game-zip");
  assert.equal(await identifyStudioArchive(playerZip), "game-zip");
});

test("legacy 12-60 scene and 30-240 minute checkpoints are preserved below the medium lower bound", () => {
  // Given healthy old checkpoints that miss the new medium minima.
  const short = parseLegacyProductionCheckpoint(legacyPlan(20, 60));
  const low = parseLegacyProductionCheckpoint(legacyPlan(12, 30));
  const high = parseLegacyProductionCheckpoint(legacyPlan(60, 240));
  const document = productionDocumentFromLegacy(short);
  // When medium lower bounds are compared.
  assert.equal(short.outline.scenes.length < MEDIUM_SCENE_LIMITS.min, true);
  assert.equal(short.targetMinutes < MEDIUM_MINUTE_LIMITS.min, true);
  assert.equal(legacyWithinMediumLowerBound(short), false);
  assert.equal(legacyWithinMediumLowerBound(parseLegacyProductionCheckpoint(legacyPlan(40, 180))), true);
  // Then the legacy parser keeps the work and does not resume running jobs.
  assert.equal(short.targetMinutes, 60);
  assert.equal(short.outline.scenes.length, 20);
  assert.equal(low.outline.scenes.length, LEGACY_SCENE_LIMITS.min);
  assert.equal(high.targetMinutes, LEGACY_MINUTE_LIMITS.max);
  assert.equal(short.jobs["scene_0"]?.status, "pending");
  assert.equal(document.brief, short.brief);
  assert.equal(document.outline.scenes.length, 20);
  assert.throws(() => parseLegacyProductionCheckpoint(legacyPlan(11, 30)), /12|60|레거시|체크포인트/);
  assert.throws(() => parseLegacyProductionCheckpoint(legacyPlan(20, 29)), /30|240|레거시|체크포인트/);
  assert.throws(() => parseLegacyProductionCheckpoint(legacyPlan(61, 60)), /12|60|레거시|체크포인트/);
  assert.throws(() => parseLegacyProductionCheckpoint(legacyPlan(20, 241)), /30|240|레거시|체크포인트/);
});

test("imported-draft commands use the archive hash and imported provenance", async () => {
  // Given a restored seed and a fresh source head.
  const archiveHash = "e".repeat(64);
  const seed = {
    productionDocument, scenes: script.scenes, reviews: [], assetManifest: [], provenance: "imported" as const,
  };
  const restored = parseProjectHead({
    ...sourceHead, projectId: "imported-work", lineageId: "00000000-0000-4000-8000-000000000099", revision: 0,
    scriptHash: await canonicalHash(script), productionHash: await canonicalHash(productionDocument),
  });
  // When the imported-draft body is built.
  const command = buildImportedDraftCommand({
    requestId: UUID.request, sourceHead: restored, script, productionDocument, seed, archiveHash,
  });
  const parsed = createRunCommandSchema.parse(command);
  // Then the run starts idle-ready as imported-draft and cannot carry old budget continuation fields.
  assert.equal(parsed.initialScope, "imported-draft");
  assert.equal(parsed.importedCandidateSeed.provenance, "imported");
  assert.equal(parsed.archiveHash, archiveHash);
  assert.deepEqual(parsed.limits, DEFAULT_BUDGET_LIMITS);
  assert.equal("expectedRunVersion" in parsed, false);
});
