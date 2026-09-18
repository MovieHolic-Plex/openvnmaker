/** One writer per origin: active project and recovery storage are shared across projects. */
export const EDITOR_LOCK = "vnmaker.studio.writer.v1";

export function EditorSession({error,guidance}:{error?:string;guidance?:string}) {
  return <main className="editor-session" aria-labelledby="editor-session-title"><section>
    <span className="eyebrow">VN MAKER · EDITOR SESSION</span>
    <h1 id="editor-session-title">{error ? "편집기를 안전하게 열 수 없습니다" : "다른 탭에서 편집 중입니다"}</h1>
    <p>{error || "이 사이트의 작품은 한 탭에서만 편집할 수 있습니다. 원고가 서로 덮어써지는 것을 막기 위해 이 탭은 저장하지 않고 기다립니다."}</p>
    {!error && <p>편집 중인 탭에서 저장 상태를 확인한 뒤 탭을 닫으세요. 그러면 이곳에서 최신 저장본을 자동으로 엽니다.</p>}
    <div role="status">{error ? guidance ?? "HTTPS 또는 localhost에서 탭 잠금을 지원하는 브라우저로 다시 열어주세요." : "편집 권한을 기다리는 중…"}</div>
    <a href={`${import.meta.env.BASE_URL}index.html`} target="_blank" rel="noreferrer">플레이어 열기</a>
  </section></main>;
}
