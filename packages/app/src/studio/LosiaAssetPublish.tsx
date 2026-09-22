import type { Artwork, AudioAsset, VnScript } from "@vnmaker/content";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchLosiaStatus, publishLosiaAsset, type LosiaAssetFile, type LosiaStatus } from "../api/losia.js";
import { Icon } from "./Icon.js";
import { LosiaAuth } from "./LosiaAuth.js";
import "./export-bundle.css";
import "./losia-publish.css";

export type LosiaAssetTarget =
  | { readonly type: "image"; readonly asset: Artwork }
  | { readonly type: "audio"; readonly asset: AudioAsset };

type Phase = "idle" | "prepare" | "upload";

const IMAGE_MAX = 10 * 1024 * 1024;   // 계약: 이미지 장당 10MB
const AUDIO_MAX = 20 * 1024 * 1024;   // 계약: 소리 20MB
const FILE_MAX = 32;                  // 계약: 자산당 32장
const LICENSE_LABELS = { downloadable: "자유 다운로드", attribution: "출처 표시", embedded: "미리보기만(원본 미배포)" } as const;
const EXPRESSION_LABELS: Readonly<Record<string, string>> = { neutral: "기본", smile: "미소", sad: "슬픔", surprised: "놀람" };

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
  "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav",
};

function filename(role: string, blob: Blob): string {
  const slug = role.replace(/[^\p{L}\p{N}_:~.-]+/gu, "-").replace(/:/g, "-");
  return `${slug}.${EXTENSIONS[blob.type] ?? "bin"}`;
}

async function fetchFile(role: string, url: string, signal: AbortSignal): Promise<LosiaAssetFile> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`파일을 읽지 못했습니다 (${url} — HTTP ${response.status})`);
  const blob = await response.blob();
  return { role, blob, filename: filename(role, blob) };
}

/**
 * "losia에 올리기" — 라이브러리의 이미지·음원을 losia 에셋 스토어에 게시한다.
 * 계약: POST /api/assets, multipart meta(JSON) + roles(files 순서) + files.
 * 캐릭터 이미지는 같은 캐릭터의 표정 원화를 모아 인물 패키지(base + expression:*)로 올릴 수 있다.
 */
export function LosiaAssetPublish({ target, script, buttonClass = "art-secondary" }: { readonly target: LosiaAssetTarget; readonly script: VnScript; readonly buttonClass?: string }) {
  const asset = target.asset;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LosiaStatus | null>(null);
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [license, setLicense] = useState<keyof typeof LICENSE_LABELS>("downloadable");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [flags, setFlags] = useState({ nsfw: false, existingIp: false, realPerson: false });
  const [packageAll, setPackageAll] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ id: string; url: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef<AbortController | null>(null);

  const artwork = target.type === "image" ? target.asset : null;
  const kind = target.type === "audio" ? "sound" : artwork?.kind === "character" ? "character" : "stage";
  const character = artwork?.kind === "character" && artwork.characterId
    ? script.characters.find(row => row.id === artwork.characterId) : undefined;
  const packageCount = character ? packageUrls().length : 0;

  /** 패키지로 올릴 때 모을 파일 목록: 선택한 원화가 base, 나머지 표정 이미지가 expression:*. */
  function packageUrls(): { role: string; url: string }[] {
    if (target.type !== "image" || !character) return [];
    const rows: { role: string; url: string }[] = [{ role: "base", url: asset.url }];
    const seen = new Set([asset.url]);
    const label = (key: string) => EXPRESSION_LABELS[key] ?? key;
    for (const row of script.assets ?? []) {
      // 의상 파일(row.outfit)은 base 표정 role 로 올리지 않는다 — 재설치하면 기본 표정표가 다른 옷으로 덮인다.
      if (row.characterId !== character.id || row.id === asset.id || !row.expression || row.outfit || seen.has(row.url)) continue;
      seen.add(row.url);
      rows.push({ role: `expression:${label(row.expression)}`, url: row.url });
    }
    for (const [key, url] of Object.entries(character.expressionImages ?? {})) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      rows.push({ role: `expression:${label(key)}`, url });
    }
    return rows.slice(0, FILE_MAX);
  }

  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    setName(asset.name);
    setDescription("");
    setPrompt(artwork?.prompt ?? "");
    setFlags({ nsfw: false, existingIp: false, realPerson: false });
    setError("");
    setResult(null);
    setPhase("idle");
    void fetchLosiaStatus().then(setStatus);
  }, [open, asset, target, script]);

  function close() { active.current?.abort(); active.current = null; setPhase("idle"); setOpen(false); }

  async function publish() {
    const trimmed = name.trim();
    if (!trimmed) { setError("이름을 입력하세요."); return; }
    const controller = new AbortController(); active.current = controller;
    setPhase("prepare"); setError(""); setResult(null);
    try {
      const plan = target.type === "audio"
        ? [{ role: "audio", url: asset.url }]
        : target.type === "image" && asset.kind === "character" && character && packageAll
          ? packageUrls()
          : [{ role: "base", url: asset.url }];
      const files: LosiaAssetFile[] = [];
      for (const item of plan) {
        const file = await fetchFile(item.role, item.url, controller.signal);
        const max = kind === "sound" ? AUDIO_MAX : IMAGE_MAX;
        if (file.blob.size > max) throw new Error(`‘${item.role}’ 파일이 너무 큽니다 (${Math.round(file.blob.size / 1024 / 1024)}MB > ${Math.round(max / 1024 / 1024)}MB)`);
        files.push(file);
      }
      if (files.length > FILE_MAX) throw new Error(`파일은 ${FILE_MAX}개까지 올릴 수 있습니다 (지금 ${files.length}개)`);
      if (controller.signal.aborted || active.current !== controller) return;
      setPhase("upload");
      const published = await publishLosiaAsset({
        kind,
        name: trimmed,
        tags: tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean).slice(0, 60),
        license,
        generator: "uploaded",
        ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...flags,
      }, files, { direct: status?.direct === true, signal: controller.signal });
      const base = status?.baseUrl || "";
      setResult({ id: published.id, url: `${base}/assets/${published.id}` });
    } catch (failure) {
      if (active.current === controller && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (active.current === controller) { active.current = null; setPhase("idle"); }
    }
  }

  const busy = phase !== "idle";
  const kindLabel = kind === "sound" ? "소리" : kind === "character" ? "인물" : "무대";
  // 내장·컬렉션 아트와 스토어에서 내려받은 자산은 다시 올릴 수 없다 — 게시할 권리가 없기 때문이다.
  const ownFile = asset.url.startsWith("/assets/user/") || asset.url.startsWith("/api/image/file/");
  const fromStore = (asset.provenance?.source ?? "").includes("losia");
  if (!ownFile || fromStore) return null;
  return <>
    <button type="button" className={buttonClass} data-testid="losia-asset-open" onClick={() => setOpen(true)}><Icon name="upload" size={13} />losia에 올리기</button>
    {createPortal(<dialog className="export-bundle-dialog" ref={dialog} onCancel={event => { event.preventDefault(); close(); }} aria-labelledby="losia-asset-title" data-testid="losia-asset-dialog">
      <button type="button" className="export-bundle-close" aria-label="게시 창 닫기" onClick={close}><Icon name="close" /></button>
      <p className="eyebrow">PUBLISH ASSET TO LOSIA</p><h2 id="losia-asset-title">에셋을 losia에 올리기</h2>
      <p className="export-bundle-description">‘{asset.name}’을(를) {kindLabel} 자산으로 losia.online 스토어에 올립니다. 올라간 자산은 누구나 설치할 수 있습니다.</p>
      {status && !status.reachable && <pre className="export-bundle-error" role="alert" data-testid="losia-asset-offline">로컬 게이트웨이에 연결할 수 없습니다. 게이트웨이를 켠 뒤 다시 여세요.</pre>}
      {status?.reachable && <LosiaAuth status={status} busy={busy} onStatus={setStatus} onError={setError} />}
      {status?.configured && <div className="losia-publish-fields">
        <label>이름<input value={name} onChange={event => setName(event.target.value)} maxLength={120} data-testid="losia-asset-name" /></label>
        <label>태그(쉼표로 구분)<input value={tags} onChange={event => setTags(event.target.value)} placeholder="예: 학교, 밤, 배경" data-testid="losia-asset-tags" /></label>
        <label>라이선스<select value={license} onChange={event => setLicense(event.target.value as keyof typeof LICENSE_LABELS)} data-testid="losia-asset-license">{Object.entries(LICENSE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>소개(선택)<textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={4000} data-testid="losia-asset-description" /></label>
        {artwork?.prompt !== undefined && <label>생성 프롬프트<input value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={4000} data-testid="losia-asset-prompt" /></label>}
        {character && <label className="losia-asset-check"><input type="checkbox" checked={packageAll} onChange={event => setPackageAll(event.target.checked)} data-testid="losia-asset-package" /> 이 캐릭터의 표정 원화 {packageCount - 1}장을 함께 패키지로 올립니다 (base + expression:*)</label>}
        <div className="losia-asset-flags">
          <label className="losia-asset-check"><input type="checkbox" checked={flags.nsfw} onChange={event => setFlags(prev => ({ ...prev, nsfw: event.target.checked }))} data-testid="losia-asset-nsfw" /> 성인물</label>
          <label className="losia-asset-check"><input type="checkbox" checked={flags.existingIp} onChange={event => setFlags(prev => ({ ...prev, existingIp: event.target.checked }))} data-testid="losia-asset-existing-ip" /> 기존 IP 포함</label>
          <label className="losia-asset-check"><input type="checkbox" checked={flags.realPerson} onChange={event => setFlags(prev => ({ ...prev, realPerson: event.target.checked }))} data-testid="losia-asset-real-person" /> 실존 인물</label>
        </div>
      </div>}
      {busy && <div className="export-bundle-progress" role="status" data-testid="losia-asset-progress"><span>{phase === "upload" ? "losia에 올리는 중…" : "파일을 준비하는 중…"}</span><progress /></div>}
      {error && <pre className="export-bundle-error" role="alert" data-testid="losia-asset-error">{error}</pre>}
      {result && <div className="export-bundle-success" role="status" data-testid="losia-asset-success"><Icon name="check" /><div><strong>losia에 게시했습니다</strong><span>{result.id}</span></div><a href={result.url} target="_blank" rel="noreferrer">스토어 페이지 열기</a></div>}
      <div className="export-bundle-actions"><button type="button" className="studio-button" onClick={busy ? () => { active.current?.abort(); active.current = null; setPhase("idle"); } : close}>{busy ? "중단" : "닫기"}</button><button type="button" className="studio-button primary" data-testid="losia-asset-submit" disabled={busy || !status?.configured} onClick={() => void publish()}>{phase === "upload" ? "올리는 중…" : phase === "prepare" ? "준비 중…" : result ? "다시 올리기" : "losia에 올리기"}</button></div>
    </dialog>, document.body)}
  </>;
}
