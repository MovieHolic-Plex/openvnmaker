import { parseScript, type VnScript } from "@vnmaker/content";
import { parseReleaseSnapshot, type ReleaseSnapshot } from "@vnmaker/harness";
import { unzipSync } from "fflate";
import { collectProjectAssets } from "./exportBundle.js";
import { nativeExportBlocks, nativeParityMatrix, type NativeParityRow } from "./nativeParity.js";
import { freezeReleaseSnapshot, projectPublicScript, type FreezeReleaseSnapshotInput } from "./releaseSnapshot.js";
import { createZip } from "./zip.js";

export type NativeSource = {
  readonly manuscript: VnScript;
  readonly files: Readonly<Record<string, Uint8Array>>;
  readonly release: ReleaseSnapshot | null;
  readonly parity: readonly NativeParityRow[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isNativeExcludedPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  if (normalized.includes("candidate:")) return true;
  if (normalized.includes("vnmaker:save:preview")) return true;
  if (normalized.split("/").some(part => part === "saves" || part.endsWith(".save"))) return true;
  return /(^|\/)(vn_qa|testcases)\./.test(normalized);
}

export function filterNativeFiles(files: Readonly<Record<string, Uint8Array>>): Record<string, Uint8Array> {
  const kept: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(files)) {
    if (isNativeExcludedPath(path)) continue;
    kept[path] = bytes;
  }
  return kept;
}

export function assertReleaseKind(value: unknown): ReleaseSnapshot {
  if (isRecord(value) && value["kind"] === "candidate-preview") throw new Error("PREVIEW_NOT_RELEASE");
  return parseReleaseSnapshot(value);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifySnapshotBytes(
  snapshot: ReleaseSnapshot,
  files: Readonly<Record<string, Uint8Array>>,
): Promise<void> {
  for (const asset of snapshot.assets) {
    const bytes = files[asset.path];
    if (bytes === undefined) throw new Error(`작품 파일이 빠져 있습니다: /${asset.path}`);
    if (bytes.byteLength !== asset.size) throw new Error(`원본 파일의 내용과 식별자가 다릅니다: /${asset.path}`);
    if (await sha256Hex(bytes) !== asset.hash) throw new Error(`원본 파일의 내용과 식별자가 다릅니다: /${asset.path}`);
  }
}

export async function assertReleaseBytesPresent(archive: Uint8Array, snapshot: ReleaseSnapshot): Promise<void> {
  const files = unzipSync(archive);
  const hashes = new Set<string>();
  for (const [path, bytes] of Object.entries(files)) {
    if (path.endsWith("/")) continue;
    if (isNativeExcludedPath(path)) throw new Error("PREVIEW_SAVE_IN_PACKAGE");
    hashes.add(await sha256Hex(bytes));
  }
  for (const asset of snapshot.assets) {
    if (!hashes.has(asset.hash)) throw new Error(`원본 파일의 내용과 식별자가 다릅니다: /${asset.path}`);
  }
}

export function attachReleaseManifest(archive: Uint8Array, snapshot: ReleaseSnapshot): Blob {
  const files = unzipSync(archive);
  const entries = [];
  for (const [path, bytes] of Object.entries(files)) {
    if (path.endsWith("/")) continue;
    if (isNativeExcludedPath(path)) throw new Error("PREVIEW_SAVE_IN_PACKAGE");
    if (path === "release.json") throw new Error("release.json이 이미 있습니다.");
    entries.push({ path, bytes });
  }
  entries.push({ path: "release.json", bytes: new TextEncoder().encode(JSON.stringify(snapshot)) });
  return createZip(entries);
}

export function prepareNativeSource(input: {
  readonly script: VnScript;
  readonly files: Readonly<Record<string, Uint8Array>>;
  readonly releaseJson?: Uint8Array;
}): NativeSource {
  const encoded = input.releaseJson ?? input.files["release.json"];
  const release = encoded === undefined
    ? null
    : assertReleaseKind(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(encoded)));
  const manuscript = release === null ? projectPublicScript(input.script) : release.publicScript;
  const blocks = nativeExportBlocks(manuscript);
  if (blocks.length > 0) throw new Error(blocks.map(block => block.message).join("\n"));
  if (manuscript.scenes.some(scene => scene.choices?.length && scene.choices.every(choice => choice.disable))) {
    throw new Error("모든 선택지가 잠긴 장면은 내보낼 수 없습니다.");
  }
  const files = filterNativeFiles(input.files);
  if (Object.keys(input.files).some(path => isNativeExcludedPath(path) && input.files[path] !== undefined)) {
    throw new Error("PREVIEW_SAVE_IN_PACKAGE");
  }
  for (const path of collectProjectAssets(manuscript)) {
    if (files[path.slice(1)] === undefined) throw new Error(`작품 파일이 빠져 있습니다: ${path}`);
  }
  return { manuscript, files, release, parity: nativeParityMatrix(manuscript) };
}

export async function nativeBuildManuscript(
  script: VnScript,
  input: FreezeReleaseSnapshotInput,
): Promise<{ readonly snapshot: ReleaseSnapshot; readonly manuscript: VnScript; readonly pinnedSaveId: string }> {
  const snapshot = await freezeReleaseSnapshot(input);
  const blocks = nativeExportBlocks(snapshot.publicScript);
  if (blocks.length > 0) throw new Error(blocks.map(block => block.message).join("\n"));
  const pinnedSaveId = snapshot.publicScript.nativeSaveId ?? script.nativeSaveId ?? crypto.randomUUID().replaceAll("-", "");
  const manuscript = snapshot.publicScript.nativeSaveId !== undefined
    ? snapshot.publicScript
    : parseScript({ ...snapshot.publicScript, nativeSaveId: pinnedSaveId });
  return { snapshot, manuscript, pinnedSaveId };
}

export const NATIVE_BUILD_CLASSIFY = `init python:
    build.classify("game/vn_qa.*", None)
    build.classify("game/testcases.*", None)
    build.classify("tests/**", None)
    build.classify("**/*.save", None)
    build.classify("saves/**", None)
    build.classify("game/saves/**", None)
    build.classify("native-parity.json", None)
`;
