/**
 * losia 매니페스트 → 프로젝트 설치 계획.
 *
 * 계약: losia/docs/vnmaker-contract.md (spec `losia-asset/1`).
 * 이 파일은 순수 계산만 한다 — 네트워크와 IndexedDB 는 api/store.ts 와 호출자(StorePanel)가 맡는다.
 * 그래야 라이선스/역할 매핑 같은 규칙을 브라우저 없이 테스트할 수 있다.
 *
 * 규칙:
 * - `embedded` 등급은 원본 주소가 없다. 설치 계획을 세우지 않고 오류로 알린다(프록시도 403 으로 막는다).
 * - role → vnmaker 자산: `base` / `variant:*` → 배경, `expression:*` → 인물 표정, `pose:*` → 인물 포즈,
 *   `cg`, `cg~N` → 이벤트 CG, `audio` → 음원. 모르는 role 은 무시하되 `ignored` 로 보고한다.
 * - losia 표정 이름은 한글이다. vnmaker 표정 키는 영문 slug 이므로 별칭표로 옮기고, 모르는 이름은
 *   안정적인 합성 키(`x-<hash>`)로 만든다. 한글 라벨은 이름에 남는다.
 * - Artwork id 는 매니페스트 id + role 에서 결정적으로 만든다 → 같은 자산을 다시 설치하면 카드가 늘지 않고 대체된다.
 */
import { validBackgroundUrl, type Artwork, type AudioAsset, type MediaProvenance } from "@vnmaker/content";

export const LOSIA_SPEC = "losia-asset/1";
/** 게이트웨이가 기본으로 쓰는 스토어 주소. 출처 표기에만 쓴다. */
export const DEFAULT_STORE_SOURCE = "https://losia.online";

export interface StoreManifestFile {
  readonly role: string;
  readonly url?: string;
  readonly mime?: string;
  readonly w?: number;
  readonly h?: number;
}

export interface StoreManifest {
  readonly spec: string;
  readonly id: string;
  readonly kind: "stage" | "character" | "sound";
  readonly name: string;
  readonly tags?: readonly string[];
  readonly license: "embedded" | "attribution" | "downloadable";
  readonly uploader?: { readonly handle?: string; readonly display?: string };
  readonly provenance?: { readonly generator?: string; readonly model?: string; readonly prompt?: string };
  /** 원본이 단색 배경(초록 등)일 때 그 색. 설치할 캐릭터에 걸어 주지 않으면 게임에서 그 배경이 그대로 보인다. */
  readonly chromaKey?: string;
  readonly files: readonly StoreManifestFile[];
}

export interface PlannedFile {
  readonly role: string;
  readonly name: string;
  readonly kind: "background" | "cg" | "character" | "audio";
  readonly expression?: string;
  readonly label?: string;
  /** outfit:<id>:… 역할이 붙은 파일 — 기본 복장이 아니라 이 의상의 원화다. */
  readonly outfit?: string;
  readonly audioKind?: "bgm" | "sfx";
  readonly mime?: string;
}

export interface InstallPlan {
  readonly files: readonly PlannedFile[];
  /** 알려진 역할 규칙에 없는 role. 조용히 버리지 않고 UI 가 보고할 수 있게 남긴다. */
  readonly ignored: readonly string[];
}

export interface InstallOptions {
  readonly characterId?: string;
  /** 카드 출처 표기에 쓰는 스토어 주소. 게이트웨이 기본값과 같다. */
  readonly source?: string;
  /** 설치한 자산 id 의 앞머리. 출처가 다르면 나눠야 같은 이름의 자산이 서로를 덮지 않는다. */
  readonly idPrefix?: string;
  /** 출처 표기에 쓰는 이름. 업로더가 없는 출처(저장소 등)에서 쓴다. */
  readonly creditName?: string;
  /** 자산 상세 주소의 앞부분. 빈 문자열이면 출처 주소만 남긴다. */
  readonly assetPagePrefix?: string;
}

export class StoreInstallError extends Error {}

/** losia 표정 이름 → vnmaker 표정 키. 계약의 예시(슬픔/미소/놀람/분노/무표정)를 모두 덮는다. */
const EXPRESSION_ALIASES: Readonly<Record<string, string>> = {
  "무표정": "neutral", "기본": "neutral", "보통": "neutral", neutral: "neutral",
  "미소": "smile", "웃음": "smile", smile: "smile",
  "슬픔": "sad", sad: "sad",
  "놀람": "surprised", "깜짝": "surprised", surprised: "surprised",
  "화남": "angry", "분노": "angry", angry: "angry",
  "울음": "cry", "눈물": "cry", cry: "cry",
  "부끄러움": "shy", "수줍음": "shy", shy: "shy",
  "기쁨": "happy", "즐거움": "happy", happy: "happy",
  "진지": "serious", serious: "serious",
  "활짝": "beaming", "활짝웃음": "beaming", beaming: "beaming",
};

/** 같은 라벨은 언제나 같은 키가 되어야 한다 — 새로고침/재설치에도 표정 매핑이 흔들리지 않게. */
function hash32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function expressionKey(label: string): string {
  const trimmed = label.trim();
  const alias = EXPRESSION_ALIASES[trimmed] ?? EXPRESSION_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  // 영문 라벨이면 그대로 쓴다(64자 제한은 parse 의 characterKey 규칙).
  return /^[a-z][a-z0-9-]{0,52}$/.test(slug) ? slug : `x-${hash32(trimmed)}`;
}

function idSlug(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug === text.toLowerCase() && slug !== "" ? slug : `${slug || "role"}-${hash32(text)}`;
}

function audioKindOf(manifest: StoreManifest): "bgm" | "sfx" {
  const tags = (manifest.tags ?? []).map(tag => tag.trim().toLowerCase());
  return tags.some(tag => tag.includes("효과") || tag === "sfx" || tag === "se" || tag === "효과음") ? "sfx" : "bgm";
}

function mediaSource(manifest: StoreManifest, options: InstallOptions): string {
  const origin = options.source ?? DEFAULT_STORE_SOURCE;
  // 자산마다 주소가 있는 스토어는 그 주소를, 그렇지 않은 출처(저장소 등)는 출처 자체를 남긴다.
  const prefix = options.assetPagePrefix ?? "/api/assets/";
  return prefix === "" ? origin : `${origin}${prefix}${manifest.id}`;
}

/** 검증된 매니페스트만 계획 단계로 보낸다. 여기서 막지 않으면 빈 URL 이 원고로 들어간다. */
export function parseStoreManifest(value: unknown): StoreManifest {
  if (!value || typeof value !== "object") throw new StoreInstallError("스토어 응답을 해석하지 못했습니다.");
  const row = value as Record<string, unknown>;
  const spec = row["spec"];
  if (spec !== LOSIA_SPEC) throw new StoreInstallError(`지원하지 않는 매니페스트 버전입니다: ${String(spec)}`);
  const kind = row["kind"];
  if (kind !== "stage" && kind !== "character" && kind !== "sound") throw new StoreInstallError(`지원하지 않는 자산 종류입니다: ${String(kind)}`);
  const license = row["license"];
  if (license !== "embedded" && license !== "attribution" && license !== "downloadable") throw new StoreInstallError(`알 수 없는 라이선스 등급입니다: ${String(license)}`);
  if (typeof row["id"] !== "string" || row["id"] === "") throw new StoreInstallError("자산 id 가 없습니다.");
  if (typeof row["name"] !== "string" || row["name"].trim() === "") throw new StoreInstallError("자산 이름이 없습니다.");
  if (!Array.isArray(row["files"]) || row["files"].length === 0) throw new StoreInstallError("자산에 파일이 없습니다.");
  const files: StoreManifestFile[] = row["files"].map(file => {
    if (!file || typeof file !== "object") throw new StoreInstallError("자산 파일 항목이 올바르지 않습니다.");
    const entry = file as Record<string, unknown>;
    if (typeof entry["role"] !== "string" || entry["role"] === "") throw new StoreInstallError("자산 파일에 역할이 없습니다.");
    return {
      role: entry["role"],
      ...(typeof entry["url"] === "string" ? { url: entry["url"] } : {}),
      ...(typeof entry["mime"] === "string" ? { mime: entry["mime"] } : {}),
      ...(typeof entry["w"] === "number" ? { w: entry["w"] } : {}),
      ...(typeof entry["h"] === "number" ? { h: entry["h"] } : {}),
    };
  });
  return {
    spec,
    id: row["id"],
    kind,
    name: row["name"],
    license,
    files,
    ...(Array.isArray(row["tags"]) ? { tags: row["tags"].filter((tag): tag is string => typeof tag === "string") } : {}),
    // 색 표기만 받는다. 아무 문자열이나 통과시키면 원고의 캐릭터에 쓰레기 값이 들어간다.
    ...(typeof row["chromaKey"] === "string" && /^#[0-9a-fA-F]{6}$/.test(row["chromaKey"]) ? { chromaKey: row["chromaKey"] } : {}),
    ...(row["uploader"] && typeof row["uploader"] === "object" ? { uploader: row["uploader"] as NonNullable<StoreManifest["uploader"]> } : {}),
    ...(row["provenance"] && typeof row["provenance"] === "object" ? { provenance: row["provenance"] as NonNullable<StoreManifest["provenance"]> } : {}),
  };
}

export function installPlan(manifest: StoreManifest): InstallPlan {
  if (manifest.spec !== LOSIA_SPEC) throw new StoreInstallError(`지원하지 않는 매니페스트 버전입니다: ${manifest.spec}`);
  if (manifest.license === "embedded") {
    throw new StoreInstallError("embedded 등급은 원본 파일을 내려받을 수 없습니다. 미리보기만 볼 수 있습니다.");
  }
  const files: PlannedFile[] = [];
  const ignored: string[] = [];
  for (const file of manifest.files) {
    if (typeof file.url !== "string" || file.url === "") {
      throw new StoreInstallError(`이 자산은 원본 파일 주소를 제공하지 않습니다(${file.role}). 설치할 수 없습니다.`);
    }
    const separator = file.role.indexOf(":");
    const head = separator === -1 ? file.role : file.role.slice(0, separator);
    const tail = separator === -1 ? "" : file.role.slice(separator + 1);
    const mime = file.mime === undefined ? {} : { mime: file.mime };

    if (head === "base") {
      if (manifest.kind === "sound") files.push({ role: file.role, kind: "audio", name: manifest.name, audioKind: audioKindOf(manifest), ...mime });
      else files.push({ role: file.role, kind: manifest.kind === "character" ? "character" : "background", name: manifest.name, ...mime });
      continue;
    }
    if (head === "variant" && tail !== "") {
      files.push({ role: file.role, kind: "background", name: `${manifest.name} · ${tail}`, ...mime });
      continue;
    }
    if (head === "expression" && tail !== "") {
      files.push({ role: file.role, kind: "character", name: `${manifest.name} · ${tail}`, expression: expressionKey(tail), label: tail, ...mime });
      continue;
    }
    if (head === "pose" && tail !== "") {
      files.push({ role: file.role, kind: "character", name: `${manifest.name} · ${tail}`, ...mime });
      continue;
    }
    if (head === "outfit" && tail !== "") {
      // outfit:<의상id>:<base|expression:표정|pose:포즈> — 같은 인물의 다른 복장.
      const cut = tail.indexOf(":");
      const outfitId = cut === -1 ? tail : tail.slice(0, cut);
      const inner = cut === -1 ? "base" : tail.slice(cut + 1);
      const innerCut = inner.indexOf(":");
      const innerHead = innerCut === -1 ? inner : inner.slice(0, innerCut);
      const innerTail = innerCut === -1 ? "" : inner.slice(innerCut + 1);
      if (innerHead === "expression" && innerTail !== "") {
        files.push({ role: file.role, kind: "character", name: `${manifest.name} · ${outfitId} · ${innerTail}`, expression: expressionKey(innerTail), label: `${outfitId}:${innerTail}`, outfit: outfitId, ...mime });
        continue;
      }
      if (innerHead === "pose" && innerTail !== "") {
        files.push({ role: file.role, kind: "character", name: `${manifest.name} · ${outfitId} ${innerTail}`, outfit: outfitId, ...mime });
        continue;
      }
      if (inner === "base") {
        // 의상 기본 원화는 그 의상의 neutral 표정으로 올라간다 — 의상만 골라도 바로 선다.
        files.push({ role: file.role, kind: "character", name: `${manifest.name} · ${outfitId}`, expression: "neutral", label: `${outfitId}:base`, outfit: outfitId, ...mime });
        continue;
      }
      ignored.push(file.role);
      continue;
    }
    if (/^cg(~|$)/.test(file.role)) {
      const suffix = tail === "" ? "" : ` · ${tail}`;
      files.push({ role: file.role, name: `${manifest.name} · CG${suffix}`, kind: "cg", ...mime });
      continue;
    }
    if (head === "audio") {
      files.push({ role: file.role, kind: "audio", name: manifest.name, audioKind: audioKindOf(manifest), ...mime });
      continue;
    }
    ignored.push(file.role);
  }
  return { files, ignored };
}

/**
 * 내려받기 전에 확인한다. 이전에는 파일을 모두 보관함에 저장한 뒤 artworksFromInstall 이 "캐릭터를 선택하세요"로
 * 실패해, 원고에는 등록되지 않은 blob 이 IndexedDB 에 남았다(고아 파일).
 */
export function assertInstallable(plan: InstallPlan, options: InstallOptions): void {
  if (plan.files.some(file => file.kind === "character") && !options.characterId) throw new StoreInstallError("먼저 이 원화를 사용할 캐릭터를 선택하세요.");
  if (!plan.files.length) throw new StoreInstallError("이 자산에는 설치할 수 있는 파일이 없습니다.");
}

function provenanceFor(manifest: StoreManifest, options: InstallOptions): MediaProvenance {
  const fallback = options.creditName ?? "losia";
  const display = manifest.uploader?.display?.trim() || manifest.uploader?.handle?.trim() || fallback;
  const home = (options.source ?? DEFAULT_STORE_SOURCE).replace(/^https?:\/\//, "");
  return { creator: display, source: mediaSource(manifest, options), license: manifest.license, credit: `${display} · ${home}` };
}

/**
 * 저장된 로컬 경로를 Artwork/AudioAsset 으로 옮긴다.
 * 계획에 있는데 저장되지 않은 파일이 하나라도 있으면 아무것도 등록하지 않는다 — 깨진 URL 을 원고에 남기지 않는다.
 */
export function artworksFromInstall(
  manifest: StoreManifest,
  plan: InstallPlan,
  stored: ReadonlyMap<string, string>,
  options: InstallOptions,
  durations?: ReadonlyMap<string, number>,
): { readonly artworks: readonly Artwork[]; readonly audio: readonly AudioAsset[]; readonly provenance: MediaProvenance } {
  const provenance = provenanceFor(manifest, options);
  const missing = plan.files.filter(file => !stored.has(file.role)).map(file => file.role);
  if (missing.length) throw new StoreInstallError(`저장하지 못한 파일이 있습니다: ${missing.join(", ")}`);

  const artworks: Artwork[] = [];
  const audio: AudioAsset[] = [];
  const createdAt = new Date().toISOString();
  const prompt = manifest.provenance?.prompt;

  for (const file of plan.files) {
    const url = stored.get(file.role)!;
    const id = `${options.idPrefix ?? "losia"}-${manifest.id}-${idSlug(file.role)}`;
    if (file.kind === "audio") {
      const duration = durations?.get(file.role);
      if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
        throw new StoreInstallError(`음원 길이를 확인하지 못했습니다: ${file.name}`);
      }
      audio.push({ id, name: file.name, kind: file.audioKind ?? "bgm", url, duration, provenance });
      continue;
    }
    if (file.kind === "character") {
      if (!options.characterId) throw new StoreInstallError("먼저 이 원화를 사용할 캐릭터를 선택하세요.");
      if (!validBackgroundUrl(url)) throw new StoreInstallError(`이미지 주소가 올바르지 않습니다: ${url}`);
      artworks.push({
        id, name: file.name, kind: "character", url, provenance, createdAt,
        characterId: options.characterId,
        ...(file.expression ? { expression: file.expression } : {}),
        ...(file.outfit ? { outfit: file.outfit } : {}),
        ...(prompt ? { prompt } : {}),
      });
      continue;
    }
    if (!validBackgroundUrl(url)) throw new StoreInstallError(`이미지 주소가 올바르지 않습니다: ${url}`);
    artworks.push({ id, name: file.name, kind: file.kind, url, provenance, createdAt, ...(prompt ? { prompt } : {}) });
  }
  return { artworks, audio, provenance };
}
