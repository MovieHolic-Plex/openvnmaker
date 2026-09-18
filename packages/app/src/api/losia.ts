/**
 * losia.online 게시 API.
 *
 * 두 가지 경로가 있다:
 * - 로컬/데스크톱 스튜디오: 게이트웨이 /api/losia/* 프록시. 개인 토큰(la_…)은
 *   게이트웨이가 로컬에 보관하고 Bearer 를 붙여 중계한다 — 브라우저는 원문을 모른다.
 * - losia 가 호스팅하는 스튜디오(/make): 같은 오리진이라 /api/works 를 직접 부른다.
 *   세션 쿠키로 인증되므로 토큰이 필요 없다(미로그인이면 서버가 401).
 *
 * 계약: losia/docs/openvnmaker-contract.md
 */
import { readJson } from "./gateway.js";
import { readHostCapabilities } from "./host.js";

const STUDIO_HEADER = { "X-VNMaker-Studio": "1" } as const;

export interface LosiaStatus {
  /** 게시 경로가 살아 있는가(로컬: 게이트웨이, 호스팅: losia 자신). */
  readonly reachable: boolean;
  /** 바로 게시할 수 있는가 — 토큰 등록됨 또는 같은 오리진 세션. */
  readonly configured: boolean;
  /** true 면 losia 가 호스팅하는 스튜디오 — 토큰 없이 같은 오리진으로 올린다. */
  readonly direct: boolean;
  /** losia 사이트 주소(토큰 발급·플레이 링크의 앞부분). direct 면 빈 문자열. */
  readonly baseUrl: string;
  /** direct 인데 미로그인일 때 보낼 로그인 경로(호스트 상대). */
  readonly signIn: string;
}

export interface LosiaWorkResult {
  readonly slug: string;
  /** losia 응답의 상대 경로(/play/<slug>) 또는 절대 주소. */
  readonly playUrl: string;
}

const OFFLINE: LosiaStatus = { reachable: false, configured: false, direct: false, baseUrl: "", signIn: "/login" };

export async function fetchLosiaStatus(signal?: AbortSignal): Promise<LosiaStatus> {
  const timeout = signal ?? AbortSignal.timeout(8_000);
  try {
    const res = await fetch("/api/losia/status", { headers: STUDIO_HEADER, signal: timeout });
    if (res.ok) {
      const body = await readJson(res);
      return {
        reachable: true,
        configured: body["configured"] === true,
        direct: false,
        baseUrl: typeof body["baseUrl"] === "string" ? body["baseUrl"] : "",
        signIn: "/login",
      };
    }
    if (res.status !== 404) return { ...OFFLINE, reachable: true };
  } catch {
    return OFFLINE;
  }
  // 게이트웨이 프록시가 없다 — 호스트 능력 기술서로 같은 오리진 losia 인지 확인한다.
  // 문서의 auth.authenticated 가 세션 로그인 여부라 토큰 없이도 configured 를 정직하게 판별한다.
  // losia 는 AI 게이트웨이를 얹으면서 gateway:true 가 되었으므로 !host.gateway 대신
  // host 식별자로 '이 사이트 자체'를 알아본다. 조회 실패(네트워크)는 null 취급해 스니핑으로.
  const host = await readHostCapabilities(timeout).catch(() => null);
  if (host && (host.host === "losia" || !host.gateway)) {
    return { reachable: true, configured: host.authenticated, direct: true, baseUrl: "", signIn: host.signIn };
  }
  // 문서가 없는 구형 losia 배포 — 엔드포인트 스니핑으로 되돌아간다.
  try {
    const res = await fetch("/api/works?take=1", { signal: timeout });
    if (res.ok) {
      // Auth.js 세션 엔드포인트로 로그인 여부를 확인한다(없으면 보수적으로 로그인 필요로 본다).
      let configured = false;
      try {
        const session = await fetch("/api/auth/session", { signal: timeout });
        if (session.ok) configured = (await session.json() as { user?: unknown }).user !== undefined;
      } catch { /* 세션 경로가 없으면 로그인 불가 판정 */ }
      return { reachable: true, configured, direct: true, baseUrl: "", signIn: "/login" };
    }
  } catch {
    // losia 가 아닌 정적 호스팅 등 — 게시 불가
  }
  return OFFLINE;
}

export async function saveLosiaToken(token: string): Promise<void> {
  const res = await fetch("/api/losia/token", {
    method: "PUT",
    headers: { ...STUDIO_HEADER, "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(String(body["error"] ?? `token ${res.status}`));
}

export async function clearLosiaToken(): Promise<void> {
  const res = await fetch("/api/losia/token", { method: "DELETE", headers: STUDIO_HEADER, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) {
    const body = await readJson(res);
    throw new Error(String(body["error"] ?? `token ${res.status}`));
  }
}

export interface LosiaWorkFields {
  readonly slug?: string;
  readonly title?: string;
  readonly description?: string;
}

/** 게임 ZIP을 losia /api/works 에 올린다. 로컬이면 게이트웨이 프록시, 호스팅이면 같은 오리진. */
export async function publishLosiaWork(blob: Blob, filename: string, fields: LosiaWorkFields, options: { direct?: boolean; signal?: AbortSignal } = {}): Promise<LosiaWorkResult> {
  const form = new FormData();
  if (fields.slug) form.set("slug", fields.slug);
  if (fields.title) form.set("title", fields.title);
  if (fields.description) form.set("description", fields.description);
  form.set("file", blob, filename);
  const res = await fetch(options.direct ? "/api/works" : "/api/losia/works", {
    method: "POST",
    headers: options.direct ? {} : STUDIO_HEADER,
    body: form,
    signal: options.signal ?? AbortSignal.timeout(600_000),
  });
  const body = await readJson(res);
  if (res.status === 401) throw new Error(options.direct ? "losia 로그인이 필요합니다. losia.online에서 로그인한 뒤 다시 시도하세요." : String(body["error"] ?? "losia 토큰이 필요합니다"));
  if (!res.ok) throw new Error(String(body["error"] ?? `publish ${res.status}`));
  const slug = typeof body["slug"] === "string" ? body["slug"] : "";
  const playUrl = typeof body["playUrl"] === "string" ? body["playUrl"] : "";
  if (!slug || !playUrl) throw new Error("스토어 응답이 올바르지 않습니다");
  return { slug, playUrl };
}

/** 업로드 meta — losia 의 uploadMeta 스키마와 같다. */
export interface LosiaAssetMeta {
  readonly kind: "character" | "stage" | "sound";
  readonly name: string;
  readonly tags: readonly string[];
  readonly license: "embedded" | "attribution" | "downloadable";
  readonly generator: string;
  readonly prompt?: string;
  readonly description?: string;
  readonly nsfw: boolean;
  readonly existingIp: boolean;
  readonly realPerson: boolean;
}

export interface LosiaAssetFile {
  readonly role: string;
  readonly blob: Blob;
  readonly filename: string;
}

/** 에셋을 losia /api/assets 에 올린다 — meta(JSON) + roles(files 순서와 정렬) + files. */
export async function publishLosiaAsset(meta: LosiaAssetMeta, files: readonly LosiaAssetFile[], options: { direct?: boolean; signal?: AbortSignal } = {}): Promise<{ id: string }> {
  const form = new FormData();
  form.set("meta", JSON.stringify(meta));
  form.set("roles", JSON.stringify(files.map(file => file.role)));
  for (const file of files) form.append("files", file.blob, file.filename);
  const res = await fetch(options.direct ? "/api/assets" : "/api/losia/assets", {
    method: "POST",
    headers: options.direct ? {} : STUDIO_HEADER,
    body: form,
    signal: options.signal ?? AbortSignal.timeout(300_000),
  });
  const body = await readJson(res);
  if (res.status === 401) throw new Error(options.direct ? "losia 로그인이 필요합니다. losia.online에서 로그인한 뒤 다시 시도하세요." : String(body["error"] ?? "losia 토큰이 필요합니다"));
  if (!res.ok) throw new Error(String(body["error"] ?? `publish ${res.status}`));
  const id = typeof body["id"] === "string" ? body["id"] : "";
  if (!id) throw new Error("스토어 응답이 올바르지 않습니다");
  return { id };
}
