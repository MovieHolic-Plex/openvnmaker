import type { VnScript } from "@vnmaker/content";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchLosiaStatus, publishLosiaWork, type LosiaStatus } from "../api/losia.js";
import { buildExportBundle, type ExportProgress } from "./exportBundle.js";
import { Icon } from "./Icon.js";
import { LosiaAuth } from "./LosiaAuth.js";
import "./export-bundle.css";
import "./losia-publish.css";

type Phase = "idle" | "build" | "upload";

const SLUG_PATTERN = /^[a-z0-9-]{2,64}$/;

/**
 * "losia에 게시" — 현재 편집본을 게임 ZIP으로 묶어 losia.online /api/works 에 올린다.
 * 개인 토큰(la_…)은 게이트웨이 로컬 저장소에 두고, 브라우저는 원문을 보관하지 않는다.
 */
export function LosiaPublishButton({ script }: { readonly script: VnScript }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LosiaStatus | null>(null);
  const [title, setTitle] = useState(script.title);
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ slug: string; url: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef<AbortController | null>(null);

  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    setTitle(script.title);
    setError("");
    setResult(null);
    void fetchLosiaStatus().then(setStatus);
  }, [open, script]);

  function cancel() { active.current?.abort(); active.current = null; setPhase("idle"); setProgress(null); }
  function close() { cancel(); setOpen(false); }

  async function publish() {
    const trimmedSlug = slug.trim();
    if (trimmedSlug && !SLUG_PATTERN.test(trimmedSlug)) {
      setError("주소(slug)는 영문 소문자·숫자·하이픈 2~64자만 쓸 수 있습니다. 비우면 제목에서 만듭니다.");
      return;
    }
    const controller = new AbortController(); active.current = controller;
    setPhase("build"); setError(""); setResult(null);
    try {
      const bundle = await buildExportBundle(script, { signal: controller.signal, onProgress: setProgress, ...(status?.direct ? { runtimeBase: "/make/export-runtime" } : {}) });
      if (active.current !== controller || controller.signal.aborted) return;
      setPhase("upload");
      const published = await publishLosiaWork(bundle.blob, bundle.filename, {
        title: title.trim() || script.title,
        ...(trimmedSlug ? { slug: trimmedSlug } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      }, { direct: status?.direct === true, signal: controller.signal });
      const base = status?.baseUrl || "";
      setResult({ slug: published.slug, url: /^https?:\/\//.test(published.playUrl) ? published.playUrl : `${base}${published.playUrl}` });
    } catch (failure) {
      if (active.current === controller && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (active.current === controller) { active.current = null; setPhase("idle"); setProgress(null); }
    }
  }

  const busy = phase !== "idle";
  const percent = progress ? Math.round(progress.complete / Math.max(1, progress.total) * 100) : 0;
  return <>
    <button type="button" className="studio-button" data-testid="studio-publish-losia" onClick={() => setOpen(true)}><Icon name="upload" /><span>losia에 게시</span></button>
    {createPortal(<dialog className="export-bundle-dialog" ref={dialog} onCancel={event => { event.preventDefault(); close(); }} aria-labelledby="losia-publish-title" data-testid="losia-publish-dialog">
      <button type="button" className="export-bundle-close" aria-label="게시 창 닫기" onClick={close}><Icon name="close" /></button>
      <p className="eyebrow">PUBLISH TO LOSIA</p><h2 id="losia-publish-title">losia에 게시</h2>
      <p className="export-bundle-description">현재 편집본을 게임 ZIP으로 묶어 losia.online에 올립니다. 올라간 작품은 losia 플레이어로 바로 재생됩니다.</p>
      {status && !status.reachable && <pre className="export-bundle-error" role="alert" data-testid="losia-publish-offline">로컬 게이트웨이에 연결할 수 없습니다. 게이트웨이를 켠 뒤 다시 여세요.</pre>}
      {status?.reachable && <LosiaAuth status={status} busy={busy} onStatus={setStatus} onError={setError} />}
      {status?.configured && <>
        <div className="losia-publish-fields">
          <label>작품 제목<input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} data-testid="losia-publish-title-input" /></label>
          <label>주소(선택)<input value={slug} onChange={event => setSlug(event.target.value)} maxLength={64} placeholder="비우면 제목에서 만듭니다" data-testid="losia-publish-slug" /></label>
          <label>소개(선택)<textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={4000} data-testid="losia-publish-description" /></label>
        </div>
      </>}
      {busy && <div className="export-bundle-progress" role="status" data-testid="losia-publish-progress"><span>{phase === "upload" ? "losia에 올리는 중…" : progress?.phase === "assets" ? `이미지·음악 확인 중 ${progress.complete} / ${progress.total}` : progress?.phase === "zip" ? "게임 ZIP을 묶고 있습니다" : "독립 플레이어 준비 중"}</span><progress max="100" value={phase === "build" && progress?.phase === "assets" ? percent : undefined} /><small>{progress?.path}</small></div>}
      {error && <pre className="export-bundle-error" role="alert" data-testid="losia-publish-error">{error}</pre>}
      {result && <div className="export-bundle-success" role="status" data-testid="losia-publish-success"><Icon name="check" /><div><strong>losia에 게시했습니다</strong><span>{result.slug}</span></div><a href={result.url} target="_blank" rel="noreferrer">플레이 페이지 열기</a></div>}
      <div className="export-bundle-actions"><button type="button" className="studio-button" onClick={busy ? cancel : close}>{busy ? "중단" : "닫기"}</button><button type="button" className="studio-button primary" data-testid="losia-publish-submit" disabled={busy || !status?.configured} onClick={() => void publish()}>{phase === "upload" ? "올리는 중…" : phase === "build" ? "ZIP 묶는 중…" : result ? "다시 올리기" : "losia에 올리기"}</button></div>
    </dialog>, document.body)}
  </>;
}
