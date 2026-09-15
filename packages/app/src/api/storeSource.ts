/**
 * 에셋 소스 목록.
 *
 * 스토어 패널은 여러 출처를 다루지만 설치 규칙은 하나다(losia-asset/1). 출처마다 다른 건
 * '어떻게 가져오는가' 뿐이라 그 부분만 여기서 갈아끼운다.
 *
 * - losia: 외부 스토어. 브라우저가 직접 부르면 CORS 에 막혀 로컬 게이트웨이 프록시를 지난다.
 * - openvnmaker: 이 도구의 공개 저장소. CORS 가 열려 있어 브라우저가 바로 받는다 — 게이트웨이가
 *   꺼져 있어도, 정적 호스팅에 올린 스튜디오에서도 쓸 수 있다.
 */
import { downloadStoreFile, fetchStoreManifest, searchStoreAssets, type StoreCatalog, type StoreSearchQuery } from "./store.js";
import { downloadRepoFile, fetchRepoManifest, REPO_HOME, searchRepoAssets } from "./repoStore.js";
import { DEFAULT_STORE_SOURCE, type StoreManifest } from "../studio/storeInstall.js";

export interface StoreSource {
  readonly id: "losia" | "openvnmaker";
  readonly label: string;
  /** 패널 아래 한 줄 안내. 출처와 설치 결과를 사용자에게 알린다. */
  readonly hint: string;
  /** 설치한 자산 id 의 앞머리. 출처가 달라도 서로 덮어쓰지 않게 나눈다. */
  readonly idPrefix: string;
  /** 카드 출처 표기에 쓰는 주소. */
  readonly origin: string;
  /** 자산 상세 주소의 앞부분. 빈 문자열이면 출처 주소만 출처로 남긴다. */
  readonly assetPagePrefix: string;
  /** 업로더 정보가 없는 자산의 제작자 표기. */
  readonly creditName: string;
  /** 게이트웨이가 있어야 쓸 수 있는 출처인지. UI 가 안내 문구를 바꾼다. */
  readonly needsGateway: boolean;
  search(query: StoreSearchQuery, signal?: AbortSignal): Promise<StoreCatalog>;
  manifest(id: string, signal?: AbortSignal): Promise<StoreManifest>;
  download(id: string, role: string, signal?: AbortSignal): Promise<Blob>;
}

export const LOSIA_SOURCE: StoreSource = {
  id: "losia",
  label: "losia.online",
  hint: "losia.online의 공개 자산입니다. 설치하면 이 작품의 보관함에 들어가고, 플레이어와 게임 ZIP에 함께 담깁니다.",
  idPrefix: "losia",
  origin: DEFAULT_STORE_SOURCE,
  assetPagePrefix: "/api/assets/",
  creditName: "losia",
  needsGateway: true,
  search: searchStoreAssets,
  manifest: fetchStoreManifest,
  download: downloadStoreFile,
};

export const REPO_SOURCE: StoreSource = {
  id: "openvnmaker",
  label: "openvnmaker",
  hint: "이 도구의 공개 저장소에 담긴 자산입니다. 로그인도 로컬 서버도 필요 없이 바로 받습니다. MIT 소스와 달리 그림·음원의 이용 조건은 저장소의 표기를 따르세요.",
  idPrefix: "ovm",
  origin: REPO_HOME,
  assetPagePrefix: "",
  creditName: "openvnmaker",
  needsGateway: false,
  search: searchRepoAssets,
  manifest: fetchRepoManifest,
  download: downloadRepoFile,
};

export const STORE_SOURCES: readonly StoreSource[] = [REPO_SOURCE, LOSIA_SOURCE];

export function storeSourceById(id: string): StoreSource {
  return STORE_SOURCES.find(source => source.id === id) ?? REPO_SOURCE;
}
