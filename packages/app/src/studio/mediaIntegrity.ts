import type { VnScript } from "@vnmaker/content";
import { validAudioUrl } from "@vnmaker/content";

export type MediaKind = "background" | "cg" | "pose" | "portrait" | "bgm" | "voice" | "sfx" | "artwork" | "audio";
export interface MediaReference {
  readonly url: string;
  readonly kind: MediaKind;
  /** 검증 목록에 보여 줄 위치 설명. */
  readonly label: string;
  /** 장면에 묶인 참조만 가진다. 인물 원화와 보관함 항목은 장면이 없다. */
  readonly sceneId?: string;
}

const isLocal = (value: string | null | undefined): value is string => typeof value === "string" && value.startsWith("/");
const audioUrl = (value: string | null | undefined) => isLocal(value) && validAudioUrl(value) ? value : undefined;

/** 원고가 가리키는 로컬 미디어 주소를 처음 나타난 위치 기준으로 한 번씩 모은다. 내장 배경 id 는 파일이 아니라 제외한다. */
export function collectMediaReferences(script: VnScript): MediaReference[] {
  const seen = new Set<string>();
  const refs: MediaReference[] = [];
  const add = (url: string | null | undefined, kind: MediaKind, label: string, sceneId?: string) => {
    if (!isLocal(url) || seen.has(url)) return;
    seen.add(url); refs.push({ url, kind, label, ...(sceneId ? { sceneId } : {}) });
  };
  for (const scene of script.scenes) {
    const where = scene.chapter || scene.id;
    add(scene.backgroundUrl, "background", `${where} · 장면 배경`, scene.id);
    add(scene.cgUrl, "cg", `${where} · 이벤트 CG`, scene.id);
    add(audioUrl(scene.bgm), "bgm", `${where} · 배경음악`, scene.id);
    for (const sprite of scene.sprites ?? []) add(sprite.poseUrl, "pose", `${where} · 배우 포즈`, scene.id);
    scene.lines.forEach((line, index) => {
      const at = `${where} · ${index + 1}줄`;
      add(line.backgroundUrl, "background", `${at} 배경 전환`, scene.id);
      add(line.cgUrl, "cg", `${at} 이미지 전환`, scene.id);
      add(audioUrl(line.bgm), "bgm", `${at} 음악 전환`, scene.id);
      add(audioUrl(line.voice), "voice", `${at} 보이스`, scene.id);
      add(audioUrl(line.sfx), "sfx", `${at} 효과음`, scene.id);
      for (const sprite of line.sprites ?? []) add(sprite.poseUrl, "pose", `${at} 배우 포즈`, scene.id);
    });
  }
  for (const actor of script.characters) {
    for (const [expression, url] of Object.entries(actor.expressionImages ?? {})) add(url, "portrait", `${actor.name} · ${expression} 원화`);
    for (const [outfit, images] of Object.entries(actor.outfitImages ?? {})) for (const [expression, url] of Object.entries(images ?? {})) add(url, "portrait", `${actor.name} · ${outfit} ${expression} 원화`);
  }
  for (const asset of script.assets ?? []) add(asset.url, "artwork", `아트 라이브러리 · ${asset.name}`);
  for (const asset of script.audioAssets ?? []) add(asset.url, "audio", `음원 보관함 · ${asset.name}`);
  return refs;
}

export interface MediaCheckOptions {
  readonly fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  readonly signal?: AbortSignal;
  /** 이미 있는 것으로 확인한 주소. 다시 요청하지 않는다. */
  readonly known?: Set<string>;
  /** 사용자 파일(/assets/user/**)을 서비스 워커가 내려 줄 준비. 실패하면 그 주소들은 판정하지 않는다. */
  readonly ensureUserAssets?: () => Promise<void>;
  readonly concurrency?: number;
}
export const USER_ASSET_PREFIX = "/assets/user/";

/**
 * 없는 파일만 돌려준다. 네트워크 오류나 준비되지 않은 서비스 워커는 "모름"이라 보고하지 않는다 —
 * 거짓 경고가 실제 누락 경고를 묻어버리면 작가가 목록을 믿지 않게 된다.
 */
export async function findMissingMedia(refs: readonly MediaReference[], options: MediaCheckOptions = {}): Promise<{ missing: MediaReference[]; available: string[] }> {
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  let userReady = true;
  if (refs.some(ref => ref.url.startsWith(USER_ASSET_PREFIX)) && options.ensureUserAssets) {
    try { await options.ensureUserAssets(); } catch { userReady = false; }
  }
  const pending = refs.filter(ref => !options.known?.has(ref.url) && (userReady || !ref.url.startsWith(USER_ASSET_PREFIX)));
  const missing: MediaReference[] = []; const available: string[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const ref = pending[cursor++]!;
      if (options.signal?.aborted) return;
      try {
        const response = await fetcher(ref.url, { method: "GET", cache: "force-cache", ...(options.signal ? { signal: options.signal } : {}) });
        void response.body?.cancel().catch(() => {});
        if (response.ok) available.push(ref.url);
        else if (response.status === 404 || response.status === 410) missing.push(ref);
      } catch { /* unreachable server or aborted: unknown, not missing */ }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 4, pending.length)) }, worker));
  const order = new Map(refs.map((ref, index) => [ref.url, index]));
  missing.sort((a, b) => order.get(a.url)! - order.get(b.url)!);
  return { missing, available };
}
