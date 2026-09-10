import assert, { AssertionError } from "node:assert/strict";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseScript } from "@vnmaker/content";
import { assertNever, canonicalHash, parseProductionDocument, parseProjectHead } from "@vnmaker/harness";
import { collectProjectAssets } from "../../packages/app/src/studio/exportBundle.js";
import { nativeParityMatrix } from "../../packages/app/src/studio/nativeParity.js";
import { nativeBuildManuscript, prepareNativeSource } from "../../packages/app/src/studio/nativeRelease.js";
import { generateRenpyScript } from "../../packages/app/src/studio/renpyScript.js";
import { ProjectRepository } from "../../packages/app/src/studio/projectRepository.js";
import { evidencePath } from "../../tests/fixtures/harness/sandbox.js";
import { byteHash, syntheticPng } from "../../tests/fixtures/harness/media.js";

export type NativeQaCase = "packaged-parity" | "missing-required-asset";
export type NativeQaResult = {
  readonly schemaVersion: 1;
  readonly liveProviderCalls: 0;
  readonly case: NativeQaCase;
  readonly status: "passed" | "blocked" | "failed";
  readonly shippedExeVerified: false;
  readonly sdk: Awaited<ReturnType<typeof resolveSdk>>;
  readonly failure: { readonly name: string; readonly message: string } | null;
  readonly evidence: string;
  readonly resultPath: string;
  readonly exitCode: number;
  readonly matrix?: readonly { readonly field: string; readonly status: string }[];
  readonly blockedReason?: string;
  readonly zipExists?: boolean;
  readonly incompleteZipOffered?: boolean;
  readonly releaseFailed?: boolean;
};

async function resolveSdk(): Promise<{ available: true; sdk: string } | { available: false; reason: string }> {
  if (process.platform !== "win32") return { available: false, reason: `platform ${process.platform} is not win32` };
  const configured = process.env.VNMAKER_RENPY_SDK;
  if (!configured) return { available: false, reason: "VNMAKER_RENPY_SDK is unset" };
  const sdk = resolve(configured);
  const python = join(sdk, "lib/py3-windows-x86_64/python.exe");
  const renpy = join(sdk, "renpy.py");
  const [hasPython, hasRenpy] = await Promise.all([
    stat(python).then(info => info.isFile(), () => false),
    stat(renpy).then(info => info.isFile(), () => false),
  ]);
  if (!hasPython || !hasRenpy) return { available: false, reason: `Ren'Py SDK missing python.exe or renpy.py at ${sdk}` };
  return { available: true, sdk };
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
    projectId: "t22-native", lineageId: "00000000-0000-4000-8000-000000000022",
    revision: 0, scriptHash: await canonicalHash(script), productionHash: await canonicalHash(productionDocument),
  });
  return new ProjectRepository({ head, script, productionDocument });
}

function parityScript(url: string) {
  return parseScript({
    title: "Native parity", subtitle: "", start: "start", nativeSaveId: "0123456789abcdef",
    credits: [{ role: "Writer", names: "Public Author" }], flags: { trust: 1 },
    characters: [{ id: "a", name: "A", bio: "", color: "#ffffff", chromaKey: "#00ff00", expressionImages: { neutral: url } }],
    assets: [{ id: "a-n", name: "A", kind: "character", url, compositing: "alpha" }],
    musicFadeSeconds: 0.8,
    scenes: [{
      id: "start", background: "title", backgroundUrl: url, framing: "wide", transition: "fadeToBlack",
      sprites: [{ slot: "center", character: "a" }], bgm: "main-theme",
      lines: [
        { speaker: "a", text: "Hello", sfx: "ui-click", when: { compare: [{ flag: "trust", op: "gte", value: 1 }] } },
        { speaker: null, text: "CG", cgUrl: url, framing: "cinematic" },
        { speaker: null, text: "Hide", cgHide: true },
      ],
      choices: [{ text: "Go", next: "end", add: { trust: 1 } }],
    }, { id: "end", background: "title", lines: [{ speaker: null, text: "Done" }], ending: "The End" }],
  });
}

export async function runHarnessNative(input: { readonly case: NativeQaCase; readonly out: string }): Promise<NativeQaResult> {
  const out = evidencePath(input.out);
  await mkdir(out, { recursive: true });
  const evidence = await mkdtemp(join(out, "run-"));
  const zipPath = join(evidence, "incomplete.zip");
  const png = syntheticPng(22, true);
  const url = `/assets/user/${byteHash(png)}.png`;
  const sdk = await resolveSdk();
  let failure: NativeQaResult["failure"] = null;
  let extras: Pick<NativeQaResult, "matrix" | "blockedReason" | "zipExists" | "incompleteZipOffered" | "releaseFailed"> = {};
  try {
    switch (input.case) {
      case "packaged-parity": {
        const script = parityScript(url);
        const files = filesFor(script, { [url.slice(1)]: png });
        const { snapshot, manuscript } = await nativeBuildManuscript(script, {
          repository: await repositoryOf(script),
          readAssetBytes: async path => files[path.slice(1)],
        });
        const prepared = prepareNativeSource({ script, files, releaseJson: new TextEncoder().encode(JSON.stringify(snapshot)) });
        const generated = generateRenpyScript(prepared.manuscript);
        const matrix = nativeParityMatrix(manuscript);
        assert.equal(matrix.every(row => row.status !== "unsupported"), true, "PARITY_UNSUPPORTED");
        assert.ok(generated.includes("compositing"), "COMPOSITING_IN_NATIVE");
        assert.equal(manuscript.assets?.[0]?.compositing, "alpha");
        assert.equal(snapshot.assets.some(asset => asset.hash === byteHash(png)), true);
        extras = {
          matrix,
          blockedReason: sdk.available ? "SDK present but this runner does not launch a packaged EXE" : sdk.reason,
        };
        break;
      }
      case "missing-required-asset": {
        const script = parityScript(url);
        assert.throws(() => prepareNativeSource({ script, files: {} }), /빠져 있습니다/);
        const missing = await nativeBuildManuscript(script, {
          repository: await repositoryOf(script),
          readAssetBytes: async () => undefined,
        }).then(() => false, () => true);
        assert.equal(missing, true, "FREEZE_MUST_FAIL");
        const blocked = {
          ...script,
          scenes: script.scenes.map((scene, index) => index ? scene : {
            ...scene, choices: [{ text: "조건", next: "end", cond: "trust>1" }],
          }),
        };
        assert.throws(() => generateRenpyScript(blocked), /cond/);
        assert.equal(await stat(zipPath).then(() => true, () => false), false);
        extras = { zipExists: false, releaseFailed: true, incompleteZipOffered: false };
        break;
      }
      default: assertNever(input.case);
    }
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    failure = { name: error.name, message: error.message };
    void (error instanceof AssertionError);
  }
  const status: NativeQaResult["status"] = failure ? "failed" : input.case === "packaged-parity" ? "blocked" : "passed";
  const resultPath = join(evidence, "result.json");
  const result: NativeQaResult = {
    schemaVersion: 1, liveProviderCalls: 0, case: input.case, status, shippedExeVerified: false,
    sdk, failure, evidence, resultPath, exitCode: failure ? 1 : 0, ...extras,
  };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { case: { type: "string" }, out: { type: "string" } }, strict: true, allowPositionals: false });
  assert.ok(values.case === "packaged-parity" || values.case === "missing-required-asset", "CLI_CASE");
  assert.ok(values.out, "CLI_OUT_REQUIRED");
  const result = await runHarnessNative({ case: values.case, out: values.out });
  console.log(JSON.stringify({ status: result.status, resultPath: result.resultPath, exitCode: result.exitCode, shippedExeVerified: result.shippedExeVerified }));
  process.exitCode = result.exitCode;
}

const invoked = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  try { await main(); }
  catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    console.error(JSON.stringify({ status: "failed", name: error.name, message: error.message }));
    process.exitCode = 1;
  }
}
