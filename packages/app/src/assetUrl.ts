/**
 * 원고에 저장된 루트 경로(`/assets/…`)를 플레이어가 실제로 열린 위치 기준으로 푼다.
 * 개발 앱은 도메인 루트라 그대로지만, 독립 플레이어는 index.html 과 같은 폴더에
 * 파일이 있으므로 `docs.host/작품/`처럼 하위 경로에 올려도 찾을 수 있어야 한다.
 */
export function assetUrl(path: string, base?: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  // 절대 경로 base 로 빌드된 호스팅 번들(/make/ 등)은 미디어가 번들 옆이 아니라 오리진 루트의
  // /assets/ 네임스페이스에 있다(losia 의 rewrite·서비스워커가 루트에서 서빙). baseURI 로
  // 상대해석하면 /make/assets/ 로 새어 나간다. ./ 로 빌드된 독립 플레이어는 여기에 해당하지 않는다.
  const bundleBase = import.meta.env?.BASE_URL ?? "/";
  if (bundleBase.startsWith("/") && bundleBase !== "/") return path;
  const resolved = base ?? (typeof document === "undefined" ? null : document.baseURI);
  if (!resolved) return path;
  try {
    const url = new URL(path.slice(1), resolved);
    // 루트에 배포된 앱(개발 서버·스튜디오)은 원고에 적힌 루트 경로를 그대로 쓴다.
    // 절대 URL로 바꾸면 같은 뜻인데 표기만 달라져 스냅숏·단언이 전부 흔들린다.
    return url.pathname === path ? path : url.href;
  } catch {
    return path;
  }
}
