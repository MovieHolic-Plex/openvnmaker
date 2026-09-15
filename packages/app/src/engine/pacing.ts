/** 오토 진행·타이프라이터 속도 규칙. 2만 자짜리 대사가 몇 분씩 걸리지 않게 상한을 둔다. */
export const AUTO_BASE_MS = 700;
/** 오토 대기 상한 — 이보다 긴 대사도 20초 뒤에는 넘어간다. */
export const AUTO_MAX_MS = 20_000;
/** 한 줄을 다 쓰는 데 허용하는 최대 시간. 글자 속도는 이 안에 맞춰 빨라진다. */
export const TYPE_MAX_MS = 12_000;
export const DEFAULT_AUTO_SPEED = 45;

/** 글자 수와 오토 속도(글자당 ms)로 다음 줄까지 기다릴 시간을 계산한다. */
export function autoAdvanceDelay(length: number, msPerChar: number = DEFAULT_AUTO_SPEED): number {
  const chars = Number.isFinite(length) && length > 0 ? length : 0;
  const perChar = Number.isFinite(msPerChar) && msPerChar > 0 ? msPerChar : DEFAULT_AUTO_SPEED;
  return Math.min(AUTO_MAX_MS, Math.round(AUTO_BASE_MS + chars * perChar));
}

/** 설정된 글자 속도를 줄 길이에 맞춰 조정한다. 0 이하(즉시 표시)는 그대로 둔다. */
export function typewriterMsPerChar(length: number, msPerChar: number): number {
  if (!(msPerChar > 0) || !(length > 0)) return msPerChar;
  return Math.min(msPerChar, TYPE_MAX_MS / length);
}
