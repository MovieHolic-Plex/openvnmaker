import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { wav } from "../../packages/app/test/fixtures/wav.js";
import { createZip } from "../../packages/app/src/studio/zip.js";

test.setTimeout(60_000);

const UUID = {
  proposal: "00000000-0000-4000-8000-000000000013",
  run: "00000000-0000-4000-8000-000000000012",
} as const;

function voiceUrl(bytes: Uint8Array): string {
  return `/assets/user/${createHash("sha256").update(bytes).digest("hex")}.wav`;
}

async function armWindowPromise(page: Page, key: string, event: string, phase?: string) {
  await page.evaluate(({ key, event, phase }) => {
    const pending = Promise.withResolvers<unknown>();
    Object.assign(window, { [key]: pending.promise });
    window.addEventListener(event, function receive(raw: Event) {
      if (phase !== undefined) {
        if (!(raw instanceof CustomEvent)) return;
        const detail: unknown = raw.detail;
        if (typeof detail !== "object" || detail === null || !("phase" in detail) || detail.phase !== phase) return;
        window.removeEventListener(event, receive);
        pending.resolve(detail);
        return;
      }
      window.removeEventListener(event, receive);
      pending.resolve(raw instanceof CustomEvent ? raw.detail : true);
    });
  }, { key, event, phase });
}

function takeWindowPromise(page: Page, key: string) {
  return page.evaluate(key => {
    const value: unknown = Reflect.get(window, key);
    if (value instanceof Promise) return value;
    throw new Error(`${key} was not armed`);
  }, key);
}

async function installSource(page: Page, title: string, brief: string, bytes: Uint8Array) {
  const voice = voiceUrl(bytes);
  const story = {
    title, subtitle: "", start: "s", characters: [],
    scenes: [{ id: "s", background: "title", lines: [{ speaker: null, text: "원본 대사입니다.", voice }], ending: "끝" }],
  };
  const production = {
    version: 1, brief, castCanon: [], worldTimeline: [], branchFacts: [],
    outline: { title, subtitle: "", bible: "", start: "s", scenes: [] },
    artDirection: [], referenceBindings: [],
  };
  await page.goto("/studio.html");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.evaluate(async ({ story, production, voice, bytes }) => {
    const storage: typeof import("../../packages/app/src/storage/projectAssets.js") = await import("/src/storage/projectAssets.ts");
    await storage.ensureAssetServer();
    await storage.storeAssets([{
      path: voice, blob: new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
      originalName: "voice.wav", createdAt: Date.now(),
    }]);
    const projects: typeof import("../../packages/app/src/studio/projects.js") = await import("/src/studio/projects.ts");
    const apply: typeof import("../../packages/app/src/studio/harness/applyProposal.js") = await import("/src/studio/harness/applyProposal.ts");
    const id = crypto.randomUUID();
    await projects.saveProject(id, story);
    projects.activateProject(id, story);
    const repository = await projects.projectRepository.open(id);
    repository.stage(story, apply.parseProductionDocument(production));
    await repository.flushCurrent();
    projects.projectRepository.activate(repository);
  }, { story, production, voice, bytes: [...bytes] });
  await page.reload();
  await expect(page.getByLabel("작품 제목")).toHaveValue(title);
  return { story, production, voice };
}

test("restore-authoring-with-new-lineage", async ({ page, browser }, info) => {
  const bytes = wav(0.3, 440);
  const installed = await installSource(page, "Authoring manuscript", "Authoring settings brief", bytes);
  const source = await page.evaluate(async () => {
    const { projectRepository }: typeof import("../../packages/app/src/studio/projectRepository.js") = await import("/src/studio/projectRepository.ts");
    return projectRepository.current().snapshot;
  });
  await page.evaluate(async ({ production, scenes, voice, size }) => {
    const archive: typeof import("../../packages/app/src/studio/harness/authoringArchive.js") = await import("/src/studio/harness/authoringArchive.ts");
    const apply: typeof import("../../packages/app/src/studio/harness/applyProposal.js") = await import("/src/studio/harness/applyProposal.ts");
    archive.selectAuthoringCandidateSnapshot({
      productionDocument: apply.parseProductionDocument(production),
      scenes, reviews: [],
      assetManifest: [{ path: voice.slice(1), hash: voice.split("/").at(-1)!.split(".")[0]!, size }],
      provenance: "imported",
    });
  }, { production: installed.production, scenes: installed.story.scenes, voice: installed.voice, size: bytes.byteLength });
  await page.getByTestId("project-library").click();
  const downloaded = page.waitForEvent("download");
  await page.getByTestId("authoring-archive-backup").click();
  const zipPath = info.outputPath("authoring.zip");
  await (await downloaded).saveAs(zipPath);
  await page.getByLabel("작품 보관함 닫기").click();
  const origin = new URL(page.url()).origin;
  const fresh = await browser.newContext({ baseURL: origin });
  try {
    const restored = await fresh.newPage();
    await restored.goto("/studio.html");
    await expect(restored.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
    await restored.getByTestId("project-library").click();
    await armWindowPromise(restored, "qaAuthoring", "vnmaker:authoring-restored");
    await restored.getByTestId("authoring-archive-restore").setInputFiles(zipPath);
    const detail = await takeWindowPromise(restored, "qaAuthoring") as {
      sourceHead: { projectId: string; lineageId: string };
      restoredHead: { projectId: string; lineageId: string };
      importedDraft: { provenance: string } | null;
      receiptAuthority: string;
      autoResume: boolean;
    };
    await expect(restored.getByLabel("작품 제목")).toHaveValue(installed.story.title);
    const after = await restored.evaluate(async () => {
      const { projectRepository }: typeof import("../../packages/app/src/studio/projectRepository.js") = await import("/src/studio/projectRepository.ts");
      return projectRepository.current().snapshot;
    });
    expect(after.productionDocument.brief).toBe(installed.production.brief);
    expect(after.head.projectId).not.toBe(source.head.projectId);
    expect(after.head.lineageId).not.toBe(source.head.lineageId);
    expect(detail.restoredHead.lineageId).toBe(after.head.lineageId);
    expect(detail.sourceHead.lineageId).toBe(source.head.lineageId);
    expect(detail.importedDraft?.provenance).toBe("imported");
    expect(detail.receiptAuthority).toBe("reference");
    expect(detail.autoResume).toBe(false);
    const restoredBytes = await restored.evaluate(async voice => [...new Uint8Array(await (await fetch(voice)).arrayBuffer())], installed.voice);
    expect(restoredBytes).toEqual([...bytes]);
    await restored.getByTestId("studio-scene-s").click();
    await expect(restored.getByTestId("studio-line-text")).toHaveValue("원본 대사입니다.");
    await armWindowPromise(restored, "qaFailed", "vnmaker:harness-apply", "failed");
    await restored.evaluate(async ({ title, subtitle, proposalId, runId, baseHead }) => {
      const repoMod: typeof import("../../packages/app/src/studio/projectRepository.js") = await import("/src/studio/projectRepository.ts");
      const applyMod: typeof import("../../packages/app/src/studio/harness/applyProposal.js") = await import("/src/studio/harness/applyProposal.ts");
      const snapshot = repoMod.projectRepository.current().snapshot;
      const script = { ...snapshot.script, title, subtitle };
      const body = {
        id: proposalId, runId, baseHead, operations: [],
        requiredAssetHashes: [], contextManifestHash: await applyMod.canonicalHash("fixture-context"),
        validation: { schema: true, graph: true, assets: true, runtime: true, requiredAssetsMissing: [], issues: [], reviewIds: [] },
      };
      applyMod.stageReviewedProposal({
        proposal: applyMod.parseProposal({ ...body, digest: await applyMod.canonicalHash(body) }),
        script, productionDocument: snapshot.productionDocument, contextHead: snapshot.head, assets: [],
      });
    }, { title: "Hijacked", subtitle: "", proposalId: UUID.proposal, runId: UUID.run, baseHead: source.head });
    await restored.getByTestId("harness-apply").click();
    const failed = await takeWindowPromise(restored, "qaFailed") as { payload: { code: string } };
    expect(failed.payload.code).toBe("STALE_HEAD");
    expect(await restored.getByLabel("작품 제목").inputValue()).toBe(installed.story.title);
    expect(await page.getByLabel("작품 제목").inputValue()).toBe(installed.story.title);
    await restored.screenshot({ path: info.outputPath("restore-authoring-with-new-lineage.png") });
  } finally {
    await fresh.close();
  }
});

test("malformed-and-legacy-checkpoint", async ({ page }, info) => {
  const bytes = wav(0.3, 550);
  const installed = await installSource(page, "Keep original manuscript", "Keep original brief", bytes);
  const before = await page.evaluate(async () => {
    const { projectRepository }: typeof import("../../packages/app/src/studio/projectRepository.js") = await import("/src/studio/projectRepository.ts");
    const { listProjects }: typeof import("../../packages/app/src/studio/projects.js") = await import("/src/studio/projects.ts");
    return { snapshot: projectRepository.current().snapshot, listing: await listProjects(), production: localStorage.getItem("vnmaker.studio.project.v1") };
  });
  await page.evaluate(checkpoint => {
    localStorage.setItem("vnmaker.studio.production.v1", JSON.stringify(checkpoint));
  }, {
    version: 1, id: "other-work", baseFingerprint: "fp", baseTitle: "Other work", characters: [],
    brief: "다른 작품의 전역 체크포인트", targetMinutes: 60, charsPerMinute: 320,
    outline: { title: "Other work", subtitle: "x", bible: "설정", start: "scene_0", scenes: Array.from({ length: 20 }, (_, index) => ({
      id: `scene_${index}`, chapter: "1장", title: `장면 ${index}`, summary: "요약입니다.", artDirection: "연출",
      targetMinutes: 3, background: "title", ...(index === 19 ? { ending: "끝" } : { next: `scene_${index + 1}` }),
    })) },
    jobs: { scene_0: { status: "running" } }, createdAt: 1,
  });
  const broken = createZip([{ path: "vnmaker-authoring.json", bytes: new TextEncoder().encode("{not-json") }]);
  await page.getByTestId("project-library").click();
  await expect(page.getByTestId("legacy-checkpoint-import")).toBeDisabled();
  await page.getByTestId("authoring-archive-restore").setInputFiles({
    name: "broken-authoring.zip", mimeType: "application/zip",
    buffer: Buffer.from(await broken.arrayBuffer()),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  const afterFail = await page.evaluate(async () => {
    const { projectRepository }: typeof import("../../packages/app/src/studio/projectRepository.js") = await import("/src/studio/projectRepository.ts");
    const { listProjects }: typeof import("../../packages/app/src/studio/projects.js") = await import("/src/studio/projects.ts");
    return {
      snapshot: projectRepository.current().snapshot,
      listing: await listProjects(),
      productionKey: localStorage.getItem("vnmaker.studio.production.v1"),
      manuscript: localStorage.getItem("vnmaker.studio.project.v1"),
    };
  });
  expect(afterFail.snapshot.head).toEqual(before.snapshot.head);
  expect(afterFail.snapshot.script.title).toBe(installed.story.title);
  expect(afterFail.snapshot.productionDocument.brief).toBe(installed.production.brief);
  expect(afterFail.listing.projects.map(row => row.id).sort()).toEqual(before.listing.projects.map(row => row.id).sort());
  expect(afterFail.manuscript).toBe(before.production);
  expect(afterFail.productionKey).toContain("다른 작품의 전역 체크포인트");
  const checkpointDownload = page.waitForEvent("download");
  await page.getByTestId("legacy-checkpoint-download").click();
  const checkpointPath = info.outputPath("legacy-checkpoint.json");
  await (await checkpointDownload).saveAs(checkpointPath);
  expect(await readFile(checkpointPath, "utf8")).toContain("다른 작품의 전역 체크포인트");
  await page.getByLabel("작품 보관함 닫기").click();
  const originalDownload = page.waitForEvent("download");
  await page.getByTestId("studio-export").click();
  const originalPath = info.outputPath("original.vn.json");
  await (await originalDownload).saveAs(originalPath);
  expect(JSON.parse(await readFile(originalPath, "utf8")).title).toBe(installed.story.title);
  await expect(page.getByLabel("작품 제목")).toHaveValue(installed.story.title);
  const still = await page.evaluate(async () => {
    const { projectRepository }: typeof import("../../packages/app/src/studio/projectRepository.js") = await import("/src/studio/projectRepository.ts");
    return projectRepository.current().snapshot.productionDocument.brief;
  });
  expect(still).toBe(installed.production.brief);
  await page.screenshot({ path: info.outputPath("malformed-and-legacy-checkpoint.png") });
});
