/**
 * 스토어 자산 설치의 IO 묶음. 규칙(역할/라이선스 매핑)은 storeInstall.ts 가 순수하게 갖고,
 * 여기서는 다운로드 → 브라우저 보관함(IndexedDB) → 원고 등록만 한다.
 *
 * 전부 저장한 뒤 한 트랜잭션으로 쓴다 — 중간에 실패한 설치가 반쪽 자산을 남기지 않는다.
 */
import type { Artwork, AudioAsset, MediaProvenance } from "@vnmaker/content";
import { downloadStoreFile, fetchStoreManifest } from "../api/store.js";
import { describeImage, ensureAssetServer, storeAssets, type StoredAsset } from "../storage/projectAssets.js";
import { describeAudio, probeAudio } from "../storage/projectAudio.js";
import { artworksFromInstall, assertInstallable, installPlan, type InstallOptions, type StoreManifest } from "./storeInstall.js";

export interface InstallProgress { readonly done: number; readonly total: number }

export interface StoreInstallResult {
  readonly manifest: StoreManifest;
  readonly artworks: readonly Artwork[];
  readonly audio: readonly AudioAsset[];
  readonly provenance: MediaProvenance;
  readonly ignored: readonly string[];
}

export async function installStoreAsset(
  id: string,
  options: InstallOptions & { readonly signal?: AbortSignal; readonly onProgress?: (progress: InstallProgress) => void } = {},
): Promise<StoreInstallResult> {
  const manifest = await fetchStoreManifest(id, options.signal);
  const plan = installPlan(manifest);
  // 저장 전에 실패해야 고아 blob 이 남지 않는다.
  assertInstallable(plan, options);
  await ensureAssetServer();

  const stored = new Map<string, string>();
  const durations = new Map<string, number>();
  const pending: StoredAsset[] = [];
  let done = 0;
  for (const file of plan.files) {
    if (options.signal?.aborted) throw new Error("설치를 중단했습니다.");
    const blob = await downloadStoreFile(manifest.id, file.role, options.signal);
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
    options.onProgress?.({ done, total: plan.files.length });
  }
  await storeAssets(pending);

  const installed = artworksFromInstall(manifest, plan, stored, options, durations);
  return { manifest, ...installed, ignored: plan.ignored };
}
