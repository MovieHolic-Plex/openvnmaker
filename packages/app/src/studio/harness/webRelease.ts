import {
  assertNever, canonicalHash, canonicalJson, HarnessError, parseReleaseSnapshot, type ReleaseSnapshot,
} from "@vnmaker/harness";
import { resolveRuntimeAsset } from "../../storage/runtimeBase.js";
import { buildExportBundle, collectProjectAssets, type ExportProgress } from "../exportBundle.js";
import { projectPublicScript } from "../releaseSnapshot.js";

export type WebReleaseOptions = {
  readonly assets: ReadonlyMap<string, Uint8Array>;
  readonly fetcher?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ExportProgress) => void;
};

export type WebReleaseBundle = {
  readonly blob: Blob;
  readonly filename: string;
  readonly fileCount: number;
  readonly projectNamespace: string;
  readonly releaseId: ReleaseSnapshot["releaseId"];
};

const RELEASE_NAMESPACE = /^release-[a-f0-9]{16}$/;

function webReleaseKind(value: unknown): "candidate-preview" | "release" {
  if (value === "candidate-preview" || value === "release") return value;
  throw new HarnessError("INVALID_INPUT");
}

/** Public exporter boundary: candidate previews are never a shippable game. */
export function parseWebReleaseInput(input: unknown): ReleaseSnapshot {
  if (typeof input !== "object" || input === null) throw new HarnessError("INVALID_INPUT");
  const kind = webReleaseKind("kind" in input ? input.kind : undefined);
  switch (kind) {
    case "candidate-preview":
      throw new HarnessError("PREVIEW_NOT_RELEASE");
    case "release":
      return parseReleaseSnapshot(input);
    default:
      return assertNever(kind);
  }
}

export function releaseSaveNamespace(release: ReleaseSnapshot): string {
  const namespace = `release-${release.releaseId.slice(0, 16)}`;
  if (!RELEASE_NAMESPACE.test(namespace)) throw new HarnessError("INVALID_INPUT");
  return namespace;
}

/** Same ZIP keeps logical `/assets/...` paths; the player rebases them per mount. */
export function releaseAssetPath(logicalPath: string, packageBase: string): string {
  const base = packageBase.endsWith("/") ? packageBase : `${packageBase}/`;
  return resolveRuntimeAsset(logicalPath, new URL(base, "https://release.invalid"));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function releaseReadme(title: string, namespace: string): string {
  return `${title}

이 ZIP은 확정 릴리스의 공개 게임입니다. 제작 메모·토큰·후보 저장·AI 서버는 포함하지 않습니다.

실행
1. ZIP을 새 폴더에 모두 풀어주세요.
2. 그 폴더에서 정적 웹 서버를 실행합니다. Python이 있다면: python -m http.server 8080
3. 루트는 http://localhost:8080/ 입니다. 하위 경로는 같은 폴더를 /games/medium/ 에 두고 http://localhost:8080/games/medium/ 처럼 끝의 / 를 유지하세요.

배포
같은 패키지가 / 와 /games/medium/ 에서 동작합니다. index.html을 file://로 더블클릭하면 브라우저 보안 정책 때문에 원고를 읽을 수 없습니다. VN Maker, 로컬 AI 게이트웨이, 제작자 계정은 필요하지 않습니다.

원고와 저장
project.json은 공개 플레이용 원고입니다. release.json은 이 패키지를 고정한 릴리스 식별자와 자산 해시입니다.
저장은 ${namespace} 영역을 사용합니다. 후보 미리보기 저장과 섞이지 않습니다.
`;
}

function packageFetcher(assets: ReadonlyMap<string, Uint8Array>, runtime: typeof fetch): typeof fetch {
  return async (input, init) => {
    const path = String(input);
    if (path.startsWith("/export-runtime/")) return runtime(input, init);
    const bytes = path.startsWith("/api/") ? undefined : assets.get(path);
    if (bytes === undefined) return new Response("missing", { status: 404 });
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Response(copy);
  };
}

async function missingPinnedMedia(release: ReleaseSnapshot, assets: ReadonlyMap<string, Uint8Array>): Promise<string[]> {
  const missing: string[] = [];
  const pinned = new Map<string, ReleaseSnapshot["assets"][number]>();
  for (const asset of release.assets) pinned.set(`/${asset.path}`, asset);
  const seen = new Set<string>();
  const check = async (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    if (!path.startsWith("/assets/") || path.startsWith("/api/")) {
      missing.push(`${path} — 공개 게임은 패키지 소유 자산만 담습니다`);
      return;
    }
    const bytes = assets.get(path);
    const record = pinned.get(path);
    if (bytes === undefined || record === undefined) {
      missing.push(`${path} — 파일이 없습니다`);
      return;
    }
    if (bytes.byteLength !== record.size || await sha256Hex(bytes) !== record.hash) {
      missing.push(`${path} — 원본 파일의 내용과 식별자가 다릅니다`);
    }
  };
  for (const path of collectProjectAssets(release.publicScript)) await check(path);
  for (const path of pinned.keys()) await check(path);
  return missing.sort();
}

/** Pin a ReleaseSnapshot through the existing ZIP packager without changing asset-helper signatures. */
export async function buildWebReleaseBundle(input: unknown, options: WebReleaseOptions): Promise<WebReleaseBundle> {
  const release = parseWebReleaseInput(input);
  const publicScript = projectPublicScript(release.publicScript);
  if (await canonicalHash(publicScript) !== release.publicScriptHash) {
    throw new Error("공개 원고 해시가 릴리스와 일치하지 않습니다.");
  }
  const missing = await missingPinnedMedia({ ...release, publicScript }, options.assets);
  if (missing.length) throw new Error(`파일 ${missing.length}개를 담지 못해 배포를 중단했습니다.\n${missing.join("\n")}`);
  const namespace = releaseSaveNamespace(release);
  const encoded = new TextEncoder().encode(canonicalJson({
    kind: release.kind,
    releaseId: release.releaseId,
    sourceHead: release.sourceHead,
    sourceScriptHash: release.sourceScriptHash,
    publicScriptHash: release.publicScriptHash,
    publicScript,
    assets: release.assets,
    approval: release.approval,
    exporterVersion: release.exporterVersion,
    runtimeVersion: release.runtimeVersion,
  }));
  const result = await buildExportBundle(publicScript, {
    fetcher: packageFetcher(options.assets, options.fetcher ?? fetch),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    projectNamespace: namespace,
    extraEntries: [{ path: "release.json", bytes: encoded }],
    readmeText: releaseReadme(publicScript.title, namespace),
  });
  return { ...result, releaseId: release.releaseId };
}
