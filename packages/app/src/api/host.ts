/**
 * 호스트 능력 기술서 — losia.online 같은 호스팅 환경이 /.well-known/openvnmaker.json 으로
 * 스튜디오에게 '무엇이 되고 무엇이 안 되는가'를 알린다(spec `openvnmaker-host/1`).
 *
 * 문서가 없으면 null — 로컬 실행·게이트웨이 환경으로 보고 지금까지의 동작을 유지한다.
 * `gateway:false` 이면 게이트웨이 전용 기능(AI 연결, 네이티브 빌드, 그래프 컴파일)이
 * 이 배포에서는 영구히 죽어 있으므로 UI 에서도 숨긴다.
 *
 * 계약: losia/docs/openvnmaker-contract.md
 */

export interface HostCapabilities {
  /** 이 호스트가 openvnmaker 게이트웨이를 함께 서빙하는가. */
  readonly gateway: boolean;
  /** losia 세션 로그인 여부 — false 면 게시 전에 로그인 페이지로 보내야 한다. */
  readonly authenticated: boolean;
  /** 로그인 진입 경로(호스트 상대 경로). */
  readonly signIn: string;
  /** 작품 게시 엔드포인트(호스트 상대 경로). */
  readonly publishWorks: string;
  /** 업로드 최대 바이트. 모르면 null. */
  readonly publishMaxBytes: number | null;
  /**
   * 에이전트 그래프(게이트웨이 story 프로젝트)가 있는가. losia 처럼 AI 만 얹은
   * 호스트는 false 를 보내 그래프 미리보기 버튼을 숨긴다. 생략(데스크톱)은 true 간주.
   */
  readonly graph: boolean;
  /** 네이티브 빌드 서버(/api/native-build)가 있는가. 생략(데스크톱)은 true 간주. */
  readonly native: boolean;
}

const NOT_HOSTED: HostCapabilities | null = null;

/** 문서를 매번 새로 읽는다 — 로그인 상태는 최신이어야 하는 소비자용(게시 다이얼로그). */
export async function readHostCapabilities(signal?: AbortSignal): Promise<HostCapabilities | null> {
  try {
    const res = await fetch("/.well-known/openvnmaker.json", { signal: signal ?? AbortSignal.timeout(8_000) });
    if (!res.ok) return NOT_HOSTED;
    const body = await res.json() as {
      spec?: unknown; gateway?: unknown; graph?: unknown; native?: unknown;
      auth?: { authenticated?: unknown; signIn?: unknown };
      publish?: { works?: unknown; maxBytes?: unknown };
    };
    if (body.spec !== "openvnmaker-host/1") return NOT_HOSTED;
    return {
      gateway: body.gateway === true,
      authenticated: body.auth?.authenticated === true,
      signIn: typeof body.auth?.signIn === "string" ? body.auth.signIn : "/login",
      publishWorks: typeof body.publish?.works === "string" ? body.publish.works : "/api/works",
      publishMaxBytes: typeof body.publish?.maxBytes === "number" ? body.publish.maxBytes : null,
      graph: body.graph !== false,
      native: body.native !== false,
    };
  } catch {
    return NOT_HOSTED;
  }
}

let cached: Promise<HostCapabilities | null> | null = null;

/** UI 표시용 — 한 세션에서 한 번만 읽고 공유한다. */
export function fetchHostCapabilities(): Promise<HostCapabilities | null> {
  cached ??= readHostCapabilities();
  return cached;
}
