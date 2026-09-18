/**
 * losia 스토어 클라이언트.
 *
 * 브라우저가 losia.online 을 직접 부르면 CORS 에 막힌다. 전부 로컬 게이트웨이의
 * `/api/store/*` 프록시를 지난다(vite 미들웨어가 5173 에 붙여 준다).
 * GET 만 쓰므로 스튜디오 헤더는 필요 없다.
 */
import { parseStoreManifest, type StoreManifest } from "../studio/storeInstall.js";

export interface StoreCatalogItem {
  readonly id: string;
  readonly kind: "stage" | "character" | "sound";
  readonly name: string;
  readonly tags: readonly string[];
  readonly license: "embedded" | "attribution" | "downloadable";
  readonly thumb?: string;
  readonly thumbLg?: string;
  readonly width?: number;
  readonly height?: number;
  readonly fileCount?: number;
  readonly useCount?: number;
  readonly uploader?: { readonly handle?: string; readonly display?: string };
  readonly facets?: Readonly<Record<string, string>>;
  readonly createdAt?: string;
}

export interface StoreCatalog {
  readonly items: readonly StoreCatalogItem[];
  readonly total: number;
}

export interface StoreSearchQuery {
  readonly kind?: "stage" | "character" | "sound";
  readonly q?: string;
  readonly tag?: string;
  readonly sort?: "new" | "use" | "name";
  readonly take?: number;
  readonly skip?: number;
}

export interface HttpError extends Error { readonly status?: number }

async function failure(response: Response): Promise<HttpError> {
  const text = await response.text().catch(() => "");
  let error: HttpError;
  try {
    const body = JSON.parse(text) as { error?: unknown };
    error = typeof body.error === "string" && body.error !== ""
      ? new Error(body.error)
      : new Error(`스토어 요청이 실패했습니다 (HTTP ${response.status})`);
  } catch {
    error = new Error(`스토어 요청이 실패했습니다 (HTTP ${response.status})`);
  }
  return Object.assign(error, { status: response.status });
}

export async function searchStoreAssets(query: StoreSearchQuery = {}, signal?: AbortSignal): Promise<StoreCatalog> {
  const params = new URLSearchParams();
  if (query.kind) params.set("kind", query.kind);
  if (query.q) params.set("q", query.q);
  if (query.tag) params.set("tag", query.tag);
  if (query.sort) params.set("sort", query.sort);
  params.set("take", String(query.take ?? 24));
  params.set("skip", String(query.skip ?? 0));
  let response: Response;
  try {
    response = await fetch(`/api/store/catalog?${params.toString()}`, { signal: signal ?? AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new Error(`스토어에 연결하지 못했습니다. ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw await failure(response);
  const body = (await response.json()) as { items?: unknown; total?: unknown };
  const items = Array.isArray(body.items) ? (body.items as StoreCatalogItem[]) : [];
  return { items, total: typeof body.total === "number" ? body.total : items.length };
}

export async function fetchStoreManifest(id: string, signal?: AbortSignal): Promise<StoreManifest> {
  let response: Response;
  try {
    response = await fetch(`/api/store/assets/${encodeURIComponent(id)}/manifest`, { signal: signal ?? AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new Error(`스토어에 연결하지 못했습니다. ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw await failure(response);
  return parseStoreManifest(await response.json());
}

/** 원본 파일 바이트. embedded 등급은 게이트웨이가 403 으로 막는다. */
export async function downloadStoreFile(id: string, role: string, signal?: AbortSignal): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`/api/store/assets/${encodeURIComponent(id)}/files/${encodeURIComponent(role)}`, { signal: signal ?? AbortSignal.timeout(120_000), cache: "no-store" });
  } catch (error) {
    throw new Error(`파일을 내려받지 못했습니다. ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw await failure(response);
  return await response.blob();
}
