import type { VnScript } from "@vnmaker/content";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildExportBundle, collectProjectAssets, type ExportProgress } from "./exportBundle.js";
import { mediaCredits } from "./mediaCredits.js";
import { Icon } from "./Icon.js";
import "./export-bundle.css";

export function ExportBundleButton({ script }: { readonly script: VnScript }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ url: string; filename: string; fileCount: number; size: number } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef<AbortController | null>(null);
  const media = useMemo(() => open ? mediaCredits(script, collectProjectAssets(script)).files : [], [open, script]);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  function cancel() { active.current?.abort(); active.current = null; setBusy(false); setProgress(null); }
  function close() { cancel(); setOpen(false); }
  async function prepare() {
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(""); setResult(null);
    try {
      const bundle = await buildExportBundle(script, { signal: controller.signal, onProgress: setProgress });
      if (active.current !== controller || controller.signal.aborted) return;
      const url = URL.createObjectURL(bundle.blob);
      setResult({ url, filename: bundle.filename, fileCount: bundle.fileCount, size: bundle.blob.size });
      const link = document.createElement("a"); link.href = url; link.download = bundle.filename; link.click();
    } catch (error) {
      if (active.current === controller && !controller.signal.aborted) setError(error instanceof Error ? error.message : String(error));
    } finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  }
  const percent = progress ? Math.round(progress.complete / Math.max(1, progress.total) * 100) : 0;
  return <>
    <button type="button" className="studio-button" data-testid="studio-export-bundle" onClick={() => { setError(""); setOpen(true); }}><Icon name="download" /><span>게임 ZIP</span></button>
    {createPortal(<dialog className="export-bundle-dialog" ref={dialog} onCancel={event => { event.preventDefault(); close(); }} aria-labelledby="export-bundle-title" data-testid="export-bundle-dialog">
      <button type="button" className="export-bundle-close" aria-label="배포 창 닫기" onClick={close}><Icon name="close" /></button>
      <p className="eyebrow">READY TO SHARE</p><h2 id="export-bundle-title">작품을 하나의 게임으로</h2>
      <p className="export-bundle-description">지금 편집한 원고와 이미지, 음악, 플레이어를 함께 담습니다. ZIP을 풀고 정적 서버에 올리면 독립된 게임으로 열립니다.</p>
      <div className="export-bundle-summary"><Icon name="scenes" size={26} /><div><strong>{script.title}</strong><span>{script.scenes.length}개 장면 · {script.scenes.reduce((total, scene) => total + scene.lines.length, 0).toLocaleString()}줄 · 현재 편집본</span></div><span className="export-bundle-format">.ZIP</span></div>
      <ul className="export-bundle-includes"><li>등록한 아트와 모든 배경·CG·포즈·음악 포함</li><li>별도 서버 API나 앱 로그인 없이 플레이</li><li>작품 버전마다 저장 기록을 독립적으로 보관</li></ul>
      <p className="export-bundle-help">호스팅의 루트에 폴더 전체를 올려주세요. 실행 안내와 다시 편집할 수 있는 project.json도 들어 있습니다.</p>
      <details className="media-provenance"><summary>소재 출처 · {media.filter(file => file.status === "needs-record").length}개 기록 필요 / {media.length}개 파일</summary><p>아트 디렉션과 내 음원 보관함에서 출처를 기록하세요. 입력한 정보와 미기록 파일 목록을 MEDIA_CREDITS에 함께 담습니다.</p><div style={{maxHeight: 160, overflow: "auto"}}>{media.filter(file => file.status === "needs-record").map(file => <p key={file.path} style={{overflowWrap: "anywhere"}}>{file.path}</p>)}</div></details>
      {busy && <div className="export-bundle-progress" role="status" data-testid="export-bundle-progress"><span>{progress?.phase === "assets" ? `이미지·음악 확인 중 ${progress.complete} / ${progress.total}` : progress?.phase === "zip" ? "게임 ZIP을 묶고 있습니다" : "독립 플레이어 준비 중"}</span><progress max="100" value={progress?.phase === "assets" ? percent : undefined} /><small>{progress?.path}</small></div>}
      {error && <pre className="export-bundle-error" role="alert" data-testid="export-bundle-error">{error}</pre>}
      {result && <div className="export-bundle-success" role="status" data-testid="export-bundle-success"><Icon name="check" /><div><strong>게임 ZIP을 만들었습니다</strong><span>{result.fileCount}개 파일 · {(result.size / 1024 / 1024).toFixed(1)} MB</span></div><a href={result.url} download={result.filename}>다시 받기</a></div>}
      <div className="export-bundle-actions"><button type="button" className="studio-button" onClick={busy ? cancel : close}>{busy ? "중단" : "닫기"}</button><button type="button" className="studio-button primary" data-testid="export-bundle-build" disabled={busy} onClick={() => void prepare()}>{busy ? "준비 중…" : result ? "현재 편집본 다시 묶기" : "게임 ZIP 다운로드"}</button></div>
    </dialog>, document.body)}
  </>;
}
