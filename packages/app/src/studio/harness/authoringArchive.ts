import { unzip } from "fflate";
import { parseScript, type VnScript } from "@vnmaker/content";
import {
  assertNever, createRunCommandSchema, DEFAULT_BUDGET_LIMITS, hashSchema, importedCandidateSeedSchema,
  MEDIUM_MINUTE_LIMITS, MEDIUM_SCENE_LIMITS, parseDecisionReceipt, parseDto, parseProductionDocument, parseProjectHead,
  type CreateRunCommand, type DecisionReceipt, type ImportedCandidateSeed, type ProductionDocument, type ProjectHead, type Sha256,
} from "@vnmaker/harness";
import { collectProjectAssets, rebaseProjectAssets } from "../exportBundle.js";
import { describeAudio, probeAudio } from "../../storage/projectAudio.js";
import { describeImage, ensureAssetServer, storeAssets, type StoredAsset } from "../../storage/projectAssets.js";
import { createZip } from "../zip.js";

export const AUTHORING_FORMAT = "vnmaker-authoring" as const;
export const AUTHORING_VERSION = 1 as const;
export const AUTHORING_EVENT = "vnmaker:authoring-restored";
export const LEGACY_SCENE_LIMITS = { min: 12, max: 60 } as const;
export const LEGACY_MINUTE_LIMITS = { min: 30, max: 240 } as const;
const MAX_ZIP = 512 * 1024 * 1024, MAX_JSON = 8 * 1024 * 1024, MAX_FILE = 64 * 1024 * 1024;
export type AssetManifestEntry = { readonly path: string; readonly size: number; readonly sha256: string };
export type AuthoringEnvelope = {
  readonly format: typeof AUTHORING_FORMAT; readonly version: typeof AUTHORING_VERSION; readonly sourceHead: ProjectHead;
  readonly script: VnScript; readonly productionDocument: ProductionDocument; readonly assetManifest: readonly AssetManifestEntry[];
  readonly receipts: readonly DecisionReceipt[]; readonly candidateSnapshot: ImportedCandidateSeed | null;
  readonly runRecord: { readonly kind: "reference" };
};
export type AuthoringBackupInput = {
  readonly script: VnScript; readonly productionDocument: ProductionDocument; readonly sourceHead: ProjectHead;
  readonly receipts: readonly DecisionReceipt[]; readonly candidateSnapshot?: ImportedCandidateSeed | null;
};
export type AuthoringRestorePayload = {
  readonly script: VnScript; readonly productionDocument: ProductionDocument; readonly sourceHead: ProjectHead;
  readonly archiveHash: Sha256; readonly receipts: readonly DecisionReceipt[]; readonly candidateSnapshot: ImportedCandidateSeed | null;
};
export type AuthoringRestoredDetail = {
  readonly sourceHead: ProjectHead; readonly restoredHead: ProjectHead; readonly archiveHash: Sha256;
  readonly importedDraft: ImportedCandidateSeed | null; readonly receiptAuthority: "reference"; readonly autoResume: false;
};
export type LegacySceneBeat = {
  readonly id: string; readonly chapter: string; readonly title: string; readonly summary: string; readonly artDirection: string;
  readonly targetMinutes: number; readonly background: string; readonly next?: string; readonly ending?: string;
};
export type LegacyProductionCheckpoint = {
  readonly version: 1; readonly id: string; readonly brief: string; readonly targetMinutes: number; readonly charsPerMinute: number;
  readonly outline: { readonly title: string; readonly subtitle: string; readonly bible: string; readonly start: string; readonly scenes: readonly LegacySceneBeat[] };
  readonly jobs: Readonly<Record<string, { readonly status: "pending" | "ready" | "short" | "error" }>>;
};
type ArchiveKind = "authoring" | "game-zip" | "unknown";
let selectedCandidate: ImportedCandidateSeed | null = null;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const safeAssetPath = (path: string) => /^assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp|mp3|ogg|wav)$/.test(path);
const zipPathSafe = (name: string) => !name.startsWith("/") && !name.includes("\\") && !name.includes("\0") && !name.split("/").some(part => part === "" || part === "." || part === "..");
async function digest(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", copy)), byte => byte.toString(16).padStart(2, "0")).join("");
}
function blobOf(bytes: Uint8Array): Blob { const copy = new Uint8Array(bytes.byteLength); copy.set(bytes); return new Blob([copy]); }
export function identifyArchiveKind(names: readonly string[]): ArchiveKind {
  const authoring = names.includes("vnmaker-authoring.json"), game = names.includes("project.json");
  if (authoring && !game) return "authoring"; if (game && !authoring) return "game-zip"; return "unknown";
}
export function selectAuthoringCandidateSnapshot(seed: ImportedCandidateSeed | null): void {
  selectedCandidate = seed === null ? null : parseDto(importedCandidateSeedSchema, seed);
}
export function getSelectedAuthoringCandidate(): ImportedCandidateSeed | null { return selectedCandidate; }
export function archivedReceiptAuthority(_from: ProjectHead, _to: ProjectHead): "reference" { return "reference"; }
export function authoringRunDisposition(record: { readonly kind: "reference" } | { readonly kind: "imported-draft" }, hasDbRunState: boolean): { readonly kind: "reference"; readonly autoResume: false } {
  switch (record.kind) { case "reference": case "imported-draft": break; default: return assertNever(record); }
  void hasDbRunState; return { kind: "reference", autoResume: false };
}
export function emitAuthoringRestored(detail: AuthoringRestoredDetail): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(AUTHORING_EVENT, { detail }));
}
export function legacyWithinMediumLowerBound(checkpoint: LegacyProductionCheckpoint): boolean {
  return checkpoint.outline.scenes.length >= MEDIUM_SCENE_LIMITS.min && checkpoint.targetMinutes >= MEDIUM_MINUTE_LIMITS.min;
}
export function buildImportedDraftCommand(input: {
  readonly requestId: string; readonly sourceHead: ProjectHead; readonly script: VnScript;
  readonly productionDocument: ProductionDocument; readonly seed: ImportedCandidateSeed; readonly archiveHash: string;
}): CreateRunCommand {
  return createRunCommandSchema.parse({
    requestId: input.requestId, sourceHead: input.sourceHead, script: input.script, productionDocument: input.productionDocument,
    limits: DEFAULT_BUDGET_LIMITS, tokenPolicy: "exact-only", initialScope: "imported-draft",
    importedCandidateSeed: input.seed, archiveHash: input.archiveHash,
  });
}
async function unzipArchive(file: Blob): Promise<Map<string, Uint8Array>> {
  if (!file.size || file.size > MAX_ZIP) throw new Error("제작 아카이브는 512MB 이하입니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    let total = 0, count = 0; const names = new Set<string>();
    try {
      unzip(bytes, { filter(entry) {
        if (++count > 12000 || names.has(entry.name) || !zipPathSafe(entry.name)) throw new Error("안전하지 않은 ZIP 경로입니다.");
        names.add(entry.name);
        const wanted = entry.name === "vnmaker-authoring.json" || entry.name === "project.json" || safeAssetPath(entry.name);
        if (!wanted) return false; total += entry.originalSize;
        if (!Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0 || entry.originalSize > MAX_FILE || total > MAX_ZIP) throw new Error("제작 아카이브 크기 제한을 초과했습니다.");
        if (entry.name === "vnmaker-authoring.json" && entry.originalSize > MAX_JSON) throw new Error("제작 아카이브 목록이 너무 큽니다.");
        return true;
      } }, (error, result) => error ? reject(error) : resolve(result));
    } catch (error) { reject(error); }
  });
  return new Map(Object.entries(files));
}
function parseAuthoringEnvelope(value: unknown): AuthoringEnvelope {
  if (!isRecord(value) || value["format"] !== AUTHORING_FORMAT || value["version"] !== AUTHORING_VERSION) throw new Error("지원하지 않는 제작 아카이브입니다.");
  const manifestRaw = value["assetManifest"], receiptsRaw = value["receipts"], runRaw = value["runRecord"];
  if (!Array.isArray(manifestRaw) || manifestRaw.length > 12000) throw new Error("손상된 제작 파일 목록입니다.");
  if (!Array.isArray(receiptsRaw) || !isRecord(runRaw) || runRaw["kind"] !== "reference") throw new Error("손상된 영수증 또는 작업 원장입니다.");
  const seen = new Set<string>();
  const assetManifest = manifestRaw.map((entry): AssetManifestEntry => {
    if (!isRecord(entry)) throw new Error("손상된 제작 파일 목록입니다.");
    const size = entry["size"], sha256 = entry["sha256"], path = entry["path"];
    if (typeof path !== "string" || !safeAssetPath(path) || seen.has(path) || typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("손상된 제작 파일 목록입니다.");
    seen.add(path); return { path, size, sha256 };
  });
  const candidateRaw = value["candidateSnapshot"];
  return {
    format: AUTHORING_FORMAT, version: AUTHORING_VERSION, sourceHead: parseProjectHead(value["sourceHead"]),
    script: parseScript(value["script"]), productionDocument: parseProductionDocument(value["productionDocument"]),
    assetManifest, receipts: receiptsRaw.map(parseDecisionReceipt), runRecord: { kind: "reference" },
    candidateSnapshot: candidateRaw === null || candidateRaw === undefined ? null : parseDto(importedCandidateSeedSchema, candidateRaw),
  };
}
export async function buildAuthoringArchive(input: AuthoringBackupInput, options: { readonly fetcher?: typeof fetch } = {}): Promise<Blob> {
  const fetcher = options.fetcher ?? fetch, script = parseScript(structuredClone(input.script));
  const productionDocument = parseProductionDocument(input.productionDocument), sourceHead = parseProjectHead(input.sourceHead);
  const receipts = input.receipts.map(parseDecisionReceipt);
  const candidateSnapshot = input.candidateSnapshot === undefined || input.candidateSnapshot === null ? getSelectedAuthoringCandidate() : parseDto(importedCandidateSeedSchema, input.candidateSnapshot);
  const entries: { path: string; bytes: Uint8Array }[] = [], manifest: AssetManifestEntry[] = [], replacements = new Map<string, string>();
  for (const path of collectProjectAssets(script)) {
    const response = await fetcher(path, { cache: "no-store", redirect: "error" });
    if (!response.ok) throw new Error(`파일을 읽지 못했습니다: ${path}`);
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (!buffer.byteLength || buffer.byteLength > MAX_FILE) throw new Error(`파일 크기 제한 초과: ${path}`);
    let relative = path.startsWith("/") ? path.slice(1) : path;
    if (/^\/api\/image\/file\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|webp)$/i.test(path)) {
      const asset = await describeImage(blobOf(buffer)); relative = asset.path.slice(1); replacements.set(path, asset.path);
    }
    if (!safeAssetPath(relative)) throw new Error(`지원하지 않는 작품 경로입니다: ${path}`);
    if (manifest.some(entry => entry.path === relative)) continue;
    const copy = new Uint8Array(buffer.byteLength); copy.set(buffer);
    entries.push({ path: relative, bytes: copy }); manifest.push({ path: relative, size: copy.byteLength, sha256: await digest(copy) });
  }
  const envelope: AuthoringEnvelope = {
    format: AUTHORING_FORMAT, version: AUTHORING_VERSION, sourceHead, script: rebaseProjectAssets(script, replacements),
    productionDocument, assetManifest: manifest, receipts, candidateSnapshot, runRecord: { kind: "reference" },
  };
  const json = new TextEncoder().encode(JSON.stringify(envelope));
  if (json.byteLength > MAX_JSON) throw new Error("제작 아카이브 목록과 원고는 8MB 이하여야 합니다.");
  return createZip([{ path: "vnmaker-authoring.json", bytes: json }, ...entries]);
}
export async function readAuthoringArchive(file: Blob): Promise<{ envelope: AuthoringEnvelope; files: Map<string, Uint8Array>; archiveHash: Sha256 }> {
  const files = await unzipArchive(file), raw = files.get("vnmaker-authoring.json");
  if (raw === undefined) throw new Error("제작 아카이브 목록이 없습니다. 게임 ZIP이 아니라 제작 백업을 선택하세요.");
  if (identifyArchiveKind([...files.keys()]) !== "authoring") throw new Error("지원하지 않는 제작 아카이브입니다.");
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { throw new Error("제작 아카이브 JSON을 읽지 못했습니다."); }
  const envelope = parseAuthoringEnvelope(parsed);
  for (const entry of envelope.assetManifest) {
    const bytes = files.get(entry.path);
    if (bytes === undefined || bytes.byteLength !== entry.size || await digest(bytes) !== entry.sha256) throw new Error(`파일이 변경되거나 손상되었습니다: ${entry.path}`);
  }
  return { envelope, files, archiveHash: hashSchema.parse(await digest(raw)) };
}
export async function restoreAuthoringArchive(file: Blob, fetcher: typeof fetch = fetch): Promise<AuthoringRestorePayload> {
  const { envelope, files, archiveHash } = await readAuthoringArchive(file);
  const expected = new Set(collectProjectAssets(envelope.script).map(path => path.slice(1)));
  if (expected.size !== envelope.assetManifest.length || envelope.assetManifest.some(entry => !expected.has(entry.path))) throw new Error("작품에 필요한 파일이 목록에서 빠져 있습니다.");
  const assets: StoredAsset[] = [], replacements = new Map<string, string>();
  for (const path of collectProjectAssets(envelope.script)) {
    const relative = path.slice(1), stored = files.get(relative);
    if (stored === undefined) throw new Error(`작품 파일이 빠져 있습니다: ${path}`);
    const copy = new Uint8Array(stored.byteLength); copy.set(stored);
    if (/\.(png|jpg|jpeg|webp)$/i.test(path)) {
      const asset = await describeImage(blobOf(copy));
      if (path.startsWith("/assets/user/") && asset.path !== path) throw new Error(`원화 파일의 내용과 식별자가 다릅니다: ${path}`);
      const bitmap = await createImageBitmap(asset.blob).catch(() => { throw new Error(`손상된 원화입니다: ${path}`); });
      const pixels = bitmap.width * bitmap.height; bitmap.close();
      if (pixels > 64_000_000) throw new Error(`원화 해상도 제한을 초과했습니다: ${path}`);
      assets.push({ ...asset, originalName: relative.split("/").pop() ?? relative, createdAt: Date.now() }); replacements.set(path, asset.path);
    } else if (path.startsWith("/assets/user/")) {
      const asset = await describeAudio(blobOf(copy));
      if (asset.path !== path) throw new Error(`음원 파일의 내용과 식별자가 다릅니다: ${path}`);
      await probeAudio(asset.blob); assets.push({ ...asset, originalName: relative.split("/").pop() ?? relative, createdAt: Date.now() });
    } else {
      const response = await fetcher(path, { cache: "no-store", redirect: "error" });
      if (!response.ok || await digest(new Uint8Array(await response.arrayBuffer())) !== await digest(copy)) throw new Error(`이 에디터 버전과 기본 에셋이 다릅니다: ${path}`);
    }
  }
  if (assets.length) { await ensureAssetServer(); await storeAssets(assets); }
  return { script: rebaseProjectAssets(envelope.script, replacements), productionDocument: envelope.productionDocument, sourceHead: envelope.sourceHead, archiveHash, receipts: envelope.receipts, candidateSnapshot: envelope.candidateSnapshot };
}
export async function identifyStudioArchive(file: Blob): Promise<ArchiveKind> {
  try { return identifyArchiveKind([...(await unzipArchive(file)).keys()]); } catch { return "unknown"; }
}
function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`레거시 체크포인트의 ${label}을 확인하세요.`);
  return value.trim();
}
export function parseLegacyProductionCheckpoint(value: unknown): LegacyProductionCheckpoint {
  if (!isRecord(value) || value["version"] !== 1) throw new Error("지원하지 않는 레거시 체크포인트 버전입니다.");
  const targetMinutes = value["targetMinutes"], charsPerMinute = value["charsPerMinute"], outlineRaw = value["outline"];
  if (typeof targetMinutes !== "number" || targetMinutes < LEGACY_MINUTE_LIMITS.min || targetMinutes > LEGACY_MINUTE_LIMITS.max) throw new Error(`레거시 체크포인트의 분량은 ${LEGACY_MINUTE_LIMITS.min}–${LEGACY_MINUTE_LIMITS.max}분이어야 합니다.`);
  if (typeof charsPerMinute !== "number" || charsPerMinute < 120 || charsPerMinute > 800) throw new Error("레거시 체크포인트의 읽기 속도가 올바르지 않습니다.");
  if (!isRecord(outlineRaw) || !Array.isArray(outlineRaw["scenes"])) throw new Error("레거시 체크포인트의 설계가 없습니다.");
  const rows = outlineRaw["scenes"];
  if (rows.length < LEGACY_SCENE_LIMITS.min || rows.length > LEGACY_SCENE_LIMITS.max) throw new Error(`레거시 체크포인트는 ${LEGACY_SCENE_LIMITS.min}–${LEGACY_SCENE_LIMITS.max}개 장면만 보존합니다.`);
  const scenes = rows.map((entry: unknown): LegacySceneBeat => {
    if (!isRecord(entry)) throw new Error("레거시 체크포인트의 장면이 손상되었습니다.");
    const minutes = entry["targetMinutes"];
    if (typeof minutes !== "number" || minutes < 1 || minutes > 12) throw new Error("레거시 체크포인트의 장면 분량이 올바르지 않습니다.");
    return {
      id: requiredText(entry["id"], "씬 ID", 80), chapter: requiredText(entry["chapter"], "챕터", 100),
      title: requiredText(entry["title"], "제목", 100), summary: requiredText(entry["summary"], "요약", 900),
      artDirection: requiredText(entry["artDirection"], "연출", 700), targetMinutes: minutes, background: requiredText(entry["background"], "배경", 80),
      ...(typeof entry["next"] === "string" ? { next: entry["next"] } : {}), ...(typeof entry["ending"] === "string" ? { ending: entry["ending"] } : {}),
    };
  });
  const jobsRaw = isRecord(value["jobs"]) ? value["jobs"] : {}, jobs: Record<string, { readonly status: "pending" | "ready" | "short" | "error" }> = {};
  for (const beat of scenes) {
    const item = jobsRaw[beat.id], statusRaw = isRecord(item) ? item["status"] : undefined;
    jobs[beat.id] = { status: statusRaw === "ready" || statusRaw === "short" || statusRaw === "error" ? statusRaw : "pending" };
  }
  return {
    version: 1, id: requiredText(value["id"], "계획 ID", 100), brief: requiredText(value["brief"], "기획", 2200), targetMinutes, charsPerMinute,
    outline: {
      title: requiredText(outlineRaw["title"], "제목", 150), subtitle: requiredText(outlineRaw["subtitle"], "설명", 400),
      bible: requiredText(outlineRaw["bible"], "설정집", 5000), start: requiredText(outlineRaw["start"], "시작", 80), scenes,
    }, jobs,
  };
}
export function productionDocumentFromLegacy(checkpoint: LegacyProductionCheckpoint): ProductionDocument {
  return parseProductionDocument({ version: 1, brief: checkpoint.brief, castCanon: [], worldTimeline: [], branchFacts: [], outline: checkpoint.outline, artDirection: [], referenceBindings: [] });
}
