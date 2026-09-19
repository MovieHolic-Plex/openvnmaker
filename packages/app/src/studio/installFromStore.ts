/**
 * 스토어 자산 설치의 IO 묶음. 규칙(역할/라이선스 매핑)은 storeInstall.ts 가 순수하게 갖고,
 * 여기서는 다운로드 → 브라우저 보관함(IndexedDB) → 원고 등록만 한다.
 *
 * 전부 저장한 뒤 한 트랜잭션으로 쓴다 — 중간에 실패한 설치가 반쪽 자산을 남기지 않는다.
 */
import type { Artwork, AudioAsset, MediaProvenance } from "@vnmaker/content";
import type { StoreSource } from "../api/storeSource.js";
import { describeImage, ensureAssetServer, storeAssets, type StoredAsset } from "../storage/projectAssets.js";
import { describeAudio, probeAudio } from "../storage/projectAudio.js";
import { artworksFromInstall, assertInstallable, installPlan, type InstallOptions, type StoreManifest } from "./storeInstall.js";

export interface InstallProgress { readonly done: number; readonly total: number }

/** 느린 회선에서 파일 하나가 끊겼다고 전체 설치가 죽지 않게, 네트워크 오류·429·5xx만 다시 받는다. */
const RETRY_DELAYS = [400, 800, 1200] as const;

function isRetryable(cause: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  const status = (cause as { status?: number } | null)?.status;
  return status === undefined || status === 429 || status >= 500;
}

export async function downloadWithRetry(source: Pick<StoreSource, "download">, id: string, role: string, signal?: AbortSignal): Promise<Blob> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await source.download(id, role, signal);
    } catch (cause) {
      if (attempt >= RETRY_DELAYS.length || !isRetryable(cause, signal)) throw cause;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }
  }
}

/** 매니페스트 조회도 같은 이유로 재시도한다 — 순간 끊김 한 번에 설치 전체가 죽으면 안 된다. */
export async function manifestWithRetry(source: Pick<StoreSource, "manifest">, id: string, signal?: AbortSignal): Promise<StoreManifest> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await source.manifest(id, signal);
    } catch (cause) {
      if (attempt >= RETRY_DELAYS.length || !isRetryable(cause, signal)) throw cause;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }
  }
}

export interface StoreInstallResult {
  readonly manifest: StoreManifest;
  readonly artworks: readonly Artwork[];
  readonly audio: readonly AudioAsset[];
  readonly provenance: MediaProvenance;
  readonly ignored: readonly string[];
}

export async function installStoreAsset(
  source: StoreSource,
  id: string,
  options: InstallOptions & { readonly signal?: AbortSignal; readonly onProgress?: (progress: InstallProgress) => void } = {},
): Promise<StoreInstallResult> {
  // 출처별 표기와 id 앞머리는 소스가 정한다. 호출자가 매번 챙기면 한 군데만 빠져도 자산이 서로를 덮는다.
  const settings: InstallOptions & typeof options = {
    ...options,
    source: options.source ?? source.origin,
    idPrefix: options.idPrefix ?? source.idPrefix,
    creditName: options.creditName ?? source.creditName,
    assetPagePrefix: options.assetPagePrefix ?? source.assetPagePrefix,
  };
  const manifest = await manifestWithRetry(source, id, settings.signal);
  const plan = installPlan(manifest);
  // 저장 전에 실패해야 고아 blob 이 남지 않는다.
  assertInstallable(plan, settings);
  await ensureAssetServer();

  const stored = new Map<string, string>();
  const durations = new Map<string, number>();
  const pending: StoredAsset[] = [];
  let done = 0;
  for (const file of plan.files) {
    if (settings.signal?.aborted) throw new Error("설치를 중단했습니다.");
    const blob = await downloadWithRetry(source, manifest.id, file.role, settings.signal);
    if (file.kind === "audio") {
      const described = await describeAudio(blob);
      const duration = await probeAudio(described.blob);
      stored.set(file.role, described.path);
      durations.set(file.role, duration);
      pending.push({ path: described.path, blob: described.blob, originalName: `${manifest.name} · ${file.role}`, createdAt: Date.now() });
    } else {
      const described = await describeImage(blob);
      stored.set(file.role, described.path);
      pending.push({ path: described.path, blob: described.blob, originalName: `${manifest.name} · ${file.role}`, createdAt: Date.now() });
    }
    done += 1;
    settings.onProgress?.({ done, total: plan.files.length });
  }
  await storeAssets(pending);

  const installed = artworksFromInstall(manifest, plan, stored, settings, durations);
  return { manifest, ...installed, ignored: plan.ignored };
}
