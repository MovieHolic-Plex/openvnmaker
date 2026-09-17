import { useState } from "react";
import { clearLosiaToken, fetchLosiaStatus, saveLosiaToken, type LosiaStatus } from "../api/losia.js";
import { Icon } from "./Icon.js";

interface Props {
  readonly status: LosiaStatus;
  readonly busy: boolean;
  /** 토큰 등록·삭제 뒤 새 상태를 올린다. */
  readonly onStatus: (status: LosiaStatus) => void;
  readonly onError: (message: string) => void;
}

/**
 * losia 게시 인증 블록 — 작품 게시와 에셋 게시 다이얼로그가 같이 쓴다.
 * 개인 토큰(la_…)은 게이트웨이 로컬 저장소에만 두고, 호스팅 스튜디오(/make)는 세션 쿠키라 입력이 없다.
 */
export function LosiaAuth({ status, busy, onStatus, onError }: Props) {
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);

  async function run(task: () => Promise<void>) {
    setPending(true); onError("");
    try {
      await task();
      onStatus(await fetchLosiaStatus());
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(false);
    }
  }

  if (status.direct) {
    // 같은 오리진이라도 세션이 없으면 게시는 401로 끝난다 — 먼저 로그인으로 보낸다.
    if (!status.configured) {
      // 로그인 뒤 이 스튜디오로 돌아와야 한다 — ?next= 에 현재 경로를 실어 보낸다.
      const back = typeof window === "undefined" ? "" : window.location.pathname;
      const sep = status.signIn.includes("?") ? "&" : "?";
      return <div className="losia-token" data-testid="losia-token">
        <p>losia 계정으로 로그인하면 이 창에서 바로 올릴 수 있습니다.</p>
        <a className="studio-button" href={`${status.signIn}${sep}next=${encodeURIComponent(back)}`} data-testid="losia-signin">losia 로그인</a>
      </div>;
    }
    return <div className="losia-token" data-testid="losia-token"><div className="losia-token-ok"><Icon name="check" size={14} /><span>losia 계정 세션으로 바로 게시합니다</span></div></div>;
  }
  return <div className="losia-token" data-testid="losia-token">
    {status.configured
      ? <div className="losia-token-ok"><Icon name="check" size={14} /><span>개인 토큰이 등록되어 있습니다</span><button type="button" className="text-button" disabled={busy || pending} onClick={() => void run(clearLosiaToken)}>토큰 지우기</button></div>
      : <>
          <p>개인 토큰이 필요합니다. <a href={`${status.baseUrl}/settings/tokens`} target="_blank" rel="noreferrer">losia.online › 설정 › 토큰</a>에서 발급받아 붙여 넣으세요.</p>
          <div className="losia-token-row">
            <input type="password" value={token} placeholder="la_…" aria-label="losia 개인 토큰" data-testid="losia-token-input" onChange={event => setToken(event.target.value)} autoComplete="off" />
            <button type="button" className="studio-button" disabled={busy || pending || !token.trim()} data-testid="losia-token-save" onClick={() => void run(async () => { await saveLosiaToken(token.trim()); setToken(""); })}>{pending ? "확인 중…" : "토큰 등록"}</button>
          </div>
        </>}
  </div>;
}
