/**
 * openvnmaker 저장소 에셋 소스.
 *
 * losia 는 CORS 때문에 게이트웨이 프록시를 지나야 하지만, 이쪽은 공개 GitHub 저장소라
 * `Access-Control-Allow-Origin: *` 으로 파일을 준다. 그래서 브라우저가 직접 받는다 —
 * 로컬 서버도, 로그인도, 게이트웨이도 필요 없다. 정적 호스팅에 올린 스튜디오에서도 그대로 된다.
 *
 * 목록 한 번(catalog/assets.json)이면 파일 목록까지 다 들어 있어 항목마다 매니페스트를
 * 따로 받지 않는다. 카탈로그는 `tools/asset-catalog/build.mjs` 가 만든다.
 */
import { assetUrl } from "../assetUrl.js";
import { LOSIA_SPEC, parseStoreManifest, type StoreManifest } from "../studio/storeInstall.js";
import type { StoreCatalog, StoreCatalogItem, StoreSearchQuery } from "./store.js";

export const REPO_SLUG = "MovieHolic-Plex/openvnmaker";
export const REPO_HOME = `https://github.com/${REPO_SLUG}`;

interface Base {
  /** 주소 앞부분. 빈 문자열이면 앱과 같은 오리진이다. */
  readonly origin: string;
  /** public 폴더가 그 주소에서 어디에 있는지. */
  readonly prefix: string;
}

/**
 * 순서대로 시도한다.
 *
 * 1. 같은 오리진 — 이 앱이 카탈로그와 에셋을 이미 함께 서빙한다. 개발 서버·데스크톱·정적 배포에서
 *    네트워크를 아예 타지 않고, 비행기 안에서도 된다.
 * 2. jsDelivr — 다른 곳에 올린 포크나 에셋을 뺀 빌드를 위한 CDN. 요청 제한이 없다.
 * 3. raw.githubusercontent — CDN 반영이 늦을 때를 위한 받침. 둘 다 CORS 를 연다.
 */
const BASES: readonly Base[] = [
  { origin: "", prefix: "/" },
  { origin: `https://cdn.jsdelivr.net/gh/${REPO_SLUG}@main`, prefix: "/packages/app/public/" },
  { origin: `https://raw.githubusercontent.com/${REPO_SLUG}/main`, prefix: "/packages/app/public/" },
];

interface CatalogFile { readonly role: string; readonly path: string; readonly mime?: string }
interface CatalogItem {
  readonly id: string;
  readonly kind: "stage" | "character" | "sound";
  readonly name: string;
  readonly tags?: readonly string[];
  readonly license?: "embedded" | "attribution" | "downloadable";
  readonly thumb?: string;
  readonly chromaKey?: string;
  readonly files: readonly CatalogFile[];
}

/** public 폴더 기준 경로를 실제 주소로 만든다. 카탈로그에 절대 주소를 박지 않아야 저장소 이름이 바뀌어도 산다. */
function fileUrl(base: Base, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  // 같은 오리진은 하위 경로에 배포된 경우까지 assetUrl 이 맞춰 준다.
  return base.origin === "" ? assetUrl(`${base.prefix}${encoded}`) : `${base.origin}${base.prefix}${encoded}`;
}

function parseCatalog(value: unknown): readonly CatalogItem[] {
  if (!value || typeof value !== "object") throw new Error("에셋 목록을 해석하지 못했습니다.");
  const body = value as { spec?: unknown; items?: unknown };
  if (body.spec !== "openvnmaker-catalog/1") throw new Error(`지원하지 않는 에셋 목록 버전입니다: ${String(body.spec)}`);
  if (!Array.isArray(body.items)) throw new Error("에셋 목록이 비어 있습니다.");
  const items: CatalogItem[] = [];
  for (const row of body.items as readonly unknown[]) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const kind = item["kind"];
    const files = item["files"];
    if (typeof item["id"] !== "string" || typeof item["name"] !== "string") continue;
    if (kind !== "stage" && kind !== "character" && kind !== "sound") continue;
    if (!Array.isArray(files)) continue;
    const parsed: CatalogFile[] = [];
    for (const raw of files as readonly unknown[]) {
      if (!raw || typeof raw !== "object") continue;
      const file = raw as Record<string, unknown>;
      // 경로는 그대로 주소로 조립된다. 저장소 밖으로 나가는 경로는 받지 않는다.
      if (typeof file["role"] !== "string" || typeof file["path"] !== "string") continue;
      if (file["path"].startsWith("/") || file["path"].includes("..")) continue;
      parsed.push({ role: file["role"], path: file["path"], ...(typeof file["mime"] === "string" ? { mime: file["mime"] } : {}) });
    }
    if (!parsed.length) continue;
    items.push({
      id: item["id"], name: item["name"], kind, files: parsed,
      ...(Array.isArray(item["tags"]) ? { tags: (item["tags"] as readonly unknown[]).filter((tag): tag is string => typeof tag === "string") } : {}),
      ...(item["license"] === "attribution" || item["license"] === "embedded" ? { license: item["license"] } : { license: "downloadable" as const }),
      ...(typeof item["thumb"] === "string" ? { thumb: item["thumb"] } : {}),
      ...(typeof item["chromaKey"] === "string" ? { chromaKey: item["chromaKey"] } : {}),
    });
  }
  return items;
}

let cached: Promise<{ readonly base: Base; readonly items: readonly CatalogItem[] }> | undefined;

async function loadCatalog(signal?: AbortSignal): Promise<{ readonly base: Base; readonly items: readonly CatalogItem[] }> {
  // 목록은 세션 동안 한 번만 받는다. 실패하면 캐시를 버려 다음 시도가 다시 받게 한다.
  if (cached) return await cached;
  const attempt = (async () => {
    const failures: string[] = [];
    for (const base of BASES) {
      try {
        const response = await fetch(fileUrl(base, "catalog/assets.json"), { signal: signal ?? AbortSignal.timeout(20_000) });
        if (!response.ok) { failures.push(`${base.origin || "이 앱"} → HTTP ${response.status}`); continue; }
        return { base, items: parseCatalog(await response.json()) };
      } catch (error) {
        if (signal?.aborted) throw error;
        failures.push(`${base.origin || "이 앱"} → ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`저장소 에셋 목록을 받지 못했습니다. 인터넷 연결을 확인하세요. (${failures.join(" / ")})`);
  })();
  cached = attempt;
  try { return await attempt; } catch (error) { cached = undefined; throw error; }
}

/** 테스트와 '다시 시도'가 캐시를 비울 수 있게 한다. */
export function resetRepoCatalog(): void { cached = undefined; }

function matches(item: CatalogItem, query: StoreSearchQuery): boolean {
  if (query.kind && item.kind !== query.kind) return false;
  if (query.tag && !(item.tags ?? []).includes(query.tag)) return false;
  const needle = query.q?.trim().toLowerCase();
  if (!needle) return true;
  return item.name.toLowerCase().includes(needle) || (item.tags ?? []).some(tag => tag.toLowerCase().includes(needle));
}

export async function searchRepoAssets(query: StoreSearchQuery = {}, signal?: AbortSignal): Promise<StoreCatalog> {
  const { base, items } = await loadCatalog(signal);
  const found = items.filter(item => matches(item, query));
  // 카탈로그는 생성 순서가 곧 분류 순서(인물 → 무대 → 소리)다. '최신'은 그 순서를 그대로 쓴다.
  const sorted = query.sort === "name" ? [...found].sort((a, b) => a.name.localeCompare(b.name, "ko")) : found;
  const skip = query.skip ?? 0;
  const page = sorted.slice(skip, skip + (query.take ?? 24));
  const catalogItems: StoreCatalogItem[] = page.map(item => ({
    id: item.id,
    kind: item.kind,
    name: item.name,
    tags: item.tags ?? [],
    license: item.license ?? "downloadable",
    fileCount: item.files.length,
    ...(item.thumb ? { thumb: fileUrl(base, item.thumb) } : {}),
  }));
  return { items: catalogItems, total: sorted.length };
}

export async function fetchRepoManifest(id: string, signal?: AbortSignal): Promise<StoreManifest> {
  const { base, items } = await loadCatalog(signal);
  const item = items.find(row => row.id === id);
  if (!item) throw new Error("저장소에서 자산을 찾지 못했습니다.");
  // 설치 규칙(역할 매핑·라이선스)은 losia 와 완전히 같은 형식을 쓴다 — 그래서 여기서 그 형식으로 넘긴다.
  return parseStoreManifest({
    spec: LOSIA_SPEC,
    id: item.id,
    kind: item.kind,
    name: item.name,
    tags: item.tags ?? [],
    license: item.license ?? "downloadable",
    ...(item.chromaKey ? { chromaKey: item.chromaKey } : {}),
    files: item.files.map(file => ({ role: file.role, url: fileUrl(base, file.path), ...(file.mime ? { mime: file.mime } : {}) })),
  });
}

export async function downloadRepoFile(id: string, role: string, signal?: AbortSignal): Promise<Blob> {
  const manifest = await fetchRepoManifest(id, signal);
  const file = manifest.files.find(row => row.role === role);
  if (!file?.url) throw new Error(`저장소 자산에 ${role} 파일이 없습니다.`);
  let response: Response;
  try {
    response = await fetch(file.url, { signal: signal ?? AbortSignal.timeout(120_000) });
  } catch (error) {
    throw new Error(`파일을 내려받지 못했습니다. ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw Object.assign(new Error(`파일을 내려받지 못했습니다 (HTTP ${response.status}).`), { status: response.status });
  return await response.blob();
}
